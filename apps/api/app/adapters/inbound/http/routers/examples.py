"""Lo que la plataforma aprendió de las correcciones: contabilidad lo revisa, corrige y desactiva; el
aprobador valida lo que corrigió su equipo."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee, PageDep
from app.adapters.inbound.http.schemas import ExampleHistoryOut, ExampleOut, ExamplePatch, ListOut, PageOut, page_out
from app.domain.enums import ExampleKind, ExampleStatus
from app.domain.ports import ExampleFilter

router = APIRouter(prefix="/classification-examples", tags=["learning"])


@router.get("", response_model=PageOut[ExampleOut])
async def list_examples(
    actor: CurrentEmployee,
    container: ContainerDep,
    page: PageDep,
    kind: ExampleKind | None = None,
    status: ExampleStatus | None = None,
    conflicted: bool | None = None,
    created_by: uuid.UUID | None = None,
) -> PageOut[ExampleOut]:
    flt = ExampleFilter(kind=kind, status=status, conflicted=conflicted, created_by=created_by)
    return page_out(await container.learning.search(actor, flt, page), page, ExampleOut.model_validate)


@router.get("/{example_id}/history", response_model=ListOut[ExampleHistoryOut])
async def example_history(example_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[ExampleHistoryOut]:
    history = await container.learning.history(actor, example_id)
    return ListOut[ExampleHistoryOut](data=[ExampleHistoryOut.model_validate(h) for h in history])


@router.patch("/{example_id}", response_model=ExampleOut, summary="Fix the label, share it with the group or (de)activate it")
async def update_example(
    example_id: uuid.UUID, body: ExamplePatch, actor: CurrentEmployee, container: ContainerDep
) -> ExampleOut:
    return ExampleOut.model_validate(await container.learning.update(actor, example_id, body.model_dump(exclude_unset=True)))


@router.delete("/{example_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Deactivate (never deleted)")
async def deactivate_example(example_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> None:
    await container.learning.update(actor, example_id, {"active": False})


@router.post("/{example_id}/approve", response_model=ExampleOut, summary="Validate an employee's correction")
async def approve_example(example_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ExampleOut:
    return ExampleOut.model_validate(await container.learning.decide(actor, example_id, approve=True))


@router.post("/{example_id}/reject", response_model=ExampleOut)
async def reject_example(example_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ExampleOut:
    return ExampleOut.model_validate(await container.learning.decide(actor, example_id, approve=False))
