"""Alta y restablecimiento del segundo factor (TOTP). Es obligatorio para los roles con privilegios
(MFA_REQUIRED_ROLES): mientras no lo activen, solo pueden usar /me y el alta del MFA."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass

from app.application.access import AccessPolicy
from app.application.auth import AuthService
from app.domain.entities import AuditEntry, Employee
from app.domain.enums import Role
from app.domain.errors import InvalidOperationError, NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import Clock, SecretCipher, TokenService, TotpService, UnitOfWork, UnitOfWorkFactory


@dataclass(frozen=True)
class MfaSetup:
    secret: str
    provisioning_uri: str


class MfaService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        auth: AuthService,
        totp: TotpService,
        cipher: SecretCipher,
        tokens: TokenService,
        clock: Clock,
        recovery_codes: int,
    ) -> None:
        self._uow = uow
        self._access = access
        self._auth = auth
        self._totp = totp
        self._cipher = cipher
        self._tokens = tokens
        self._clock = clock
        self._recovery_codes = recovery_codes

    async def setup(self, actor: Employee) -> MfaSetup:
        """Mientras no se active, repetir la configuración devuelve la misma semilla: una recarga de la página o
        una petición doble no deja inservible el QR que ya se escaneó."""
        async with self._uow() as uow:
            employee = await self._load_self(uow, actor)
            if employee.mfa_secret is not None and not employee.mfa_enabled:
                secret = self._cipher.decrypt(employee.mfa_secret)
            else:
                secret = self._totp.new_secret()
                employee.start_mfa_setup(self._cipher.encrypt(secret))
                await uow.audit.add(AuditEntry("mfa_setup_started", "employee", str(employee.id), employee.id))
                await uow.commit()
        return MfaSetup(secret, self._totp.provisioning_uri(secret, actor.email))

    async def enable(self, actor: Employee, code: str) -> list[str]:
        """Activa el MFA con el primer código de la app y devuelve los códigos de recuperación (se
        muestran una sola vez; en la BD solo queda su hash)."""
        codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(self._recovery_codes)]
        async with self._uow() as uow:
            employee = await self._load_self(uow, actor)
            if employee.mfa_enabled:
                raise InvalidOperationError("MFA already enabled", code="mfa_already_enabled")
            if employee.mfa_secret is None:
                raise InvalidOperationError("MFA setup not started", code="mfa_setup_not_started")
            if not self._totp.verify(self._cipher.decrypt(employee.mfa_secret), code):
                raise ValidationError("Invalid MFA code", code="invalid_mfa_code")
            employee.enable_mfa([self._tokens.hash_opaque_token(c) for c in codes])
            await uow.refresh_tokens.revoke_all_for(employee.id, self._clock.now())
            await uow.audit.add(AuditEntry("mfa_enabled", "employee", str(employee.id), employee.id))
            await uow.commit()
        await self._auth.forget()
        return codes

    async def reset(self, actor: Employee, employee_id: uuid.UUID) -> None:
        """Para un celular perdido: el usuario deberá volver a activar el MFA al entrar."""
        self._access.require(actor, Permission.USERS_MANAGE)
        if employee_id == actor.id:
            raise InvalidOperationError("Nobody resets their own MFA", code="mfa_self_reset")
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
            if employee is None or employee.role == Role.SUPERADMIN:
                raise NotFoundError("employee")
            self._access.ensure_view(actor, employee, employee.primary_company_id, "employee")
            employee.reset_mfa()
            await uow.refresh_tokens.revoke_all_for(employee.id, self._clock.now())
            await uow.audit.add(AuditEntry("mfa_reset", "employee", str(employee.id), actor.id))
            await uow.commit()
        await self._auth.forget()

    @staticmethod
    async def _load_self(uow: UnitOfWork, actor: Employee) -> Employee:
        employee = await uow.employees.get(actor.id)
        if employee is None:
            raise NotFoundError("employee")
        return employee
