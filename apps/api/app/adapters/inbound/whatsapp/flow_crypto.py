"""Cifrado del endpoint de datos de WhatsApp Flows.

Meta cifra cada petición con una llave AES-128-GCM nueva y manda esa llave cifrada con la llave pública
del negocio (RSA-OAEP con SHA-256). La respuesta va con la misma llave AES y el vector de inicialización
invertido (cada byte XOR 0xFF), en base64. Ver
https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint"""

from __future__ import annotations

import binascii
import json
from base64 import b64decode, b64encode
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


class FlowDecryptionError(Exception):
    """La petición no se pudo descifrar: Meta debe volver a leer la llave pública (HTTP 421)."""


@dataclass(frozen=True)
class FlowRequest:
    payload: dict[str, Any]
    aes_key: bytes
    iv: bytes


class FlowCrypto:
    def __init__(self, private_key_pem: str, passphrase: str | None = None) -> None:
        # En el .env la llave suele ir en una sola línea con "\n" escritos.
        pem = private_key_pem.replace("\\n", "\n").encode()
        key = serialization.load_pem_private_key(pem, password=passphrase.encode() if passphrase else None)
        if not isinstance(key, rsa.RSAPrivateKey):
            raise ValueError("WHATSAPP_FLOWS_PRIVATE_KEY must be an RSA private key")
        self._key = key

    def public_key_pem(self) -> str:
        return (
            self._key.public_key()
            .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
            .decode()
        )

    def decrypt(self, body: dict[str, Any]) -> FlowRequest:
        try:
            aes_key = self._key.decrypt(b64decode(body["encrypted_aes_key"]), _OAEP)
            iv = b64decode(body["initial_vector"])
            plain = AESGCM(aes_key).decrypt(iv, b64decode(body["encrypted_flow_data"]), None)
            payload = json.loads(plain)
        except (KeyError, TypeError, ValueError, InvalidTag, binascii.Error) as exc:
            raise FlowDecryptionError from exc
        if not isinstance(payload, dict):
            raise FlowDecryptionError
        return FlowRequest(payload, aes_key, iv)

    @staticmethod
    def encrypt(response: dict[str, Any], request: FlowRequest) -> str:
        flipped = bytes(b ^ 0xFF for b in request.iv)
        return b64encode(AESGCM(request.aes_key).encrypt(flipped, json.dumps(response).encode(), None)).decode()
