"""Lo que hace Meta del otro lado del endpoint de datos de los Flows: cifra la petición con la llave
pública del negocio y descifra la respuesta con la llave AES y el vector invertido."""

from __future__ import annotations

import json
import os
from base64 import b64decode, b64encode
from dataclasses import dataclass
from functools import cache
from typing import Any

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.adapters.inbound.whatsapp.flow_crypto import FlowCrypto
from app.adapters.inbound.whatsapp.signature import sign
from tests.conftest import APP_SECRET, Harness

_OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


@cache
def private_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return pem.decode()


@dataclass(frozen=True)
class Sealed:
    body: dict[str, str]
    aes_key: bytes
    iv: bytes

    def open(self, response_text: str) -> dict[str, Any]:
        flipped = bytes(b ^ 0xFF for b in self.iv)
        opened: dict[str, Any] = json.loads(AESGCM(self.aes_key).decrypt(flipped, b64decode(response_text), None))
        return opened


def seal(payload: dict[str, Any], pem: str | None = None) -> Sealed:
    public = serialization.load_pem_private_key((pem or private_key_pem()).encode(), password=None).public_key()
    assert isinstance(public, rsa.RSAPublicKey)
    aes_key, iv = os.urandom(16), os.urandom(16)
    body = {
        "encrypted_flow_data": b64encode(AESGCM(aes_key).encrypt(iv, json.dumps(payload).encode(), None)).decode(),
        "encrypted_aes_key": b64encode(public.encrypt(aes_key, _OAEP)).decode(),
        "initial_vector": b64encode(iv).decode(),
    }
    return Sealed(body, aes_key, iv)


def enable_flow_endpoint(harness: Harness) -> None:
    harness.container.flow_crypto = FlowCrypto(private_key_pem())


async def post_flow(harness: Harness, body: dict[str, Any], secret: str = APP_SECRET) -> httpx.Response:
    raw = json.dumps(body).encode()
    headers = {"Content-Type": "application/json", "X-Hub-Signature-256": sign(raw, secret)}
    return await harness.client.post("/webhooks/whatsapp/flows", content=raw, headers=headers)


async def exchange(harness: Harness, payload: dict[str, Any]) -> dict[str, Any]:
    sealed = seal(payload)
    response = await post_flow(harness, sealed.body)
    assert response.status_code == 200, response.status_code
    return sealed.open(response.text)
