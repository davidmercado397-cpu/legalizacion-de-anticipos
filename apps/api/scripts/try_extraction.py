"""Prueba manual rápida de la lectura con fotos reales de facturas (sin WhatsApp). Usa la
configuración del sistema guardada en la BD (DATABASE_URL con las migraciones aplicadas).

    OPENROUTER_API_KEY=sk-or-... python -m scripts.try_extraction foto1.jpg foto2.jpg foto3.pdf
    python -m scripts.try_extraction foto1.jpg --model google/gemini-3.5-flash-lite
    python -m scripts.try_extraction foto1.jpg --routing always_primary

Imprime, por archivo: si se leyó el QR fiscal, los modelos usados, si escaló, los problemas de
verificación, los documentos extraídos, los tiempos y el costo."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx

from app.config import get_settings
from app.container import build_extractor, build_reader
from app.domain.files import detect_mime
from app.domain.ports import ExtractionContext
from scripts.runtime import reading_config


def _default(value: object) -> object:
    if isinstance(value, Decimal | date):
        return str(value)
    return str(value)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--model", help="Force one model for every file (no routing, no escalation)")
    parser.add_argument("--routing", choices=["by_difficulty", "always_primary"])
    parser.add_argument("--company", default="Forsa Colombia")
    parser.add_argument("--country", default="CO")
    parser.add_argument("--currency", default="COP")
    args = parser.parse_args()

    settings = get_settings()
    if not settings.OPENROUTER_API_KEY:
        print("Set OPENROUTER_API_KEY first", file=sys.stderr)
        return 2
    engine, config = reading_config(settings, args.routing)

    context = ExtractionContext(args.company, args.country, args.currency)
    total_cost = Decimal(0)
    async with httpx.AsyncClient(http2=True, timeout=60) as http:
        reader = build_reader(build_extractor(settings, http), config)
        for path in args.files:
            content = path.read_bytes()
            mime = detect_mime(content)
            if mime is None:
                print(f"\n== {path}: unsupported file type")
                continue
            outcome = await reader.read(content, mime, context, date.today(), model_override=args.model)
            cost = sum((a.response.cost_usd or Decimal(0) for a in outcome.attempts if a.response), Decimal(0))
            total_cost += cost
            report = {
                "file": str(path),
                "legibility": outcome.legibility,
                "fiscal_qr": asdict(outcome.qr) if outcome.qr else None,
                "attempts": [
                    {
                        "tier": a.tier,
                        "model_requested": a.model_requested,
                        "model_used": a.response.model_used if a.response else None,
                        "latency_ms": a.response.latency_ms if a.response else None,
                        "cost_usd": a.response.cost_usd if a.response else None,
                        "cached_tokens": a.response.cached_tokens if a.response else None,
                        "issues": [f"{i.code}: {i.detail}" for i in a.issues],
                        "escalation_reason": a.escalation_reason,
                        "error": a.error,
                    }
                    for a in outcome.attempts
                ],
                "escalated": outcome.escalated,
                "documents": [asdict(d) for d in outcome.documents],
                "warnings": outcome.warnings,
                "timings_ms": outcome.timings,
            }
            print(f"\n== {path}")
            print(json.dumps(report, indent=2, ensure_ascii=False, default=_default))
    await engine.dispose()
    print(f"\nTotal AI cost: USD {total_cost}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
