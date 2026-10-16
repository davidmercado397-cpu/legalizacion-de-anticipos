from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee, PageDep, require
from app.adapters.inbound.http.schemas import (
    AuditOut,
    CompanyIn,
    CompanyOut,
    CompanyPatch,
    DelegationIn,
    DelegationOut,
    EmployeeCreatedOut,
    EmployeeIn,
    EmployeeOut,
    EmployeePatch,
    LinkCodeOut,
    ListOut,
    PageOut,
    PasswordResetIn,
    company_out,
    delegation_out,
    employee_out,
    page_out,
)
from app.application.companies import CompanyData
from app.application.employees import EmployeeData
from app.domain.entities import Employee
from app.domain.enums import Role
from app.domain.permissions import Permission
from app.domain.ports import AuditFilter, EmployeeFilter

router = APIRouter()
UserAdmin = Annotated[Employee, Depends(require(Permission.USERS_MANAGE))]


@router.post("/companies", response_model=CompanyOut, status_code=status.HTTP_201_CREATED, tags=["companies"])
async def create_company(body: CompanyIn, actor: CurrentEmployee, container: ContainerDep) -> CompanyOut:
    company = await container.companies.create(actor, CompanyData(**body.model_dump()))
    return company_out(company)


@router.get("/companies", response_model=ListOut[CompanyOut], tags=["companies"])
async def list_companies(actor: CurrentEmployee, container: ContainerDep) -> ListOut[CompanyOut]:
    return ListOut[CompanyOut](data=[company_out(c) for c in await container.companies.search(actor)])


