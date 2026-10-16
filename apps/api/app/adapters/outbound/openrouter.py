"""Extracción de facturas con OpenRouter (chat completions compatible con OpenAI, con visión).

El prompt está ordenado para la caché: las instrucciones fijas y el contexto de la compañía van primero y
lo variable (valores del QR, la imagen) al final, para que se active la caché implícita de Gemini."""

from __future__ import annotations

import base64
import json
import logging
import time
from datetime import date
from datetime import time as clock_time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from app.domain.enums import DocumentType, Legibility, TaxType
from app.domain.errors import ExternalServiceError
from app.domain.ports import ExtractionOptions, ExtractionRequest, ExtractionResponse, StatementTable
from app.domain.values import InvoiceData, InvoiceLine, TaxItem

logger = logging.getLogger(__name__)

_NULLABLE_STRING = {"type": ["string", "null"]}
_NULLABLE_NUMBER = {"type": ["number", "null"]}

_DOCUMENT_FIELDS: dict[str, Any] = {
    "document_type": {"type": "string", "enum": [v.value for v in DocumentType]},
    "is_receipt": {"type": "boolean"},
    "vendor_name": _NULLABLE_STRING,
    "vendor_tax_id": _NULLABLE_STRING,
    "buyer_tax_id": _NULLABLE_STRING,
    "invoice_number": _NULLABLE_STRING,
    "invoice_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
    "invoice_time": {"type": ["string", "null"], "description": "HH:MM, 24 h"},
    "currency": _NULLABLE_STRING,
    "subtotal": _NULLABLE_NUMBER,
    "taxes": {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["type", "rate", "base", "amount"],
            "properties": {
                "type": {"type": "string", "enum": [v.value for v in TaxType]},
                "rate": _NULLABLE_NUMBER,
                "base": _NULLABLE_NUMBER,
                "amount": {"type": "number"},
            },
        },
    },
    "tax_amount": _NULLABLE_NUMBER,
    "tip_amount": _NULLABLE_NUMBER,
    "total": _NULLABLE_NUMBER,
    "fiscal_id": _NULLABLE_STRING,
    "country": _NULLABLE_STRING,
    "category": _NULLABLE_STRING,
    "description": _NULLABLE_STRING,
    "itemized": {"type": "boolean"},
    "confidence": {"type": "number"},
    "lines": {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["description", "quantity", "amount", "concept_code", "concept_confidence"],
            "properties": {
                "description": {"type": "string"},
                "quantity": _NULLABLE_NUMBER,
                "amount": _NULLABLE_NUMBER,
                "concept_code": _NULLABLE_STRING,
                "concept_confidence": _NULLABLE_NUMBER,
            },
        },
    },
}


def response_schema(category_codes: list[str]) -> dict[str, Any]:
    """Esquema estricto de la respuesta. Las categorías son las de la compañía del gasto."""
    fields = dict(_DOCUMENT_FIELDS)
    if category_codes:
        fields["category"] = {"type": ["string", "null"], "enum": [*category_codes, None]}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["legibility", "documents"],
        "properties": {
            "legibility": {"type": "string", "enum": [v.value for v in Legibility]},
            "documents": {
                "type": "array",
                "items": {"type": "object", "additionalProperties": False, "required": list(fields), "properties": fields},
            },
        },
    }


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException | httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (exc.response.status_code == 429 or exc.response.status_code >= 500)


