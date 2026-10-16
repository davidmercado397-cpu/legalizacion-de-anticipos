"""Firma del webhook de Meta: X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(body crudo, app secret).

Se verifica sobre los bytes CRUDOS (el JSON re-serializado no coincidiría) y se compara en tiempo constante."""

from __future__ import annotations

import hashlib
import hmac

_PREFIX = "sha256="


def sign(raw_body: bytes, secret: str) -> str:
    return _PREFIX + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()


def verify_signature(raw_body: bytes, header: str | None, secret: str) -> bool:
    if not secret or not header:
        return False
    return hmac.compare_digest(sign(raw_body, secret), header.strip())