@router.get("/companies/{company_id}", response_model=CompanyOut, tags=["companies"])
async def get_company(company_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> CompanyOut:
    return company_out(await container.companies.get(actor, company_id))


@router.patch("/companies/{company_id}", response_model=CompanyOut, tags=["companies"])
async def update_company(
    company_id: uuid.UUID, body: CompanyPatch, actor: CurrentEmployee, container: ContainerDep
) -> CompanyOut:
    return company_out(await container.companies.update(actor, company_id, body.model_dump(exclude_unset=True)))


@router.post("/employees", response_model=EmployeeCreatedOut, status_code=status.HTTP_201_CREATED, tags=["employees"])
async def create_employee(body: EmployeeIn, actor: UserAdmin, container: ContainerDep) -> EmployeeCreatedOut:
    created = await container.employees.create(actor, EmployeeData(**body.model_dump()))
    return EmployeeCreatedOut(**employee_out(created.employee).model_dump(), temporary_password=created.temporary_password)


@router.get("/employees", response_model=PageOut[EmployeeOut], tags=["employees"])
async def list_employees(
    actor: UserAdmin,
    container: ContainerDep,
    page: PageDep,
    company_id: uuid.UUID | None = None,
    role: Role | None = None,
    active: bool | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
) -> PageOut[EmployeeOut]:
    flt = EmployeeFilter(company_id=company_id, role=role, active=active, search=search)
    return page_out(await container.employees.search(actor, flt, page), page, employee_out)


@router.get("/employees/{employee_id}", response_model=EmployeeOut, tags=["employees"])
async def get_employee(employee_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> EmployeeOut:
    return employee_out(await container.employees.get(actor, employee_id))


@router.patch("/employees/{employee_id}", response_model=EmployeeOut, tags=["employees"])
async def update_employee(employee_id: uuid.UUID, body: EmployeePatch, actor: UserAdmin, container: ContainerDep) -> EmployeeOut:
    return employee_out(await container.employees.update(actor, employee_id, body.model_dump(exclude_unset=True)))


@router.post("/employees/{employee_id}/deactivate", response_model=EmployeeOut, tags=["employees"])
async def deactivate_employee(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> EmployeeOut:
    return employee_out(await container.employees.set_active(actor, employee_id, False))


@router.post("/employees/{employee_id}/activate", response_model=EmployeeOut, tags=["employees"])
async def activate_employee(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> EmployeeOut:
    return employee_out(await container.employees.set_active(actor, employee_id, True))


@router.post("/employees/{employee_id}/password", tags=["employees"], summary="Set a temporary password")
async def reset_password(
    employee_id: uuid.UUID, body: PasswordResetIn, actor: UserAdmin, container: ContainerDep
) -> dict[str, str]:
    password = await container.employees.reset_password(actor, employee_id, body.password)
    return {"temporary_password": password}


@router.post("/employees/{employee_id}/whatsapp-welcome", status_code=status.HTTP_202_ACCEPTED, tags=["employees"])
async def resend_welcome(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> dict[str, str]:
    await container.employees.get(actor, employee_id)
    container.tasks.spawn(lambda: container.identity.send_welcome(employee_id))
    return {"status": "queued"}


@router.post("/employees/{employee_id}/whatsapp-link-code", response_model=LinkCodeOut, tags=["employees"])
async def employee_link_code(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> LinkCodeOut:
    code = await container.identity.issue_link_code(employee_id)
    return LinkCodeOut(
        code=code,
        expires_in_minutes=container.settings.LINK_CODE_TTL_MINUTES,
        instructions=f"El usuario debe enviar por WhatsApp: VINCULAR {code}",
    )


@router.delete("/employees/{employee_id}/whatsapp-link", status_code=status.HTTP_204_NO_CONTENT, tags=["employees"])
async def unlink_whatsapp(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> None:
    await container.identity.unlink(employee_id, actor.id)
    await container.auth.forget()


@router.post("/employees/{employee_id}/mfa/reset", status_code=status.HTTP_204_NO_CONTENT, tags=["employees"])
async def reset_mfa(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> None:
    """Para un celular perdido: el usuario vuelve a activar la verificación en dos pasos al entrar."""
    await container.mfa.reset(actor, employee_id)


@router.post("/employees/{employee_id}/anonymize-contact", response_model=EmployeeOut, tags=["employees"])
async def anonymize_contact(employee_id: uuid.UUID, actor: UserAdmin, container: ContainerDep) -> EmployeeOut:
    """Habeas data de un usuario retirado: borra celular e identidad de WhatsApp; sus gastos se
    conservan porque son soporte contable."""
    return employee_out(await container.employees.anonymize_contact(actor, employee_id))


@router.get("/employees/{employee_id}/delegations", response_model=ListOut[DelegationOut], tags=["employees"])
async def list_delegations(employee_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[DelegationOut]:
    return ListOut[DelegationOut](data=[delegation_out(d) for d in await container.treasury.delegations(actor, employee_id)])


@router.post(
    "/employees/{employee_id}/delegations",
    response_model=DelegationOut,
    status_code=status.HTTP_201_CREATED,
    tags=["employees"],
    summary="Name a substitute approver for a period",
)
async def add_delegation(
    employee_id: uuid.UUID, body: DelegationIn, actor: CurrentEmployee, container: ContainerDep
) -> DelegationOut:
    delegation = await container.treasury.delegate(actor, employee_id, body.delegate_id, body.starts_at, body.ends_at)
    return delegation_out(delegation)


@router.delete("/employees/{employee_id}/delegations/{delegation_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["employees"])
async def revoke_delegation(
    employee_id: uuid.UUID, delegation_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep
) -> None:
    await container.treasury.revoke(actor, employee_id, delegation_id)


@router.get("/audit", response_model=PageOut[AuditOut], tags=["audit"])
async def audit_log(
    actor: Annotated[Employee, Depends(require(Permission.AUDIT_READ))],
    container: ContainerDep,
    page: PageDep,
    entity_type: Annotated[str | None, Query(max_length=40)] = None,
    entity_id: Annotated[str | None, Query(max_length=80)] = None,
    actor_id: uuid.UUID | None = None,
    action: Annotated[str | None, Query(max_length=80)] = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> PageOut[AuditOut]:
    """Rastro inmutable: solo se insertan registros (un trigger en PostgreSQL bloquea editar o borrar)."""
    flt = AuditFilter(entity_type, entity_id, actor_id, action, since, until)
    return page_out(await container.audit.search(actor, flt, page), page, AuditOut.model_validate)
