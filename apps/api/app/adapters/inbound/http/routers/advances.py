"""Anticipos (en el negocio también les dicen "bolsas")."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Response, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee, PageDep
from app.adapters.inbound.http.schemas import (
    AdvanceDetailOut,
    AdvanceIn,
    AdvanceListItemOut,
    AdvanceOut,
    BalanceOut,
    DisburseIn,
    ExpenseDetailOut,
    ExpenseLineOut,
    FileOut,
    ListOut,
    NoteIn,
    OwnerOut,
    PageOut,
    RequiredNoteIn,
    ReturnIn,
    ReturnSuggestionOut,
    SettleIn,
    TimelineEventOut,
    WithdrawalOut,
    advance_out,
    expense_out,
    localize,
    page_out,
)
from app.application.advances import AdvanceRequest, ReturnMark
from app.container import Container
from app.domain.entities import Advance
from app.domain.enums import AdvanceStatus

router = APIRouter(prefix="/advances", tags=["advances"])


async def _zone(container: Container, company_id: uuid.UUID) -> str:
    return (await container.contexts.get(company_id)).timezone or "UTC"


async def _out(container: Container, advance: Advance) -> AdvanceOut:
    return localize(advance_out(advance), await _zone(container, advance.company_id))


@router.post("", response_model=AdvanceOut, status_code=status.HTTP_201_CREATED, summary="Request an advance")
async def request_advance(body: AdvanceIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(
        container,
        await container.advances.request(
            actor, AdvanceRequest(**body.model_dump(exclude={"legs"}), legs=tuple(leg.to_domain() for leg in body.legs))
        ),
    )


@router.get("", response_model=PageOut[AdvanceListItemOut], summary="Advances visible to the user")
async def list_advances(
    actor: CurrentEmployee,
    container: ContainerDep,
    page: PageDep,
    status: AdvanceStatus | None = None,
    disbursed: bool | None = None,
    settlement: Literal["pending"] | None = None,
) -> PageOut[AdvanceListItemOut]:
    advances = await container.advances.search(actor, status, page, disbursed, settlement == "pending" or None)
    names = await container.advances.owner_names(advances.items)
    result = page_out(
        advances, page, lambda a: AdvanceListItemOut(**advance_out(a).model_dump(), employee_name=names[a.employee_id])
    )
    zones = {a.id: await _zone(container, a.company_id) for a in advances.items}
    result.data = [localize(item, zones[item.id]) for item in result.data]
    return result


@router.get(
    "/pending-approval",
    response_model=ListOut[AdvanceListItemOut],
    summary="Requests waiting for this user's decision (their step of the route, or the upper level)",
)
async def pending_approval(actor: CurrentEmployee, container: ContainerDep) -> ListOut[AdvanceListItemOut]:
    queue = await container.advances.decision_queue(actor, 200)
    items = []
    for advance, owner in queue.requested:
        item = AdvanceListItemOut(**advance_out(advance).model_dump(), employee_name=owner.full_name)
        items.append(localize(item, await _zone(container, advance.company_id)))
    return ListOut[AdvanceListItemOut](data=items)


@router.get("/{advance_id}", response_model=AdvanceDetailOut, summary="Legalization detail: photos, data, lines and dates")
async def get_advance(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceDetailOut:
    view = await container.legalization.detail(actor, advance_id)
    detail = view.detail
    expenses = []
    for item in view.items:
        file = FileOut(**item.file.__dict__) if item.file else None
        lines = [ExpenseLineOut.model_validate(line) for line in item.lines]
        expenses.append(ExpenseDetailOut(**expense_out(item.expense).model_dump(exclude={"file"}), file=file, lines=lines))
    out = AdvanceDetailOut(
        **advance_out(detail.advance).model_dump(),
        balance=BalanceOut.of(detail.balance, detail.functional),
        company_timezone=view.company.timezone,
        employee=OwnerOut.model_validate(view.owner),
        expenses=expenses,
        withdrawals=[WithdrawalOut.of(w.withdrawal, w.remaining) for w in detail.withdrawals],
    )
    return localize(out, view.company.timezone)


@router.get("/{advance_id}/timeline", response_model=ListOut[TimelineEventOut], summary="What happened, who and when")
async def timeline(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[TimelineEventOut]:
    events = await container.legalization.timeline(actor, advance_id)
    advance = (await container.advances.get(actor, advance_id)).advance
    zone = await _zone(container, advance.company_id)
    return ListOut[TimelineEventOut](data=[localize(TimelineEventOut(**e.__dict__), zone) for e in events])


@router.post("/{advance_id}/approve", response_model=AdvanceOut)
async def approve(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.approve(actor, advance_id))


@router.post("/{advance_id}/reject", response_model=AdvanceOut)
async def reject(advance_id: uuid.UUID, body: NoteIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.reject(actor, advance_id, body.note))


@router.delete("/{advance_id}", response_model=AdvanceOut, summary="Cancel a request that is not approved yet")
async def cancel(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.cancel(actor, advance_id))


@router.post("/{advance_id}/void", response_model=AdvanceOut, summary="Void an approved advance without expenses")
async def void(advance_id: uuid.UUID, body: RequiredNoteIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.void(actor, advance_id, body.note))


@router.post("/{advance_id}/submit", response_model=AdvanceOut, summary="Submit the legalization for review")
async def submit(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.submit(actor, advance_id))


@router.post("/{advance_id}/close", response_model=AdvanceOut, summary="Approve the legalization")
async def close(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.close(actor, advance_id))


@router.post("/{advance_id}/erp/advance", response_model=AdvanceOut, summary="Retry creating the advance in Siesa")
async def erp_advance(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.erp.retry_advance(actor, advance_id))


@router.post("/{advance_id}/erp/legalization", response_model=AdvanceOut, summary="Create the legalization in Siesa")
async def erp_legalization(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.erp.send_legalization(actor, advance_id))


@router.post("/{advance_id}/return", response_model=AdvanceOut, summary="Return the legalization, optionally marking expenses")
async def return_for_changes(
    advance_id: uuid.UUID, body: ReturnIn, actor: CurrentEmployee, container: ContainerDep
) -> AdvanceOut:
    marks = [ReturnMark(item.expense_id, item.note) for item in body.items]
    return await _out(container, await container.advances.return_for_changes(actor, advance_id, body.note, marks))


@router.get(
    "/{advance_id}/return-suggestions",
    response_model=ListOut[ReturnSuggestionOut],
    summary="Expenses worth marking when returning, with a suggested comment",
)
async def return_suggestions(
    advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep
) -> ListOut[ReturnSuggestionOut]:
    suggestions = await container.legalization.return_suggestions(actor, advance_id)
    return ListOut[ReturnSuggestionOut](data=[ReturnSuggestionOut(**s.__dict__) for s in suggestions])


@router.post("/{advance_id}/reopen", response_model=AdvanceOut, summary="Reopen a legalization closed by mistake")
async def reopen(advance_id: uuid.UUID, body: RequiredNoteIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    return await _out(container, await container.advances.reopen(actor, advance_id, body.note))


@router.post("/{advance_id}/disburse", response_model=AdvanceOut, summary="Record that treasury delivered the money")
async def disburse(advance_id: uuid.UUID, body: DisburseIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    advance = await container.treasury.disburse(actor, advance_id, body.method, body.reference, body.disbursed_at, body.amount)
    return await _out(container, advance)


@router.post("/{advance_id}/settle", response_model=AdvanceOut, summary="Record the refund or the payment of the difference")
async def settle(advance_id: uuid.UUID, body: SettleIn, actor: CurrentEmployee, container: ContainerDep) -> AdvanceOut:
    advance = await container.treasury.settle(actor, advance_id, body.method, body.reference, body.settled_at)
    return await _out(container, advance)


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/{advance_id}/legalization.xlsx", summary="Legalization in Excel (for accounting)", response_class=Response)
async def export_legalization(advance_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> Response:
    filename, content = await container.exporter.export(actor, advance_id)
    return Response(
        content=content,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"},
    )
