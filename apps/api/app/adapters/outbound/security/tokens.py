"""Access tokens JWT de corta duración y refresh tokens opacos."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app.domain.entities import Employee
from app.domain.enums import Role
from app.domain.errors import AuthenticationError
from app.domain.ports import AccessClaims, FlowClaims

_ALGORITHM = "HS256"
_ISSUER = "anticipos-gastos-api"
_ACCESS = "access"
_MFA = "mfa"
_FLOW = "flow"


class JwtTokenService:
    def __init__(self, secret: str, access_ttl_seconds: int, mfa_challenge_ttl_seconds: int, flow_ttl_seconds: int) -> None:
        self._secret = secret
        self._ttl = access_ttl_seconds
        self._mfa_ttl = mfa_challenge_ttl_seconds
        self._flow_ttl = flow_ttl_seconds

    def issue_access_token(self, employee: Employee) -> tuple[str, int]:
        return self._issue(employee, _ACCESS, self._ttl), self._ttl

    def decode_access_token(self, token: str) -> AccessClaims:
        return self._decode(token, _ACCESS)

    def issue_mfa_challenge(self, employee: Employee) -> tuple[str, int]:
        return self._issue(employee, _MFA, self._mfa_ttl), self._mfa_ttl

    def decode_mfa_challenge(self, token: str) -> AccessClaims:
        return self._decode(token, _MFA)

    def issue_flow_token(self, employee_id: uuid.UUID, purpose: str, entity_id: str | None) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(employee_id),
            "typ": _FLOW,
            "flow": purpose,
            "ent": entity_id,
            "jti": uuid.uuid4().hex,
            "iss": _ISSUER,
            "iat": now,
            "exp": now + timedelta(seconds=self._flow_ttl),
        }
        return jwt.encode(payload, self._secret, algorithm=_ALGORITHM)

    def decode_flow_token(self, token: str) -> FlowClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[_ALGORITHM],
                issuer=_ISSUER,
                options={"require": ["sub", "exp", "iat", "typ", "flow"]},
            )
            if payload["typ"] != _FLOW:
                raise ValueError("wrong token purpose")
            return FlowClaims(uuid.UUID(payload["sub"]), str(payload["flow"]), payload.get("ent"))
        except (jwt.PyJWTError, ValueError, KeyError) as exc:
            raise AuthenticationError("Invalid or expired flow token") from exc

    def _issue(self, employee: Employee, purpose: str, ttl: int) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": str(employee.id),
            "role": str(employee.role),
            "ver": employee.token_version,
            "typ": purpose,
            "jti": uuid.uuid4().hex,
            "iss": _ISSUER,
            "iat": now,
            "exp": now + timedelta(seconds=ttl),
        }
        return jwt.encode(payload, self._secret, algorithm=_ALGORITHM)

    def _decode(self, token: str, purpose: str) -> AccessClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[_ALGORITHM],  # fijo: nunca se acepta "none" ni otro algoritmo
                issuer=_ISSUER,
                options={"require": ["sub", "exp", "iat", "ver", "role", "typ"]},
            )
            # El propósito evita usar el token del segundo factor como access token (y al revés).
            if payload["typ"] != purpose:
                raise ValueError("wrong token purpose")
            return AccessClaims(uuid.UUID(payload["sub"]), Role(payload["role"]), int(payload["ver"]))
        except (jwt.PyJWTError, ValueError, KeyError) as exc:
            raise AuthenticationError("Invalid or expired token") from exc

    def new_opaque_token(self) -> str:
        return secrets.token_urlsafe(48)

    def hash_opaque_token(self, token: str) -> str:
        # Hash con llave: con solo la base de datos filtrada no se pueden falsificar ni verificar tokens/códigos.
        return hmac.new(self._secret.encode(), token.encode(), hashlib.sha256).hexdigest()
