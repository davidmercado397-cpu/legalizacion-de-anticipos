"""Diagnóstico del almacenamiento de archivos (Cloudflare R2): guarda y lee un archivo de prueba con la configuración
de la API y, si falla, dice qué variable revisar.

    python -m scripts.check_storage
    docker compose exec api python -m scripts.check_storage      # en Docker local
"""

from __future__ import annotations

import asyncio
from urllib.parse import urlparse

from app.adapters.outbound.storage import R2Storage
from app.config import get_settings
from app.domain.errors import DomainError

KEY = "diagnostico/prueba.txt"
_HINTS = {
    "InvalidAccessKeyId": "R2_ACCESS_KEY_ID no existe: cópielo de nuevo del token de R2.",
    "SignatureDoesNotMatch": "R2_SECRET_ACCESS_KEY no corresponde a esa llave (o tiene espacios de más).",
    "NoSuchBucket": "R2_BUCKET no existe en esa cuenta: escriba el nombre exacto del bucket.",
    "AccessDenied": "El token no puede escribir en ese bucket: en R2 dele «Object Read & Write» sobre él.",
    "Unauthorized": "El token no puede escribir en ese bucket: en R2 dele «Object Read & Write» sobre él.",
    "EndpointConnectionError": "No hay conexión con R2_ENDPOINT_URL: revise la dirección y la salida a internet.",
}


def config_problems(endpoint: str, bucket: str, access_key: str, secret: str) -> list[str]:
    missing = [
        name
        for name, value in (
            ("R2_ENDPOINT_URL", endpoint),
            ("R2_BUCKET", bucket),
            ("R2_ACCESS_KEY_ID", access_key),
            ("R2_SECRET_ACCESS_KEY", secret),
        )
        if not value
    ]
    if missing:
        return [f"Faltan variables: {', '.join(missing)}."]
    problems = []
    url = urlparse(endpoint)
    if url.scheme not in ("http", "https") or not url.netloc:  # http: SeaweedFS en Docker local
        problems.append("R2_ENDPOINT_URL debe empezar por https://")
    if url.path.strip("/"):
        problems.append(
            f"R2_ENDPOINT_URL no lleva el bucket ni otra ruta: use solo {url.scheme}://{url.netloc} y ponga el bucket en R2_BUCKET."
        )
    for name, value in (("R2_BUCKET", bucket), ("R2_ACCESS_KEY_ID", access_key), ("R2_SECRET_ACCESS_KEY", secret)):
        if value != value.strip() or value[0] in "\"'":
            problems.append(f"{name} tiene espacios o comillas de más.")
    return problems


def hint_for(error: str) -> str:
    return next((hint for code, hint in _HINTS.items() if code in error), "")


async def main() -> int:
    s = get_settings()
    if problems := config_problems(s.R2_ENDPOINT_URL, s.R2_BUCKET, s.R2_ACCESS_KEY_ID, s.R2_SECRET_ACCESS_KEY):
        for problem in problems:
            print(f"✗ {problem}")
        return 1
    print(f"✓ Configuración: bucket «{s.R2_BUCKET}» en {s.R2_ENDPOINT_URL}")
    storage = R2Storage(s.R2_ENDPOINT_URL, s.R2_BUCKET, s.R2_ACCESS_KEY_ID, s.R2_SECRET_ACCESS_KEY, s.R2_REGION)
    try:
        await storage.save(KEY, b"prueba", "text/plain")
        print("✓ Guardar un archivo")
        if await storage.read(KEY) != b"prueba":
            print("✗ El archivo leído no es el que se guardó")
            return 1
        print("✓ Leerlo de nuevo")
    except DomainError as exc:
        print(f"✗ {exc}")
        if hint := hint_for(str(exc)):
            print(f"    → {hint}")
        return 1
    print("\nTodo listo: ya se pueden subir facturas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
