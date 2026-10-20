"""Llave del endpoint de datos de WhatsApp Flows (el Flow de solicitar anticipo la necesita).

    python -m scripts.flows_public_key --generar   # imprime una llave privada nueva para WHATSAPP_FLOWS_PRIVATE_KEY
    python -m scripts.flows_public_key             # registra en Meta la llave pública de la configurada

Meta cifra cada petición al endpoint con la llave pública registrada en el número de WhatsApp; la API la
descifra con WHATSAPP_FLOWS_PRIVATE_KEY. Si se cambia la llave privada, hay que volver a registrarla.
"""

from __future__ import annotations

import asyncio
import sys

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.adapters.inbound.whatsapp.flow_crypto import FlowCrypto
from app.config import get_settings


def new_private_key() -> str:
    """PEM en una sola línea (con "\\n" escritos), listo para pegar en el .env."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return pem.decode().strip().replace("\n", "\\n")


async def register() -> int:
    s = get_settings()
    missing = [
        name
        for name, value in (
            ("WHATSAPP_FLOWS_PRIVATE_KEY", s.WHATSAPP_FLOWS_PRIVATE_KEY),
            ("WHATSAPP_ACCESS_TOKEN", s.WHATSAPP_ACCESS_TOKEN),
            ("WHATSAPP_PHONE_NUMBER_ID", s.WHATSAPP_PHONE_NUMBER_ID),
        )
        if not value
    ]
    if missing:
        print(f"Faltan variables: {', '.join(missing)}.")
        return 1
    public_key = FlowCrypto(s.WHATSAPP_FLOWS_PRIVATE_KEY, s.WHATSAPP_FLOWS_PRIVATE_KEY_PASSPHRASE).public_key_pem()
    url = f"https://graph.facebook.com/{s.GRAPH_API_VERSION}/{s.WHATSAPP_PHONE_NUMBER_ID}/whatsapp_business_encryption"
    headers = {"Authorization": f"Bearer {s.WHATSAPP_ACCESS_TOKEN}"}
    async with httpx.AsyncClient(timeout=30.0) as http:
        sent = await http.post(url, headers=headers, data={"business_public_key": public_key})
        if sent.status_code != 200:
            print(f"Meta rechazó la llave ({sent.status_code}): {sent.text}")
            return 1
        status = (await http.get(url, headers=headers)).json()
    print("Llave pública registrada en Meta.")
    print(f"Estado de la firma: {(status.get('data') or [{}])[0].get('business_public_key_signature_status', '?')}")
    return 0


def main() -> int:
    if "--generar" in sys.argv:
        print("Pegue esta línea en el .env (es secreta, no la comparta):\n")
        print(f'WHATSAPP_FLOWS_PRIVATE_KEY="{new_private_key()}"')
        return 0
    return asyncio.run(register())


if __name__ == "__main__":
    raise SystemExit(main())
