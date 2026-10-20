"""Retiros de efectivo en otra moneda durante el viaje (bolsas con su tasa que gastan las facturas en efectivo)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import WithdrawalIn, WithdrawalOut, WithdrawalPatch
from app.application.withdrawals import WithdrawalData

router = APIRouter(tags=["withdrawals"])


@router.post(
    "/advances/{advance_id}/withdrawals",
    response_model=WithdrawalOut,
    status_code=status.HTTP_201_CREATED,
    summary="The traveler records a cash withdrawal in another currency",
)
async def create_withdrawal(
    advance_id: uuid.UUID, body: WithdrawalIn, actor: CurrentEmployee, container: ContainerDep
) -> WithdrawalOut:
    data = WithdrawalData(body.withdrawn_on, body.currency, body.amount, body.debited_amount, body.fee_amount, body.note)
    return WithdrawalOut.of(await container.withdrawals.create(actor, advance_id, data))


@router.patch(
    "/withdrawals/{withdrawal_id}",
    response_model=WithdrawalOut,
    summary="Change a withdrawal (treasury: only the debited amount, the fee and the note)",
)
async def update_withdrawal(
    withdrawal_id: uuid.UUID, body: WithdrawalPatch, actor: CurrentEmployee, container: ContainerDep
) -> WithdrawalOut:
    changes = body.model_dump(exclude_unset=True)
    return WithdrawalOut.of(await container.withdrawals.update(actor, withdrawal_id, changes))


@router.delete(
    "/withdrawals/{withdrawal_id}", status_code=status.HTTP_204_NO_CONTENT, summary="The traveler deletes a withdrawal"
)
async def delete_withdrawal(withdrawal_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> Response:
    await container.withdrawals.delete(actor, withdrawal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
