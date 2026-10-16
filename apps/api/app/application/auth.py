from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from app.application.cache import SharedCache
from app.domain.entities import AuditEntry, Employee, RefreshToken
from app.domain.errors import AccountLockedError, AuthenticationError, ValidationError
from app.domain.ports import (
    CacheVersions,
    Clock,
    PasswordHasher,
    SecretCipher,
    TokenService,
    TotpService,
    UnitOfWorkFactory,
)


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int
    employee: Employee


@dataclass(frozen=True)
class MfaChallenge:
    """La contraseña fue correcta, pero falta el segundo factor."""

    token: str
    expires_in: int


@dataclass(frozen=True)
class AuthConfig:
    refresh_ttl_days: int
    password_min_length: int
    max_attempts: int
    lock_minutes: int


class PasswordPolicy:
    def __init__(self, min_length: int) -> None:
        self._min = min_length

    def check(self, password: str, email: str | None = None) -> None:
        if len(password) < self._min:
            raise ValidationError("Password too short", code="password_too_short", min=self._min)
        if password.strip() != password or not password.strip():
            raise ValidationError("Password with surrounding spaces", code="password_spaces")
        local = email.split("@")[0].lower() if email else ""
        if len(local) >= 4 and local in password.lower():
            raise ValidationError("Password contains the email", code="password_contains_email")


