from __future__ import annotations

import secrets
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.application.access import AccessPolicy
from app.application.auth import AuthService
from app.domain.entities import AuditEntry, Employee
from app.domain.enums import Role, StaffType
from app.domain.errors import ConflictError, InvalidOperationError, NotFoundError, PermissionDeniedError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import Clock, EmployeeFilter, Page, Paged, PasswordHasher, UnitOfWork, UnitOfWorkFactory
from app.domain.values import normalize_phone

_APPROVER_ROLES = (Role.APPROVER, Role.ACCOUNTANT, Role.ADMIN)


@dataclass(frozen=True)
class EmployeeData:
    full_name: str
    email: str
    role: Role
    company_ids: list[uuid.UUID]
    phone: str | None = None
    approver_id: uuid.UUID | None = None
    password: str | None = None  # contraseña temporal; si no llega, se genera una
    staff_type: StaffType | None = None


@dataclass(frozen=True)
class CreatedEmployee:
    employee: Employee
    temporary_password: str


WelcomeSender = Callable[[uuid.UUID], Awaitable[None]]


class EmployeeService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        hasher: PasswordHasher,
        auth: AuthService,
        clock: Clock,
    ) -> None:
        self._uow = uow
        self._access = access
        self._hasher = hasher
        self._auth = auth
        self._clock = clock
        self._welcome: WelcomeSender | None = None

    def on_created(self, sender: WelcomeSender) -> None:
        """Observer para enviar la bienvenida por WhatsApp después de crear el usuario."""
        self._welcome = sender

    async def create(self, actor: Employee, data: EmployeeData) -> CreatedEmployee:
        self._access.require(actor, Permission.USERS_MANAGE)
        _reject_superadmin_role(data.role)
        password = data.password or self._temporary_password()
        self._auth.password_policy.check(password, data.email)
        phone = normalize_phone(data.phone)
        employee = Employee(
            full_name=data.full_name.strip(),
            email=data.email,
            role=data.role,
            phone=phone,
            company_ids=list(dict.fromkeys(data.company_ids)),
            approver_id=data.approver_id,
            staff_type=data.staff_type,
            password_hash=self._hasher.hash(password),
            must_change_password=True,
        )
        async with self._uow() as uow:
            await self._validate(uow, employee)
            await uow.employees.add(employee)
            await uow.audit.add(AuditEntry("user_created", "employee", str(employee.id), actor.id, data={"role": employee.role}))
            await uow.commit()
        if self._welcome and employee.phone:
            await self._welcome(employee.id)
        return CreatedEmployee(employee, password)

    async def search(self, actor: Employee, flt: EmployeeFilter, page: Page) -> Paged[Employee]:
        self._access.require(actor, Permission.USERS_MANAGE)
        async with self._uow() as uow:
            return await uow.employees.find(flt, page)

    async def get(self, actor: Employee, employee_id: uuid.UUID) -> Employee:
        async with self._uow() as uow:
            employee = await uow.employees.get(employee_id)
        if employee is None or (employee.role == Role.SUPERADMIN and actor.id != employee.id):
            raise NotFoundError("employee")
        if actor.id != employee.id:
            self._access.require(actor, Permission.USERS_MANAGE)
        return employee

    async def update(self, actor: Employee, employee_id: uuid.UUID, changes: dict[str, Any]) -> Employee:
        self._access.require(actor, Permission.USERS_MANAGE)
        async with self._uow() as uow:
            employee = await self._load(uow, employee_id)
            before = {k: getattr(employee, k) for k in changes if hasattr(employee, k)}
            if "full_name" in changes:
                employee.full_name = changes["full_name"].strip()
            if "email" in changes:
                employee.email = changes["email"].strip().lower()
            if "phone" in changes:
                employee.set_phone(normalize_phone(changes["phone"]))
            if "role" in changes:
                _reject_superadmin_role(Role(changes["role"]))
                if employee.id == actor.id and changes["role"] != actor.role:
                    raise InvalidOperationError("You cannot change your own role", code="own_role_change")
                employee.role = Role(changes["role"])
                employee.revoke_sessions()  # el token lleva el rol: obliga a iniciar sesión de nuevo
            if "company_ids" in changes:
                employee.company_ids = list(dict.fromkeys(changes["company_ids"]))
            if "approver_id" in changes:
                employee.approver_id = changes["approver_id"]
            if "staff_type" in changes:
                employee.staff_type = StaffType(changes["staff_type"]) if changes["staff_type"] else None
            await self._validate(uow, employee)
            await uow.audit.add(
                AuditEntry("user_updated", "employee", str(employee.id), actor.id, data={"before": before, "changes": changes})
            )
            await uow.commit()
        await self._auth.forget()
        return employee

    async def set_active(self, actor: Employee, employee_id: uuid.UUID, active: bool) -> Employee:
        self._access.require(actor, Permission.USERS_MANAGE)
        if employee_id == actor.id and not active:
            raise InvalidOperationError("You cannot deactivate yourself", code="self_deactivation")
        async with self._uow() as uow:
            employee = await self._load(uow, employee_id)
            if active:
                employee.activate()
            else:
                employee.deactivate()
                await uow.refresh_tokens.revoke_all_for(employee.id, self._clock.now())
            action = "user_activated" if active else "user_deactivated"
            await uow.audit.add(AuditEntry(action, "employee", str(employee.id), actor.id))
            await uow.commit()
        await self._auth.forget()
        return employee

    async def anonymize_contact(self, actor: Employee, employee_id: uuid.UUID) -> Employee:
        self._access.require(actor, Permission.USERS_MANAGE)
        async with self._uow() as uow:
            employee = await self._load(uow, employee_id)
            if employee.active:
                raise InvalidOperationError("Deactivate the user first", code="anonymize_active_user")
            employee.forget_contact()
            await uow.audit.add(AuditEntry("contact_anonymized", "employee", str(employee.id), actor.id))
            await uow.commit()
        await self._auth.forget()
        return employee

    async def reset_password(self, actor: Employee, employee_id: uuid.UUID, password: str | None) -> str:
        self._access.require(actor, Permission.USERS_MANAGE)
        password = password or self._temporary_password()
        async with self._uow() as uow:
            employee = await self._load(uow, employee_id)
            self._auth.password_policy.check(password, employee.email)
            employee.change_password(self._hasher.hash(password), temporary=True)
            employee.register_successful_login()  # de paso desbloquea la cuenta
            await uow.refresh_tokens.revoke_all_for(employee.id, self._clock.now())
            await uow.audit.add(AuditEntry("password_reset", "employee", str(employee.id), actor.id))
            await uow.commit()
        await self._auth.forget()
        return password

    async def _load(self, uow: UnitOfWork, employee_id: uuid.UUID) -> Employee:
        employee = await uow.employees.get(employee_id)
        # El superadmin es de la plataforma, no de Forsa: para el admin de Forsa no existe.
        if employee is None or employee.role == Role.SUPERADMIN:
            raise NotFoundError("employee")
        return employee

    async def _validate(self, uow: UnitOfWork, employee: Employee) -> None:
        other = await uow.employees.get_by_email(employee.email)
        if other is not None and other.id != employee.id:
            raise ConflictError("Email already registered", code="email_taken", email=employee.email)
        if employee.phone:
            other = await uow.employees.get_by_phone(employee.phone)
            if other is not None and other.id != employee.id:
                raise ConflictError("Phone already registered", code="phone_taken")
        if not employee.company_ids:
            raise ValidationError("The user must belong to at least one company", code="no_company")
        companies = await uow.companies.find(employee.company_ids)
        if len(companies) != len(employee.company_ids):
            raise ValidationError("Unknown company", code="unknown_company")
        if employee.approver_id is not None:
            if employee.approver_id == employee.id:
                raise ValidationError("A user cannot be their own approver", code="self_approver")
            approver = await uow.employees.get(employee.approver_id)
            if approver is None or approver.role not in _APPROVER_ROLES or not approver.active:
                raise ValidationError("The approver must be an active approver, accountant or admin", code="invalid_approver")

    @staticmethod
    def _temporary_password() -> str:
        return secrets.token_urlsafe(12)


def _reject_superadmin_role(role: Role) -> None:
    if role == Role.SUPERADMIN:
        raise PermissionDeniedError("The superadmin role is assigned only from the CLI", code="superadmin_reserved")
