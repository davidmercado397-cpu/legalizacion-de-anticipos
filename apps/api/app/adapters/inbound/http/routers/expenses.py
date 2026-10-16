"""Las cargas responden 202 de inmediato; la lectura sigue en background y el frontend consulta el
estado con `GET /expenses?updated_since=`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, Response, UploadFile, status
from fastapi.responses import RedirectResponse

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee, PageDep, enforce_limit
from app.adapters.inbound.http.schemas import (
    ConfirmIn,
    DeductibilityIn,
    DeductibilityOut,
    ExpenseLineOut,
    ExpenseOut,
    ExpensePatch,
    FileOut,
    LinePatch,
    ListOut,
    PageOut,
    ReviewIn,
    expense_out,
    localize,
    page_out,
)
from app.domain.enums import Deductibility, ExpenseStatus
from app.domain.errors import NotFoundError, ValidationError

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_202_ACCEPTED, summary="Upload an invoice photo/PDF")
async def upload_expense(
    actor: CurrentEmployee,
    container: ContainerDep,
    response: Response,
    file: Annotated[UploadFile, File(description="JPEG, PNG, WebP or PDF")],
    client_ref: Annotated[str | None, Form(max_length=100, description="Idempotency key from the app's offline queue")] = None,
    sent_at: Annotated[datetime | None, Form(description="When the photo was taken")] = None,
    advance_id: Annotated[uuid.UUID | None, Form()] = None,
) -> ExpenseOut:
    await enforce_limit(container, "upload", str(actor.id), container.settings.RATE_LIMIT_UPLOAD)
    content = await file.read(container.settings.MAX_UPLOAD_BYTES + 1)
    if len(content) > container.settings.MAX_UPLOAD_BYTES:
        raise ValidationError(
            "The file is too large", code="file_too_large", max_mb=container.settings.MAX_UPLOAD_BYTES // (1024 * 1024)
        )
    expense, created = await container.expenses.upload(actor, content, client_ref, sent_at, advance_id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return expense_out(expense)


@router.get("", response_model=PageOut[ExpenseOut], summary="Expenses visible to the user")
async def list_expenses(
    actor: CurrentEmployee,
    container: ContainerDep,
    page: PageDep,
    status: ExpenseStatus | None = None,
    advance_id: uuid.UUID | None = None,
    updated_since: datetime | None = None,
    deductibility: Deductibility | None = None,
) -> PageOut[ExpenseOut]:
    expenses = await container.expenses.search(actor, status, advance_id, updated_since, page, deductibility)
    files = await container.expenses.file_links(expenses.items)  # las listas muestran la miniatura
    result = page_out(expenses, page, expense_out)
    for item in result.data:
        link = files.get(item.id)
        item.file = FileOut(**link.__dict__) if link else None
    zones = {e.id: (await container.contexts.get(e.company_id)).timezone or "UTC" for e in expenses.items}
    result.data = [localize(item, zones[item.id]) for item in result.data]
    return result


@router.get("/{expense_id}", response_model=ExpenseOut)
async def get_expense(expense_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ExpenseOut:
    expense = await container.expenses.get(actor, expense_id)
    link = (await container.expenses.file_links([expense])).get(expense.id)
    out = expense_out(expense)
    out.file = FileOut(**link.__dict__) if link else None
    return localize(out, (await container.contexts.get(expense.company_id)).timezone or "UTC")


@router.get("/{expense_id}/file", summary="Original file (redirects to a short-lived signed URL)")
async def get_expense_file(expense_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> RedirectResponse:
    url = await container.expenses.file_url(actor, expense_id)
    return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.patch("/{expense_id}", response_model=ExpenseOut, summary="Correct what the AI read")
async def correct_expense(
    expense_id: uuid.UUID, body: ExpensePatch, actor: CurrentEmployee, container: ContainerDep
) -> ExpenseOut:
    return expense_out(await container.expenses.correct(actor, expense_id, body.changes()))


@router.post("/{expense_id}/confirm", response_model=ExpenseOut)
async def confirm_expense(expense_id: uuid.UUID, body: ConfirmIn, actor: CurrentEmployee, container: ContainerDep) -> ExpenseOut:
    expense = await container.expenses.confirm(
        actor, expense_id, body.advance_id, body.amount_applied, justification=body.justification
    )
    return expense_out(expense)


@router.post("/{expense_id}/discard", response_model=ExpenseOut)
async def discard_expense(expense_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ExpenseOut:
    return expense_out(await container.expenses.discard(actor, expense_id))


@router.get("/{expense_id}/lines", response_model=ListOut[ExpenseLineOut], summary="Invoice lines with their concept")
async def expense_lines(expense_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[ExpenseLineOut]:
    lines = await container.expenses.lines(actor, expense_id)
    return ListOut[ExpenseLineOut](data=[ExpenseLineOut.model_validate(line) for line in lines])


@router.patch("/{expense_id}/lines/{line_id}", response_model=ExpenseLineOut, summary="Correct a line's concept")
async def correct_line(
    expense_id: uuid.UUID, line_id: uuid.UUID, body: LinePatch, actor: CurrentEmployee, container: ContainerDep
) -> ExpenseLineOut:
    _, line = await container.expenses.correct_line(actor, expense_id, line_id, body.concept_code)
    return ExpenseLineOut.model_validate(line)


@router.post("/{expense_id}/review", response_model=ExpenseOut, summary="Approver decision on policy findings")
async def review_expense(expense_id: uuid.UUID, body: ReviewIn, actor: CurrentEmployee, container: ContainerDep) -> ExpenseOut:
    return expense_out(await container.expenses.review(actor, expense_id, body.decision, body.note))


@router.post("/{expense_id}/deductibility", response_model=ExpenseOut, summary="Override the suggested deductibility")
async def set_deductibility(
    expense_id: uuid.UUID, body: DeductibilityIn, actor: CurrentEmployee, container: ContainerDep
) -> ExpenseOut:
    return expense_out(await container.expenses.set_deductibility(actor, expense_id, body.deductibility))


@router.get("/{expense_id}/deductibility", response_model=DeductibilityOut, summary="Deductible base and taxes, line by line")
async def deductibility_breakdown(expense_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> DeductibilityOut:
    result = await container.expenses.deductibility_breakdown(actor, expense_id)
    if result is None:
        raise NotFoundError("deductibility")
    return DeductibilityOut(**result.__dict__)
