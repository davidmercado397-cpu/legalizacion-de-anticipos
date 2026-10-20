"""Diagnóstico de WhatsApp (Meta): el número, y si la cuenta de WhatsApp Business tiene la app suscrita. Enviar
funciona sin esa suscripción, pero sin ella los mensajes de los usuarios nunca llegan al webhook.

    python -m scripts.check_whatsapp <WABA_ID>               # revisa
    python -m scripts.check_whatsapp <WABA_ID> --suscribir   # suscribe la app del token a la cuenta

El WABA_ID es el «Identificador de la cuenta de WhatsApp Business» (WhatsApp Manager → Información general).
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

import httpx

from app.config import get_settings


def subscription_report(subscribed: list[dict[str, Any]]) -> list[str]:
    if not subscribed:
        return [
            "❌ Ninguna app está suscrita a la cuenta: los mensajes de los usuarios no llegan al webhook.",
            "   Corra de nuevo con --suscribir.",
        ]
    names = ", ".join(str((app.get("whatsapp_business_api_data") or {}).get("name") or "?") for app in subscribed)
    return [f"✅ Apps suscritas a la cuenta: {names}. Debe estar la app del webhook y de WHATSAPP_APP_SECRET."]


async def main(waba_id: str, subscribe: bool) -> int:
    s = get_settings()
    if not (s.WHATSAPP_ACCESS_TOKEN and s.WHATSAPP_PHONE_NUMBER_ID):
        print("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID.")
        return 1
    base = f"https://graph.facebook.com/{s.GRAPH_API_VERSION}"
    headers = {"Authorization": f"Bearer {s.WHATSAPP_ACCESS_TOKEN}"}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as http:
        phone = await http.get(
            f"{base}/{s.WHATSAPP_PHONE_NUMBER_ID}", params={"fields": "display_phone_number,verified_name,quality_rating"}
        )
        if phone.status_code != 200:
            print(f"❌ No se pudo leer el número ({phone.status_code}): {phone.text[:300]}")
            return 1
        info = phone.json()
        print(
            f"✅ Número {info.get('display_phone_number')} ({info.get('verified_name')}), calidad {info.get('quality_rating')}."
        )
        url = f"{base}/{waba_id}/subscribed_apps"
        if subscribe:
            done = await http.post(url)
            print("✅ App suscrita a la cuenta." if done.status_code == 200 else f"❌ Meta no la suscribió: {done.text[:300]}")
        listed = await http.get(url)
        if listed.status_code != 200:
            print(f"❌ No se pudo leer la cuenta {waba_id} ({listed.status_code}): {listed.text[:300]}")
            return 1
        for line in subscription_report(listed.json().get("data") or []):
            print(line)
    return 0


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        raise SystemExit(1)
    raise SystemExit(asyncio.run(main(args[0], "--suscribir" in sys.argv)))