class AuthService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        hasher: PasswordHasher,
        tokens: TokenService,
        clock: Clock,
        config: AuthConfig,
        versions: CacheVersions,
        totp: TotpService,
        cipher: SecretCipher,
    ) -> None:
        self._totp = totp
        self._cipher = cipher
        self._uow = uow
        self._hasher = hasher
        self._tokens = tokens
        self._clock = clock
        self._config = config
        self.password_policy = PasswordPolicy(config.password_min_length)
        # Caché del actor compartida entre workers: desactivar a alguien o cambiarle la clave surte efecto
        # de inmediato en todos, sin consultar la BD en cada request.
        self._actors: SharedCache[uuid.UUID, Employee | None] = SharedCache("actors", versions, ttl_seconds=60)
        # Para gastar el mismo tiempo cuando el correo no existe (evita enumerar usuarios por timing).
        self._dummy_hash = hasher.hash("dummy-password-for-timing")

    async def login(self, email: str, password: str, ip: str | None) -> TokenPair | MfaChallenge:
        now = self._clock.now()
        async with self._uow() as uow:
            employee = await uow.employees.get_by_email(email)
            if employee is None or not employee.active or not employee.password_hash:
                self._hasher.verify(self._dummy_hash, password)
                await uow.audit.add(AuditEntry("login_failed", "employee", None, data={"email": email, "ip": ip}))
                await uow.commit()
                raise AuthenticationError("Invalid credentials", code="invalid_credentials")
            if employee.is_locked(now):
                assert employee.locked_until is not None
                raise AccountLockedError(int((employee.locked_until - now).total_seconds()) + 1)
            if not self._hasher.verify(employee.password_hash, password):
                employee.register_failed_login(now, self._config.max_attempts, timedelta(minutes=self._config.lock_minutes))
                await uow.audit.add(AuditEntry("login_failed", "employee", str(employee.id), employee.id, data={"ip": ip}))
                await uow.commit()
                raise AuthenticationError("Invalid credentials", code="invalid_credentials")
            if employee.mfa_enabled:
                # Los intentos fallidos no se reinician hasta que el segundo factor también sea correcto.
                await uow.audit.add(AuditEntry("login_password_ok", "employee", str(employee.id), employee.id, data={"ip": ip}))
                await uow.commit()
                token, expires_in = self._tokens.issue_mfa_challenge(employee)
                return MfaChallenge(token, expires_in)
            employee.register_successful_login()
            refresh = self._new_refresh(employee.id, uuid.uuid4())
            await uow.refresh_tokens.add(refresh[1])
            await uow.audit.add(AuditEntry("login", "employee", str(employee.id), employee.id, data={"ip": ip}))
            await uow.commit()
        access, expires_in = self._tokens.issue_access_token(employee)
        return TokenPair(access, refresh[0], expires_in, employee)

    async def verify_mfa(self, challenge: str, code: str, ip: str | None) -> TokenPair:
        claims = self._tokens.decode_mfa_challenge(challenge)
        now = self._clock.now()
        async with self._uow() as uow:
            employee = await uow.employees.get(claims.employee_id)
            if (
                employee is None
                or not employee.active
                or not employee.mfa_enabled
                or employee.mfa_secret is None
                or employee.token_version != claims.token_version
            ):
                raise AuthenticationError("Invalid MFA challenge")
            if employee.is_locked(now):
                assert employee.locked_until is not None
                raise AccountLockedError(int((employee.locked_until - now).total_seconds()) + 1)
            code_hash = self._tokens.hash_opaque_token(code.strip().lower())
            if self._totp.verify(self._cipher.decrypt(employee.mfa_secret), code) and code_hash != employee.mfa_last_code_hash:
                employee.mfa_last_code_hash = code_hash
                method = "totp"
            elif employee.use_recovery_code(code_hash):
                method = "recovery_code"
            else:
                employee.register_failed_login(now, self._config.max_attempts, timedelta(minutes=self._config.lock_minutes))
                await uow.audit.add(AuditEntry("mfa_failed", "employee", str(employee.id), employee.id, data={"ip": ip}))
                await uow.commit()
                raise AuthenticationError("Invalid MFA code", code="invalid_mfa_code")
            employee.register_successful_login()
            plain, refresh = self._new_refresh(employee.id, uuid.uuid4())
            await uow.refresh_tokens.add(refresh)
            await uow.audit.add(AuditEntry("login", "employee", str(employee.id), employee.id, data={"ip": ip, "mfa": method}))
            await uow.commit()
        access, expires_in = self._tokens.issue_access_token(employee)
        return TokenPair(access, plain, expires_in, employee)

    async def refresh(self, refresh_token: str) -> TokenPair:
        now = self._clock.now()
        async with self._uow() as uow:
            stored = await uow.refresh_tokens.get_by_hash(self._tokens.hash_opaque_token(refresh_token))
            if stored is None:
                raise AuthenticationError("Invalid refresh token")
            if stored.rotated_at is not None or stored.revoked_at is not None:
                # Si reutilizan un token ya rotado es porque se filtró: se revoca toda la familia del login.
                await uow.refresh_tokens.revoke_family(stored.family_id, now)
                await uow.audit.add(AuditEntry("refresh_token_reuse", "employee", str(stored.employee_id), stored.employee_id))
                await uow.commit()
                raise AuthenticationError("Invalid refresh token")
            if stored.expires_at <= now:
                raise AuthenticationError("Refresh token expired")
            employee = await uow.employees.get(stored.employee_id)
            if employee is None or not employee.active:
                raise AuthenticationError("Invalid refresh token")
            stored.rotated_at = now
            plain, token = self._new_refresh(employee.id, stored.family_id)
            await uow.refresh_tokens.add(token)
            await uow.commit()
        access, expires_in = self._tokens.issue_access_token(employee)
        return TokenPair(access, plain, expires_in, employee)

    async def logout(self, refresh_token: str) -> None:
        async with self._uow() as uow:
            stored = await uow.refresh_tokens.get_by_hash(self._tokens.hash_opaque_token(refresh_token))
            if stored is not None:
                await uow.refresh_tokens.revoke_family(stored.family_id, self._clock.now())
                await uow.commit()

    async def authenticate(self, access_token: str) -> Employee:
        claims = self._tokens.decode_access_token(access_token)
        employee = await self._actors.get_or_load(claims.employee_id, lambda: self._load_actor(claims.employee_id))
        if employee is None:
            raise AuthenticationError("Invalid token")
        if not employee.active or employee.token_version != claims.token_version:
            raise AuthenticationError("Session revoked")
        return employee

    async def _load_actor(self, employee_id: uuid.UUID) -> Employee | None:
        async with self._uow() as uow:
            return await uow.employees.get(employee_id)

    async def forget(self) -> None:
        """Llamarlo tras cualquier cambio a un empleado: invalida el actor cacheado en todos los workers."""
        await self._actors.invalidate()

    async def change_own_password(self, actor: Employee, current: str, new: str) -> None:
        self.password_policy.check(new, actor.email)
        async with self._uow() as uow:
            employee = await uow.employees.get(actor.id)
            if employee is None or not employee.password_hash or not self._hasher.verify(employee.password_hash, current):
                raise ValidationError("The current password is not correct", code="wrong_current_password")
            employee.change_password(self._hasher.hash(new))
            await uow.refresh_tokens.revoke_all_for(employee.id, self._clock.now())
            await uow.audit.add(AuditEntry("password_changed", "employee", str(employee.id), employee.id))
            await uow.commit()
        await self.forget()

    def _new_refresh(self, employee_id: uuid.UUID, family_id: uuid.UUID) -> tuple[str, RefreshToken]:
        plain = self._tokens.new_opaque_token()
        token = RefreshToken(
            employee_id=employee_id,
            token_hash=self._tokens.hash_opaque_token(plain),
            family_id=family_id,
            expires_at=self._clock.now() + timedelta(days=self._config.refresh_ttl_days),
        )
        return plain, token
