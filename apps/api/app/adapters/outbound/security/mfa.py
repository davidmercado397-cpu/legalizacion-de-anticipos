"""Segundo factor TOTP (RFC 6238, apps como Google Authenticator) y cifrado del secreto en la BD."""

from __future__ import annotations

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from app.domain.errors import AuthenticationError


class PyotpTotp:
    def __init__(self, issuer: str) -> None:
        self._issuer = issuer

    def new_secret(self) -> str:
        return pyotp.random_base32()

    def provisioning_uri(self, secret: str, account: str) -> str:
        return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=self._issuer)

    def verify(self, secret: str, code: str) -> bool:
        # Se acepta una ventana antes y después (±30 s) por diferencias de reloj del celular.
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)


class FernetCipher:
    def __init__(self, key: str) -> None:
        self._fernet = Fernet(key.encode())

    def encrypt(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken as exc:
            # Pasa si se cambió MFA_ENCRYPTION_KEY sin re-enrolar: hay que restablecer el MFA del usuario.
            raise AuthenticationError("MFA secret cannot be decrypted", code="mfa_unavailable") from exc
