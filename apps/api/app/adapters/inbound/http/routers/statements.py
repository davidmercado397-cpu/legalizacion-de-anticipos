"""Conciliación con el extracto bancario: tesorería lo carga y contabilidad decide los cruces."""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, UploadFile, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import (
    ChargeDecisionIn,
    LinkIn,
    ListOut,
    MovementOut,
    SkippedRowOut,
    StatementOut,
    StatementPreviewOut,
    StatementProfileIO,
)
from app.application.reconciliation import StatementView, UploadedFile
from app.container import Container
from app.domain.errors import ValidationError

router = APIRouter(tags=["reconciliation"])

ProfileForm = Annotated[
    str | None, Form(description="StatementProfileIO en JSON; vacío = el que sugiere el sistema (o el fijo del PDF)")
]


def _profile(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return StatementProfileIO.model_validate(json.loads(raw)).model_dump()
    except ValueError as exc:
        raise ValidationError("Invalid profile", code="statement_profile_invalid") from exc


async def _file(container: Container, upload: UploadFile) -> UploadedFile:
    max_bytes = (await container.runtime.current()).reconciliation_max_file_mb * 1024 * 1024
    return UploadedFile(upload.filename or "extracto", await upload.read(max_bytes + 1))


def _out(view: StatementView) -> StatementOut:
    s = view.statement
    return StatementOut(
        id=s.id,
        advance_id=s.advance_id,
        currency=s.currency,
        card_last4=s.card_last4,
        file_name=s.file_name,
        uploaded_at=s.uploaded_at,
        profile=s.profile,
        movements=[MovementOut.model_validate({**m.__dict__, "needs_decision": m.needs_decision}) for m in view.movements],
    )


@router.post(
    "/advances/{advance_id}/statements/preview",
    response_model=StatementPreviewOut,
    summary="How a CSV or Excel statement would be read (suggested column mapping)",
)
async def preview(
    advance_id: uuid.UUID,
    actor: CurrentEmployee,
    container: ContainerDep,
    file: Annotated[UploadFile, File(description="CSV o Excel del banco")],
    profile: ProfileForm = None,
) -> StatementPreviewOut:
    result = await container.reconciliation.preview(actor, advance_id, await _file(container, file), _profile(profile))
    return StatementPreviewOut(
        rows=result.rows,
        total_rows=result.total_rows,
        profile=StatementProfileIO(**result.profile.as_dict()),
        confident=result.confident,
        charges=result.charges,
        credits=result.credits,
        skipped=[SkippedRowOut(row=row, reason=reason) for row, reason in result.skipped],
    )


@router.post(
    "/advances/{advance_id}/statements",
    response_model=StatementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Load the card statement (treasury) and match it with the card expenses",
)
async def upload(
    advance_id: uuid.UUID,
    actor: CurrentEmployee,
    container: ContainerDep,
    file: Annotated[UploadFile, File(description="CSV, Excel o PDF del banco")],
    profile: ProfileForm = None,
    card_last4: Annotated[str | None, Form(max_length=4)] = None,
) -> StatementOut:
    view = await container.reconciliation.upload(
        actor, advance_id, await _file(container, file), _profile(profile), card_last4 or None
    )
    return _out(view)


@router.get("/advances/{advance_id}/statements", response_model=ListOut[StatementOut], summary="Statements and their matches")
async def list_statements(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[StatementOut]:
    return ListOut[StatementOut](data=[_out(v) for v in await container.reconciliation.statements(actor, advance_id)])


_MOVEMENT = "/statements/{statement_id}/movements/{movement_id}"


@router.post(f"{_MOVEMENT}/confirm", response_model=StatementOut, summary="Confirm a suggested or automatic match")
async def confirm(
    statement_id: uuid.UUID, movement_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep
) -> StatementOut:
    return _out(await container.reconciliation.confirm(actor, statement_id, movement_id))


@router.post(f"{_MOVEMENT}/reject", response_model=StatementOut, summary="Undo a match (it will not be proposed again)")
async def reject(
    statement_id: uuid.UUID, movement_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep
) -> StatementOut:
    return _out(await container.reconciliation.reject(actor, statement_id, movement_id))


@router.post(f"{_MOVEMENT}/link", response_model=StatementOut, summary="Match a charge with an expense by hand")
async def link(
    statement_id: uuid.UUID, movement_id: uuid.UUID, body: LinkIn, actor: CurrentEmployee, container: ContainerDep
) -> StatementOut:
    return _out(await container.reconciliation.link(actor, statement_id, movement_id, body.expense_id))


@router.post(
    f"{_MOVEMENT}/decision",
    response_model=StatementOut,
    summary="Charge without invoice: the company absorbs it or it is discounted to the employee",
)
async def decide(
    statement_id: uuid.UUID, movement_id: uuid.UUID, body: ChargeDecisionIn, actor: CurrentEmployee, container: ContainerDep
) -> StatementOut:
    return _out(await container.reconciliation.decide_charge(actor, statement_id, movement_id, body.decision))
