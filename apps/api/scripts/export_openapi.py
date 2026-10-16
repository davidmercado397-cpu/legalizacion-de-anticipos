"""Exporta el contrato OpenAPI para el frontend (packages/contracts genera sus tipos desde este archivo).
El CI verifica que el archivo versionado coincida con la API.

Uso: python -m scripts.export_openapi
"""

from __future__ import annotations

import json
import os
import pathlib

OUTPUT = pathlib.Path(__file__).resolve().parents[3] / "packages" / "contracts" / "openapi.json"


def main() -> None:
    # La app valida secretos al arrancar; para leer el contrato bastan valores de relleno.
    os.environ.setdefault("JWT_SECRET", "x" * 32)
    os.environ.setdefault("MFA_ENCRYPTION_KEY", "x" * 44)
    os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
    os.environ["ENABLE_DOCS"] = "true"
    from app.main import create_app

    spec = create_app(run_jobs=False).openapi()
    OUTPUT.write_text(json.dumps(spec, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Contrato en {OUTPUT}")


if __name__ == "__main__":
    main()
