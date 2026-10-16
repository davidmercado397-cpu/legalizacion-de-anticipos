"""Set de evaluación de la lectura de facturas: mide qué tan bien lee cada campo un modelo o una
versión del prompt, con su costo y su tiempo. Todo cambio de modelo o de prompt se mide antes y después.

    python -m scripts.extraction_eval /ruta/al/dataset
    python -m scripts.extraction_eval /ruta/al/dataset --model google/gemini-3.5-flash-lite --min-accuracy 0.9
    python -m scripts.extraction_eval /ruta/al/dataset --prompt-version v2 --json resultado.json

El dataset vive FUERA del repositorio (son facturas reales): una carpeta con las fotos y un
`expected.json` con lo que dice cada factura (formato en docs/eval_dataset_example.json). Devuelve
código de salida 1 si la precisión total queda por debajo de --min-accuracy (sirve en CI)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx

from app.config import get_settings
from app.container import build_extractor, build_reader
from app.domain.files import detect_mime
from app.domain.fiscal import same_tax_id
from app.domain.ports import ExtractionContext
from app.domain.values import InvoiceData
from scripts.runtime import reading_config

FIELDS = ("vendor_name", "vendor_tax_id", "invoice_number", "invoice_date", "currency", "total", "category")


def _text(value: Any) -> str:
    plain = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in plain if ch.isalnum())


def _number(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def field_matches(name: str, expected: Any, got: Any) -> bool:
    """Comparación tolerante a formato: el NIT con o sin DV, montos con 1 unidad de margen, textos sin
    tildes, mayúsculas ni puntuación."""
    if expected is None:
        return got is None
    if got is None:
        return False
    if name == "vendor_tax_id":
        return same_tax_id(str(expected), str(got))
    if name == "total":
        a, b = _number(expected), _number(got)
        return a is not None and b is not None and abs(a - b) <= 1
    return _text(expected) == _text(got)


def score(expected: dict[str, Any], doc: InvoiceData | None) -> dict[str, bool]:
    return {
        name: field_matches(name, expected.get(name), getattr(doc, name, None) if doc else None)
        for name in FIELDS
        if name in expected
    }


@dataclass
class Summary:
    documents: int = 0
    hits: dict[str, int] = field(default_factory=dict)
    totals: dict[str, int] = field(default_factory=dict)
    cost_usd: Decimal = Decimal(0)
    latency_ms: list[int] = field(default_factory=list)
    failures: list[dict[str, Any]] = field(default_factory=list)

    def add(self, file: str, result: dict[str, bool], cost: Decimal, latency: int) -> None:
        self.documents += 1
        self.cost_usd += cost
        self.latency_ms.append(latency)
        for name, ok in result.items():
            self.totals[name] = self.totals.get(name, 0) + 1
            self.hits[name] = self.hits.get(name, 0) + int(ok)
        wrong = [name for name, ok in result.items() if not ok]
        if wrong:
            self.failures.append({"file": file, "fields": wrong})

    @property
    def accuracy(self) -> float:
        total = sum(self.totals.values())
        return sum(self.hits.values()) / total if total else 0.0

    def report(self) -> dict[str, Any]:
        return {
            "documents": self.documents,
            "accuracy": round(self.accuracy, 4),
            "by_field": {name: round(self.hits[name] / self.totals[name], 4) for name in self.totals},
            "cost_usd": str(self.cost_usd),
            "avg_latency_ms": int(sum(self.latency_ms) / len(self.latency_ms)) if self.latency_ms else None,
            "failures": self.failures,
        }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--model", help="Un solo modelo para todo (sin ruteo ni escalamiento)")
    parser.add_argument("--routing", choices=["by_difficulty", "always_primary"])
    parser.add_argument("--prompt-version", help="p. ej. v2 para comparar con la versión actual")
    parser.add_argument("--min-accuracy", type=float, default=0.0)
    parser.add_argument("--json", type=Path, help="Guarda el reporte en este archivo")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.OPENROUTER_API_KEY:
        print("Set OPENROUTER_API_KEY first", file=sys.stderr)
        return 2
    cases = json.loads((args.dataset / "expected.json").read_text(encoding="utf-8"))
    engine, config = reading_config(settings, args.routing, args.prompt_version)
    summary = Summary()
    async with httpx.AsyncClient(http2=True, timeout=90) as http:
        reader = build_reader(build_extractor(settings, http), config)
        for case in cases:
            content = (args.dataset / case["file"]).read_bytes()
            mime = detect_mime(content)
            if mime is None:
                summary.failures.append({"file": case["file"], "fields": ["unsupported_file"]})
                continue
            context = ExtractionContext(case.get("company", "Forsa"), case.get("country", "CO"), case.get("currency", "COP"))
            outcome = await reader.read(content, mime, context, date.today(), model_override=args.model)
            cost = sum((a.response.cost_usd or Decimal(0) for a in outcome.attempts if a.response), Decimal(0))
            doc = outcome.documents[0] if outcome.documents else None
            summary.add(case["file"], score(case["expected"], doc), cost, outcome.timings.get("total_ms", 0))
    await engine.dispose()
    report = {"model": args.model, "routing": args.routing, "prompt_version": args.prompt_version, **summary.report()}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.json:
        args.json.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return 1 if summary.accuracy < args.min_accuracy else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
