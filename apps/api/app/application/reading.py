"""Lectura híbrida: capa determinista (QR fiscal, texto del PDF) + IA de visión con ruteo por
dificultad, verificación determinista y escalamiento a una configuración más fuerte.

    preparar (hilo) -> ¿borrosa? parar -> QR (hilo) -> elegir modelo -> IA -> fusionar QR -> verificar
        -> ¿problemas o baja confianza? escalar (razonamiento + alta resolución) -> quedarse con la mejor lectura
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date

from app.application.settings import RuntimeSettings
from app.domain.enums import ExpenseWarning, Legibility
from app.domain.errors import ExternalServiceError
from app.domain.fiscal import parse_fiscal_qr
from app.domain.ports import (
    DocumentPreparer,
    ExtractionContext,
    ExtractionOptions,
    ExtractionRequest,
    ExtractionResponse,
    ImageOptions,
    InvoiceExtractor,
    PreparedDocument,
    QrDecoder,
)
from app.domain.values import FiscalQrData, InvoiceData
from app.domain.verification import InvoiceVerifier, VerificationIssue

logger = logging.getLogger(__name__)

# Campos en los que manda el QR fiscal.
_QR_FIELDS = ("fiscal_id", "invoice_number", "invoice_date", "vendor_tax_id", "buyer_tax_id", "subtotal", "tax_amount", "total")


@dataclass(frozen=True)
class ReadingConfig:
    primary_model: str
    lite_model: str
    fallback_model: str
    routing: str  # by_difficulty | always_primary
    escalation_threshold: float
    image: ImageOptions
    extraction: ExtractionOptions
    supported_currencies: tuple[str, ...] = ()
    currency_aliases: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_settings(cls, s: RuntimeSettings) -> ReadingConfig:
        return cls(
            primary_model=s.ai_primary_model,
            lite_model=s.ai_lite_model,
            fallback_model=s.ai_fallback_model,
            routing=s.ai_routing,
            escalation_threshold=s.ai_escalation_threshold,
            image=ImageOptions(s.image_max_side_px, s.image_hires_max_side_px, s.image_blur_threshold, s.image_thumbnail_side_px),
            extraction=ExtractionOptions(
                prompt_version=s.ai_prompt_version,
                max_tokens=s.ai_max_tokens,
                reasoning_off=s.ai_reasoning_off,
                reasoning_on=s.ai_reasoning_on,
                zero_data_retention=s.ai_zero_data_retention,
                availability_fallbacks=tuple(s.ai_availability_fallbacks),
            ),
            supported_currencies=tuple(s.supported_currencies),
            currency_aliases=dict(s.currency_aliases),
        )


ConfigProvider = Callable[[], Awaitable[ReadingConfig]]


@dataclass
class AttemptRecord:
    """Una llamada a la IA, antes de asociarla a un gasto."""

    tier: str
    model_requested: str
    response: ExtractionResponse | None = None
    issues: list[VerificationIssue] = field(default_factory=list)
    escalation_reason: str | None = None
    error: str | None = None


@dataclass
class ReadingOutcome:
    legibility: Legibility
    documents: list[InvoiceData]
    warnings: list[list[str]]  # una lista por documento
    attempts: list[AttemptRecord]
    qr: FiscalQrData | None = None
    escalated: bool = False
    timings: dict[str, int] = field(default_factory=dict)
    not_a_receipt: bool = False  # la foto no es un comprobante: no se escala ni se crea gasto con datos
    thumbnail: bytes | None = None

    @property
    def unreadable(self) -> bool:
        return self.legibility == Legibility.UNREADABLE or not self.documents


class DocumentReader:
    def __init__(
        self,
        preparer: DocumentPreparer,
        qr_decoder: QrDecoder,
        extractor: InvoiceExtractor,
        verifier: InvoiceVerifier,
        config: ConfigProvider,
    ) -> None:
        self._preparer = preparer
        self._qr = qr_decoder
        self._extractor = extractor
        self._verifier = verifier
        # Se lee en cada factura: un cambio de modelo o umbral aplica sin reiniciar.
        self._config = config

    async def read(
        self,
        content: bytes,
        mime_type: str,
        context: ExtractionContext,
        today: date,
        model_override: str | None = None,
    ) -> ReadingOutcome:
        config = await self._config()
        timings: dict[str, int] = {}
        started = time.perf_counter()
        prepared = await asyncio.to_thread(self._preparer.prepare, content, mime_type, config.image)
        timings.update(prepared.timings)
        if prepared.is_blurry:
            # Se pide otra foto antes de gastar tokens de IA en esta.
            return ReadingOutcome(Legibility.UNREADABLE, [], [], [], timings=timings, thumbnail=prepared.thumbnail)

        qr = await self._decode_qr(prepared, timings)
        model, tier = self._route(config, qr, prepared, model_override)
        known = _known_values(qr)

        first = await self._call(config, tier, model, prepared.llm_content, prepared.llm_mime_type, context, known, False)
        attempts = [first]
        assert first.response is not None
        if first.response.legibility == Legibility.UNREADABLE or not first.response.documents:
            timings["total_ms"] = _ms(started)
            return ReadingOutcome(Legibility.UNREADABLE, [], [], attempts, qr, timings=timings, thumbnail=prepared.thumbnail)
        if not any(d.is_receipt for d in first.response.documents) and qr is None:
            # Una selfie o un pantallazo no se escala: más razonamiento no lo vuelve factura.
            timings["total_ms"] = _ms(started)
            return ReadingOutcome(
                Legibility.UNREADABLE, [], [], attempts, qr, timings=timings, not_a_receipt=True, thumbnail=prepared.thumbnail
            )

        # Se verifica lo que leyó la IA (para detectar si no cuadra con el QR) y luego gana el QR.
        first.issues = self._verify(first.response.documents, today, qr)
        docs = _merge_qr(first.response.documents, qr)
        best_docs, best_attempt, legibility = docs, first, first.response.legibility

        reason = self._escalation_reason(config, first.issues, docs)
        escalated = False
        if reason and model_override is None:
            first.escalation_reason = reason
            try:
                second = await self._call(
                    config,
                    "escalation",
                    config.fallback_model,
                    prepared.hires_content,
                    prepared.llm_mime_type,
                    context,
                    known,
                    True,
                )
                attempts.append(second)
                assert second.response is not None
                if second.response.documents and second.response.legibility != Legibility.UNREADABLE:
                    second.issues = self._verify(second.response.documents, today, qr)
                    docs2 = _merge_qr(second.response.documents, qr)
                    escalated = True
                    # Se queda la lectura escalada salvo que sea claramente peor.
                    if len(second.issues) <= len(first.issues):
                        best_docs, best_attempt, legibility = docs2, second, second.response.legibility
            except ExternalServiceError as exc:
                logger.warning("Escalation failed, keeping the first reading: %s", exc)
                attempts.append(AttemptRecord("escalation", config.fallback_model, error=str(exc)[:300]))

        best_docs = [d for d in best_docs if d.is_receipt] or best_docs
        best_docs = [_normalize_currency(d, config.currency_aliases) for d in best_docs]
        warnings = self._warnings(config, best_docs, best_attempt.issues, legibility)
        timings["total_ms"] = _ms(started)
        return ReadingOutcome(legibility, best_docs, warnings, attempts, qr, escalated, timings, thumbnail=prepared.thumbnail)

    async def _decode_qr(self, prepared: PreparedDocument, timings: dict[str, int]) -> FiscalQrData | None:
        started = time.perf_counter()
        texts = await asyncio.to_thread(self._qr.decode, prepared)
        timings["qr_ms"] = _ms(started)
        for text in texts:
            parsed = parse_fiscal_qr(text)
            if parsed is not None:
                return parsed
        return None

    @staticmethod
    def _route(
        config: ReadingConfig, qr: FiscalQrData | None, prepared: PreparedDocument, override: str | None
    ) -> tuple[str, str]:
        if override:
            return override, "override"
        if config.routing == "by_difficulty":
            # El punto débil del modelo lite son los valores puntuales; con un QR fiscal legible esos
            # vienen exactos del QR y al modelo rápido solo le toca leer líneas y categoría.
            has_text_layer = bool(prepared.pdf_text and len(prepared.pdf_text) > 200)
            if (qr is not None and qr.has_amounts) or has_text_layer:
                return config.lite_model, "lite"
        return config.primary_model, "primary"

    async def _call(
        self,
        config: ReadingConfig,
        tier: str,
        model: str,
        content: bytes,
        mime: str,
        context: ExtractionContext,
        known: dict[str, str],
        reasoning: bool,
    ) -> AttemptRecord:
        request = ExtractionRequest(content, mime, model, config.extraction, reasoning, context, known)
        response = await self._extractor.extract(request)
        return AttemptRecord(tier, model, response)

    def _verify(self, docs: list[InvoiceData], today: date, qr: FiscalQrData | None) -> list[VerificationIssue]:
        issues: list[VerificationIssue] = []
        for index, doc in enumerate(docs):
            # El QR es de un solo documento: se compara solo contra el primero.
            issues.extend(self._verifier.verify(doc, today, qr if index == 0 else None))
        return issues

    @staticmethod
    def _escalation_reason(config: ReadingConfig, issues: list[VerificationIssue], docs: list[InvoiceData]) -> str | None:
        if issues:
            return ",".join(sorted({i.code for i in issues}))
        low = [d for d in docs if d.confidence < config.escalation_threshold]
        return "low_confidence" if low else None

    @staticmethod
    def _warnings(
        config: ReadingConfig, docs: list[InvoiceData], issues: list[VerificationIssue], legibility: Legibility
    ) -> list[list[str]]:
        codes = {i.code for i in issues}
        result: list[list[str]] = []
        for doc in docs:
            warnings: list[str] = []
            if doc.confidence < config.escalation_threshold:
                warnings.append(ExpenseWarning.LOW_CONFIDENCE)
            if codes - {"qr_total_mismatch"}:
                warnings.append(ExpenseWarning.VERIFICATION_FAILED)
            if "qr_total_mismatch" in codes:
                warnings.append(ExpenseWarning.QR_MISMATCH)
            if legibility == Legibility.POOR:
                warnings.append(ExpenseWarning.POOR_LEGIBILITY)
            if doc.currency and doc.currency not in config.supported_currencies:
                warnings.append(ExpenseWarning.UNSUPPORTED_CURRENCY)
            result.append(warnings)
        return result


def _normalize_currency(doc: InvoiceData, aliases: dict[str, str]) -> InvoiceData:
    """Monedas que circulan a la par de otra (B/. de Panamá = USD) se registran como esa otra."""
    if doc.currency and doc.currency in aliases:
        return dataclasses.replace(doc, currency=aliases[doc.currency])
    return doc


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _known_values(qr: FiscalQrData | None) -> dict[str, str]:
    if qr is None:
        return {}
    values = {name: getattr(qr, name) for name in _QR_FIELDS}
    return {k: str(v) for k, v in values.items() if v is not None}


def _merge_qr(docs: list[InvoiceData], qr: FiscalQrData | None) -> list[InvoiceData]:
    """El QR fiscal le gana a la IA en los campos que trae (solo en el primer documento)."""
    sources = {name: "ai" for name in ("vendor_name", "total", "invoice_date", "vendor_tax_id")}
    if qr is None or not docs:
        return [dataclasses.replace(d, field_sources={**sources, **d.field_sources}) for d in docs]
    first = docs[0]
    overrides = {name: getattr(qr, name) for name in _QR_FIELDS if getattr(qr, name) is not None}
    merged = dataclasses.replace(
        first,
        **overrides,
        country=first.country or qr.country,
        field_sources={**sources, **first.field_sources, **{name: "qr" for name in overrides}},
    )
    return [merged, *docs[1:]]
