"""Diagnóstico de la conexión con la IA (OpenRouter): dice qué falla y cómo arreglarlo. Revisa la clave, los
créditos, que los modelos de la configuración del sistema existan y hace una lectura mínima con cada uno, con
las mismas restricciones de proveedor que la lectura real (retención cero, sin recolección de datos).

    python -m scripts.check_ai
    docker compose exec api python -m scripts.check_ai      # en Docker local
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.adapters.outbound.openrouter import provider_reason
from app.config import get_settings
from scripts.runtime import reading_config

_HINTS = {
    401: "La clave no es válida: cópiela de nuevo desde openrouter.ai/settings/keys.",
    402: "La cuenta de OpenRouter no tiene créditos: recárguela en openrouter.ai/settings/credits.",
    403: "La clave llegó a su límite de gasto o el contenido fue bloqueado: revise el límite de la clave en OpenRouter.",
    404: (
        "Ningún proveedor de ese modelo cumple las restricciones (retención cero de datos, sin recolección). "
        "Revise openrouter.ai/settings/privacy, cambie el modelo o desactive ai.zero_data_retention."
    ),
    429: "OpenRouter está limitando las peticiones: espere un minuto y vuelva a intentar.",
}
_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["ok"], "properties": {"ok": {"type": "boolean"}}}


def _key_problem(key: str) -> str | None:
    if not key:
        return (
            "OPENROUTER_API_KEY está vacía dentro de la API. Póngala en el .env de la carpeta donde está "
            "docker-compose.yml y recree el contenedor con «docker compose up -d» (restart no relee el .env)."
        )
    if key != key.strip() or key[0] in "\"'":
        return "La clave tiene espacios o comillas de más: en el .env escríbala sin comillas, OPENROUTER_API_KEY=sk-or-..."
    if not key.startswith("sk-or-"):
        return (
            "No parece una clave de OpenRouter (empiezan por «sk-or-»). Las claves de OpenAI, Anthropic o Google no "
            "sirven aquí: la API habla solo con OpenRouter."
        )
    return None


def _failure(response: httpx.Response) -> str:
    hint = _HINTS.get(response.status_code, "")
    return f"OpenRouter respondió {response.status_code}: {provider_reason(response)}" + (f"\n    → {hint}" if hint else "")


async def _try_model(http: httpx.AsyncClient, base: str, headers: dict[str, str], model: str, zdr: bool) -> str | None:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": 'Answer exactly {"ok": true}'}],
        "max_tokens": 50,
        "temperature": 0,
        "response_format": {"type": "json_schema", "json_schema": {"name": "check", "strict": True, "schema": _SCHEMA}},
        "provider": {"data_collection": "deny", "require_parameters": True, "zdr": zdr},
    }
    response = await http.post(f"{base}/chat/completions", json=payload, headers=headers)
    return None if response.is_success else _failure(response)


async def main() -> int:
    settings = get_settings()
    key = settings.OPENROUTER_API_KEY
    base = settings.OPENROUTER_BASE_URL.rstrip("/")
    if problem := _key_problem(key):
        print(f"✗ {problem}")
        return 1
    print(f"✓ Clave cargada ({key[:9]}…{key[-4:]})")
    headers = {"Authorization": f"Bearer {key}"}
    engine, config_provider = reading_config(settings)
    try:
        config = await config_provider()
    finally:
        await engine.dispose()

    async with httpx.AsyncClient(timeout=60) as http:
        try:
            response = await http.get(f"{base}/key", headers=headers)
        except httpx.HTTPError as exc:
            print(f"✗ No hay conexión con {base} ({type(exc).__name__}): revise el internet, un proxy o un firewall.")
            return 1
        if not response.is_success:
            print(f"✗ {_failure(response)}")
            return 1
        data = response.json().get("data", {})
        remaining = data.get("limit_remaining")
        print(
            f"✓ OpenRouter acepta la clave «{data.get('label', '')}»"
            + (f"; le quedan USD {remaining}" if remaining is not None else "")
        )

        available = {m["id"] for m in (await http.get(f"{base}/models")).json().get("data", [])}
        settings_keys = {
            "ai.primary_model": config.primary_model,
            "ai.lite_model": config.lite_model,
            "ai.fallback_model": config.fallback_model,
        }
        settings_keys |= {f"ai.availability_fallbacks[{i}]": m for i, m in enumerate(config.extraction.availability_fallbacks)}
        failures = 0
        for setting, model in settings_keys.items():
            if model not in available:
                failures += 1
                print(f"✗ {setting} = {model}: ese modelo no existe en OpenRouter.")
                print("    → Cámbielo como superadmin en Plataforma → Configuración (vea los nombres en openrouter.ai/models).")
        for model in dict.fromkeys(m for m in settings_keys.values() if m in available):
            if problem := await _try_model(http, base, headers, model, config.extraction.zero_data_retention):
                failures += 1
                print(f"✗ {model}: {problem}")
            else:
                print(f"✓ {model} responde")
    print("\nTodo listo: suba una factura nueva para probar." if failures == 0 else f"\n{failures} problema(s) por resolver.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
