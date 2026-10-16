"""Dobles de los puertos externos (IA, WhatsApp, almacenamiento). La persistencia sigue siendo real (PostgreSQL)."""

from __future__ import annotations

import io
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import zxingcpp
from PIL import Image, ImageDraw

from app.domain.entities import ExchangeRate
from app.domain.enums import DocumentType, ExchangeRateSource, Legibility
from app.domain.erp import ErpAdvance, ErpLegalization
from app.domain.errors import ExternalServiceError, NotFoundError, ServiceNotConfiguredError
from app.domain.ports import Button, ExtractionRequest, ExtractionResponse, FlowMessage, ListRow
from app.domain.values import InvoiceData, InvoiceLine, WhatsAppAddress


class FakeStorage:
    def __init__(self) -> None:
        self.files: dict[str, tuple[bytes, str]] = {}

    async def save(self, key: str, data: bytes, content_type: str) -> None:
        self.files[key] = (data, content_type)

    async def read(self, key: str) -> bytes:
        if key not in self.files:
            raise NotFoundError("file")
        return self.files[key][0]

    async def signed_url(self, key: str, ttl_seconds: int) -> str:
        return f"https://r2.example/{key}?ttl={ttl_seconds}"


@dataclass
class Sent:
    kind: str
    to: WhatsAppAddress | None
    text: str = ""
    extra: Any = None


class FakeWhatsApp:
    """Guarda cada mensaje saliente y sirve el media registrado."""

    def __init__(self) -> None:
        self.sent: list[Sent] = []
        self.media: dict[str, tuple[bytes, str]] = {}
        self._counter = 0

    def _id(self) -> str:
        self._counter += 1
        return f"wamid.out.{self._counter}"

    def of_kind(self, kind: str) -> list[Sent]:
        return [s for s in self.sent if s.kind == kind]

    def texts(self) -> list[str]:
        return [s.text for s in self.sent if s.kind in ("text", "buttons", "list", "request_contact_info")]

    async def send_text(self, to: WhatsAppAddress, text: str) -> str | None:
        self.sent.append(Sent("text", to, text))
        return self._id()

    async def send_buttons(self, to: WhatsAppAddress, text: str, buttons: list[Button]) -> str | None:
        self.sent.append(Sent("buttons", to, text, buttons))
        return self._id()

    async def send_list(self, to: WhatsAppAddress, text: str, button_label: str, rows: list[ListRow]) -> str | None:
        self.sent.append(Sent("list", to, text, rows))
        return self._id()

    async def send_template(
        self, to: WhatsAppAddress, name: str, language: str, body_params: list[str], button_payloads: list[str]
    ) -> str | None:
        self.sent.append(Sent("template", to, name, {"params": body_params, "payloads": button_payloads}))
        return self._id()

    async def send_flow(self, to: WhatsAppAddress, flow: FlowMessage) -> str | None:
        self.sent.append(Sent("flow", to, flow.text, flow))
        return self._id()

    async def request_contact_info(self, to: WhatsAppAddress, text: str) -> str | None:
        self.sent.append(Sent("request_contact_info", to, text))
        return self._id()

    async def react(self, to: WhatsAppAddress, message_id: str, emoji: str) -> None:
        self.sent.append(Sent("reaction", to, emoji, message_id))

    async def mark_read(self, message_id: str, typing: bool = True) -> None:
        self.sent.append(Sent("read", None, message_id))

    async def download(self, media_id: str) -> tuple[bytes, str]:
        if media_id not in self.media:
            raise ExternalServiceError("unknown media")
        return self.media[media_id]


def invoice(**overrides: Any) -> InvoiceData:
    base: dict[str, Any] = dict(
        document_type=DocumentType.POS_TICKET,
        vendor_name="Restaurante El Cielo",
        vendor_tax_id="890903938-8",
        invoice_number="POS-1",
        invoice_date=date(2026, 10, 13),
        currency="COP",
        subtotal=Decimal("37815"),
        tax_amount=Decimal("7185"),
        total=Decimal("45000"),
        country="CO",
        category="meals",
        description="Almuerzo",
        itemized=True,
        confidence=0.95,
        lines=(InvoiceLine("Almuerzo ejecutivo", Decimal("45000"), Decimal("1")),),
    )
    base.update(overrides)
    return InvoiceData(**base)


@dataclass
class FakeExtractor:
    """Devuelve los documentos que produzca `respond(request, call_number)` y guarda las solicitudes."""

    respond: Callable[[ExtractionRequest, int], list[InvoiceData]] = lambda _r, _n: [invoice()]
    legibility: Legibility = Legibility.GOOD
    fail_times: int = 0
    calls: list[ExtractionRequest] = field(default_factory=list)

    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        self.calls.append(request)
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ExternalServiceError("provider down")
        docs = self.respond(request, len(self.calls))
        return ExtractionResponse(
            legibility=self.legibility if docs else Legibility.UNREADABLE,
            documents=docs,
            prompt_version="invoice_extraction/test",
            model_used=request.model,
            raw_text="{}",
            parsed={},
            prompt_tokens=1000,
            completion_tokens=200,
            cost_usd=Decimal("0.002"),
            latency_ms=5,
        )


def make_jpeg(qr_text: str | None = None, seed: int = 1, blurry: bool = False) -> bytes:
    """Foto sintética de un recibo: trazos aleatorios nítidos de 'texto' (pasa el chequeo de borrosidad) y
    un QR fiscal opcional."""
    rnd = random.Random(seed)
    image = Image.new("RGB", (900, 1200), "white")
    draw = ImageDraw.Draw(image)
    if not blurry:
        for _ in range(400):
            x, y = rnd.randint(20, 860), rnd.randint(20, 1160)
            draw.line((x, y, x + rnd.randint(5, 40), y), fill="black", width=2)
    if qr_text:
        code = zxingcpp.create_barcode(qr_text, zxingcpp.BarcodeFormat.QRCode)
        qr = Image.fromarray(__import__("numpy").asarray(code.to_image(scale=6))).convert("RGB")
        image.paste(qr, (500, 800))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


@dataclass
class FakeRateProvider:
    """Tasas fijas por moneda (1 USD = valor) para cada día pedido; `fail=True` simula la fuente caída."""

    per_usd: dict[str, Decimal] = field(default_factory=dict)
    source: str = "trm"
    fail: bool = False

    async def fetch(self, start: date, end: date, quotes: list[str]) -> list[ExchangeRate]:
        if self.fail:
            raise ExternalServiceError("rates down", code="exchange_rates_unavailable")
        days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        return [
            ExchangeRate(day, "USD", quote, rate, ExchangeRateSource(self.source))
            for day in days
            for quote, rate in self.per_usd.items()
            if quote in quotes
        ]


@dataclass
class FakeErp:
    """Siesa de mentiras: guarda los documentos. `mode` = "ok", "down" (falla) o "unconfigured"."""

    mode: str = "ok"
    advances: list[ErpAdvance] = field(default_factory=list)
    legalizations: list[ErpLegalization] = field(default_factory=list)

    def _check(self) -> None:
        if self.mode == "unconfigured":
            raise ServiceNotConfiguredError("siesa")
        if self.mode == "down":
            raise ExternalServiceError("Siesa is down")

    async def create_advance(self, document: ErpAdvance) -> str:
        self._check()
        self.advances.append(document)
        return f"ANT-{len(self.advances)}"

    async def create_legalization(self, document: ErpLegalization) -> str:
        self._check()
        self.legalizations.append(document)
        return f"LEG-{len(self.legalizations)}"