class _OpenRouter:
    """Cliente común: chat completions con reintentos cortos y prompts versionados en disco."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        api_key: str,
        prompt_dir: Path,
        timeout_seconds: float,
    ) -> None:
        self._client = client
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._key = api_key
        self._prompt_dir = prompt_dir
        self._prompts: dict[str, str] = {}
        self._timeout = timeout_seconds

    def _instructions(self, version: str) -> str:
        if version not in self._prompts:
            path = self._prompt_dir / f"{version}.md"
            if not path.is_file():
                raise ExternalServiceError(f"Prompt {version} does not exist", code="ai_unavailable")
            self._prompts[version] = path.read_text(encoding="utf-8")
        return self._prompts[version]

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self._key}", "X-Title": "anticipos-gastos-api"}
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(_retryable),
            stop=stop_after_attempt(2),
            wait=wait_exponential(multiplier=0.5, min=0.5, max=2),
            reraise=True,
        ):
            with attempt:
                response = await self._client.post(self._url, json=payload, headers=headers, timeout=self._timeout)
                response.raise_for_status()
                return response.json()
        raise AssertionError("unreachable")

    async def _ask(self, payload: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any], int]:
        """Devuelve (respuesta, texto, JSON interpretado, latencia en ms)."""
        started = time.perf_counter()
        try:
            data = await self._post(payload)
        except httpx.HTTPStatusError as exc:
            raise ExternalServiceError(f"OpenRouter answered {exc.response.status_code}", code="ai_unavailable") from exc
        except httpx.HTTPError as exc:
            raise ExternalServiceError(f"OpenRouter unreachable ({type(exc).__name__})", code="ai_unavailable") from exc
        latency = int((time.perf_counter() - started) * 1000)
        try:
            content = data["choices"][0]["message"]["content"] or ""
            parsed = json.loads(_strip_fences(content))
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise ExternalServiceError("The AI answer is not valid JSON", code="ai_unavailable") from exc
        if not isinstance(parsed, dict):
            raise ExternalServiceError("The AI answer is not an object", code="ai_unavailable")
        return data, content, parsed, latency


class OpenRouterInvoiceExtractor(_OpenRouter):
    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        payload = self._payload(request)
        data, content, parsed, latency = await self._ask(payload)
        usage = data.get("usage") or {}
        return ExtractionResponse(
            legibility=_enum(Legibility, parsed.get("legibility"), Legibility.POOR),
            documents=[_document(d) for d in parsed.get("documents") or [] if isinstance(d, dict)],
            prompt_version=f"invoice_extraction/{request.options.prompt_version}",
            model_used=data.get("model"),
            raw_text=content[:20000],
            parsed=parsed,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            cached_tokens=(usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
            cost_usd=_decimal(usage.get("cost")),
            latency_ms=latency,
        )

    def _payload(self, request: ExtractionRequest) -> dict[str, Any]:
        options = request.options
        context = request.context
        company = (
            f"The expense belongs to the company '{context.company_name}' "
            f"(country {context.country}, functional currency {context.currency}). "
            "The invoice may still be from another country if the employee travelled."
            if context.company_name
            else "No company context is available."
        )
        if context.categories:
            categories = [{"code": c.code, "name": c.name} for c in context.categories]
            company += "\nExpense categories of this company: " + json.dumps(categories, ensure_ascii=False)
        if context.blocked_concepts:
            concepts = [
                {"code": c.code, "name": c.name, "description": c.description, "examples": list(c.examples)}
                for c in context.blocked_concepts
            ]
            company += "\nBlocked concepts of this company: " + json.dumps(concepts, ensure_ascii=False)
        if context.learned:
            learned = [{"text": e.text, "concept_code": e.concept_code} for e in context.learned]
            company += (
                "\nPast line classifications confirmed by this company's reviewers (null = allowed item). "
                "Follow them for the same or similar items: " + json.dumps(learned, ensure_ascii=False)
            )
        user_parts: list[dict[str, Any]] = []
        if request.known_values:
            known = json.dumps(request.known_values, ensure_ascii=False)
            user_parts.append({"type": "text", "text": f"Values decoded from the fiscal QR (authoritative): {known}"})
        user_parts.append({"type": "text", "text": "Extract the documents in this file."})
        user_parts.append(_file_part(request.content, request.mime_type))
        payload: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": self._instructions(options.prompt_version)},  # fijo: prefijo cacheable
                {"role": "system", "content": company},  # fijo por compañía
                {"role": "user", "content": user_parts},  # variable
            ],
            "temperature": 0,
            "max_tokens": options.max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "invoice_extraction",
                    "strict": True,
                    "schema": response_schema([c.code for c in context.categories]),
                },
            },
            "reasoning": {"effort": options.reasoning_on if request.reasoning else options.reasoning_off, "exclude": True},
            "provider": {
                "sort": "latency",
                "data_collection": "deny",
                "require_parameters": True,
                "zdr": options.zero_data_retention,
            },
            "usage": {"include": True},
        }
        fallbacks = [m for m in options.availability_fallbacks if m != request.model]
        if fallbacks:
            payload["models"] = [request.model, *fallbacks]
        else:
            payload["model"] = request.model
        return payload


_STATEMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["currency", "card_last4", "movements"],
    "properties": {
        "currency": _NULLABLE_STRING,
        "card_last4": _NULLABLE_STRING,
        "movements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["date", "description", "reference", "amount"],
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "description": {"type": "string"},
                    "reference": _NULLABLE_STRING,
                    "amount": {"type": "number", "description": "Charges negative, credits positive"},
                },
            },
        },
    },
}


class OpenRouterStatementExtractor(_OpenRouter):
    """Lee un extracto bancario en PDF y lo entrega como tabla con columnas fijas (decisión 7.9). La IA
    solo transcribe movimientos; el cruce lo hace el código."""

    async def extract(self, content: bytes, model: str, options: ExtractionOptions) -> StatementTable:
        payload: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": self._instructions(options.prompt_version)},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Transcribe every movement of this bank statement."},
                        _file_part(content, "application/pdf", "statement.pdf"),
                    ],
                },
            ],
            "temperature": 0,
            "max_tokens": options.max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "statement_extraction", "strict": True, "schema": _STATEMENT_SCHEMA},
            },
            "reasoning": {"effort": options.reasoning_off, "exclude": True},
            "provider": {
                "sort": "latency",
                "data_collection": "deny",
                "require_parameters": True,
                "zdr": options.zero_data_retention,
            },
            "usage": {"include": True},
        }
        fallbacks = [m for m in options.availability_fallbacks if m != model]
        if fallbacks:
            payload["models"] = [model, *fallbacks]
        else:
            payload["model"] = model
        data, _, parsed, _ = await self._ask(payload)
        usage = data.get("usage") or {}
        rows: list[list[str]] = [["fecha", "descripcion", "referencia", "valor"]]
        for item in (parsed.get("movements") or [])[:2000]:
            if not isinstance(item, dict):
                continue
            day, amount = _date(item.get("date")), _decimal(item.get("amount"))
            if day is None or amount is None:
                continue
            reference = _text(item.get("reference"), 120) or ""
            rows.append([day.isoformat(), _text(item.get("description"), 300) or "", reference, format(amount, "f")])
        currency = _text(parsed.get("currency"), 3)
        last4 = _text(parsed.get("card_last4"), 4)
        return StatementTable(
            rows=rows,
            currency=currency.upper() if currency else None,
            card_last4=last4 if last4 and last4.isdigit() and len(last4) == 4 else None,
            model_used=data.get("model"),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            cached_tokens=(usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
            cost_usd=_decimal(usage.get("cost")),
        )


def _file_part(content: bytes, mime_type: str, filename: str = "invoice.pdf") -> dict[str, Any]:
    encoded = base64.b64encode(content).decode()
    if mime_type == "application/pdf":
        return {"type": "file", "file": {"filename": filename, "file_data": f"data:application/pdf;base64,{encoded}"}}
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}}


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    return text.strip()


def _decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _text(value: Any, max_len: int) -> str | None:
    return str(value).strip()[:max_len] or None if value not in (None, "") else None


def _enum(enum_cls, value: Any, default):  # type: ignore[no-untyped-def]
    try:
        return enum_cls(value)
    except ValueError:
        return default


def _time(value: Any) -> clock_time | None:
    try:
        return clock_time.fromisoformat(str(value)[:5]) if value else None
    except ValueError:
        return None


def _taxes(raw: Any) -> tuple[TaxItem, ...]:
    taxes = []
    for item in (raw or [])[:10]:
        if not isinstance(item, dict):
            continue
        amount = _decimal(item.get("amount"))
        if amount is None:
            continue
        taxes.append(
            TaxItem(
                _enum(TaxType, item.get("type"), TaxType.OTHER), amount, _decimal(item.get("rate")), _decimal(item.get("base"))
            )
        )
    return tuple(taxes)


def _document(raw: dict[str, Any]) -> InvoiceData:
    """Mapeo defensivo: la salida del modelo es un dato no confiable y cada campo se valida aquí."""
    confidence = raw.get("confidence")
    lines = tuple(
        InvoiceLine(
            description=_text(line.get("description"), 300) or "",
            amount=_decimal(line.get("amount")),
            quantity=_decimal(line.get("quantity")),
            concept_code=_text(line.get("concept_code"), 40),
            concept_confidence=_confidence(line.get("concept_confidence")),
        )
        for line in (raw.get("lines") or [])[:100]
        if isinstance(line, dict)
    )
    currency = _text(raw.get("currency"), 3)
    country = _text(raw.get("country"), 2)
    taxes = _taxes(raw.get("taxes"))
    tax_amount = _decimal(raw.get("tax_amount"))
    if tax_amount is None and taxes:
        tax_amount = sum((t.amount for t in taxes), Decimal(0))
    return InvoiceData(
        document_type=_enum(DocumentType, raw.get("document_type"), DocumentType.OTHER),
        vendor_name=_text(raw.get("vendor_name"), 300),
        vendor_tax_id=_text(raw.get("vendor_tax_id"), 40),
        invoice_number=_text(raw.get("invoice_number"), 80),
        invoice_date=_date(raw.get("invoice_date")),
        invoice_time=_time(raw.get("invoice_time")),
        currency=currency.upper() if currency else None,
        subtotal=_decimal(raw.get("subtotal")),
        tax_amount=tax_amount,
        tip_amount=_decimal(raw.get("tip_amount")),
        total=_decimal(raw.get("total")),
        fiscal_id=_text(raw.get("fiscal_id"), 120),
        buyer_tax_id=_text(raw.get("buyer_tax_id"), 40),
        country=country.upper() if country else None,
        category=_text(raw.get("category"), 40),
        description=_text(raw.get("description"), 1000),
        itemized=bool(raw.get("itemized")),
        is_receipt=raw.get("is_receipt") is not False,
        confidence=_confidence(confidence) or 0.0,
        lines=lines,
        taxes=taxes,
    )


def _confidence(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return max(0.0, min(1.0, float(value)))
