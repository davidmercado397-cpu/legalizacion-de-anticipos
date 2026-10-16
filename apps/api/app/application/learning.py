"""Aprendizaje por correcciones (sin reentrenar modelos).

- Lo que corrige un aprobador o contabilidad se vuelve ejemplo activo de inmediato; lo que corrige el
  propio empleado queda pendiente hasta que lo valide su aprobador (nadie "enseña" que el licor no es
  licor). Las categorías por proveedor que corrige el empleado se activan solas al cerrarse la
  legalización.
- Al leer una factura: memoria exacta (mismo texto normalizado o mismo NIT) y, si no hay, una alerta
  cuando la línea se parece a una que se corrigió como bloqueada. El parecido nunca etiqueta solo.
- No es retroactivo: un cambio recalcula únicamente los gastos que aún no se confirman."""

from __future__ import annotations

import uuid
from typing import Any

from app.application.access import AccessPolicy
from app.application.policies import CompanyContextProvider, PolicyEvaluator
from app.application.settings import SettingsService
from app.domain.entities import (
    NO_CONCEPT,
    AuditEntry,
    ClassificationExample,
    Employee,
    ExampleHistory,
    Expense,
    ExpenseLine,
)
from app.domain.enums import ExampleKind, ExampleScope, ExampleStatus, Role
from app.domain.errors import InvalidOperationError, NotFoundError, PermissionDeniedError, ValidationError
from app.domain.fiscal import tax_id_key
from app.domain.permissions import Permission
from app.domain.ports import Clock, ExampleFilter, Page, Paged, UnitOfWork, UnitOfWorkFactory


class LearningService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        clock: Clock,
        settings: SettingsService,
        evaluator: PolicyEvaluator,
        contexts: CompanyContextProvider,
    ) -> None:
        self._uow = uow
        self._access = access
        self._clock = clock
        self._settings = settings
        self._evaluator = evaluator
        self._contexts = contexts

    # --- Aprender (dentro de la transacción del caso de uso que corrige) -------------------------

    async def learn_line(self, uow: UnitOfWork, actor: Employee, expense: Expense, line: ExpenseLine, reviewer: bool) -> None:
        if not line.normalized_text:
            return
        label = line.final_concept_code or NO_CONCEPT
        await self._learn(uow, actor, ExampleKind.LINE_CONCEPT, line.normalized_text, line.description, label, expense, reviewer)

    async def learn_category(self, uow: UnitOfWork, actor: Employee, expense: Expense, reviewer: bool) -> None:
        key = tax_id_key(expense.vendor_tax_id)
        if key and expense.category:
            original = expense.vendor_name or expense.vendor_tax_id or key
            await self._learn(uow, actor, ExampleKind.VENDOR_CATEGORY, key, original, expense.category, expense, reviewer)

    async def activate_closed(self, uow: UnitOfWork, actor: Employee, expense_ids: list[uuid.UUID]) -> None:
        """Al cerrar una legalización, las categorías por proveedor que corrigió el empleado ya fueron
        revisadas por el aprobador: se activan."""
        for example in await uow.examples.pending_from(expense_ids):
            if example.kind == ExampleKind.VENDOR_CATEGORY:
                await self._set_status(uow, example, ExampleStatus.ACTIVE, actor, "activated_on_close")

    async def _learn(
        self,
        uow: UnitOfWork,
        actor: Employee,
        kind: ExampleKind,
        key: str,
        original: str,
        label: str,
        expense: Expense,
        reviewer: bool,
    ) -> None:
        now = self._clock.now()
        example = await uow.examples.by_key(kind, key, ExampleScope.COMPANY, expense.company_id)
        if example is None:
            status = ExampleStatus.ACTIVE if reviewer else ExampleStatus.PENDING
            example = ClassificationExample(
                kind, key, original[:300], label, actor.id, expense.company_id, status=status, source_expense_id=expense.id
            )
            await uow.examples.add(example)
            await uow.flush()  # la historia referencia al ejemplo
            await self._history(uow, example, "created", None, actor)
        elif reviewer:
            before = example.snapshot()
            example.relabel(label, actor.id, now)
            example.status = ExampleStatus.ACTIVE
            await self._history(uow, example, "corrected", before, actor)
        elif example.status == ExampleStatus.PENDING:
            before = example.snapshot()
            example.label, example.updated_by, example.updated_at = label, actor.id, now
            await self._history(uow, example, "corrected", before, actor)
        else:
            return  # el empleado no cambia lo que ya validó un revisor
        if example.status == ExampleStatus.ACTIVE:
            await self._recalculate(uow, example)
            await self._contexts.invalidate()

    # --- Aplicar al leer una factura ------------------------------------------------------------

    async def apply(self, uow: UnitOfWork, expense: Expense, lines: list[ExpenseLine], concept_codes: set[str]) -> None:
        memory = await uow.examples.memory(ExampleKind.LINE_CONCEPT, [line.normalized_text for line in lines], expense.company_id)
        threshold = (await self._settings.current()).learning_similarity
        for line in lines:
            example = memory.get(line.normalized_text)
            if example is not None and (example.label == NO_CONCEPT or example.label in concept_codes):
                line.final_concept_code = None if example.label == NO_CONCEPT else example.label
                line.memory_example_id = example.id
            elif line.final_concept_code is None and line.normalized_text:
                similar = await uow.examples.similar(expense.company_id, line.normalized_text, threshold)
                if similar is not None and similar.example.label in concept_codes:
                    line.similar_concept_code = similar.example.label
                    line.similar_text = similar.example.original_text
        key = tax_id_key(expense.vendor_tax_id)
        if key:
            vendor = (await uow.examples.memory(ExampleKind.VENDOR_CATEGORY, [key], expense.company_id)).get(key)
            if vendor is not None and expense.company_id:
                active = {c.code for c in await uow.categories.list_for_company(expense.company_id)}
                if vendor.label in active:
                    expense.category = vendor.label

    async def _recalculate(self, uow: UnitOfWork, example: ClassificationExample) -> None:
        """Solo gastos sin confirmar: lo confirmado ya tiene una decisión auditada."""
        if example.kind != ExampleKind.LINE_CONCEPT:
            return
        touched: dict[uuid.UUID, Expense] = {}
        for line in await uow.lines.list_unconfirmed_by_text(example.company_id, example.key_text):
            if line.corrected_by is not None:
                continue  # una corrección humana sobre esa línea manda
            active = example.status == ExampleStatus.ACTIVE
            line.final_concept_code = None if not active or example.label == NO_CONCEPT else example.label
            line.memory_example_id = example.id if active else None
            expense = touched.get(line.expense_id) or await uow.expenses.get(line.expense_id)
            if expense is not None:
                touched[expense.id] = expense
        await uow.flush()
        for expense in touched.values():
            await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), self._clock.now())

    # --- Gestión (API) --------------------------------------------------------------------------

    async def search(self, actor: Employee, flt: ExampleFilter, page: Page) -> Paged[ClassificationExample]:
        """Contabilidad ve los de sus compañías (y los de grupo); un aprobador, los de su equipo."""
        async with self._uow() as uow:
            if actor.role == Role.APPROVER:
                creators = [actor.id, *await uow.employees.list_reports_of(actor.id)]
                flt = ExampleFilter(list(actor.company_ids), flt.kind, flt.status, flt.conflicted, flt.created_by, creators)
            else:
                self._access.require(actor, Permission.EXAMPLES_MANAGE)
                scope = None if actor.is_admin else list(actor.company_ids)
                flt = ExampleFilter(scope, flt.kind, flt.status, flt.conflicted, flt.created_by)
            return await uow.examples.find(flt, page)

    async def history(self, actor: Employee, example_id: uuid.UUID) -> list[ExampleHistory]:
        async with self._uow() as uow:
            await self._manageable(uow, actor, example_id)
            return await uow.examples.history(example_id)

    async def update(self, actor: Employee, example_id: uuid.UUID, changes: dict[str, Any]) -> ClassificationExample:
        async with self._uow() as uow:
            example = await self._manageable(uow, actor, example_id)
            # El empleado no edita (ni activa) lo que aprendió el sistema; el aprobador, solo lo que creó.
            if actor.role == Role.EMPLOYEE or (actor.role == Role.APPROVER and example.created_by != actor.id):
                raise PermissionDeniedError("Not allowed to edit this example", code="example_edit_forbidden")
            before = example.snapshot()
            if changes.get("label"):
                await self._check_label(uow, example, changes["label"])
                example.label = changes["label"]
                example.conflicted = False  # quien edita resuelve el conflicto
            if changes.get("scope"):
                self._access.require(actor, Permission.EXAMPLES_MANAGE)  # pasar a grupo es de contabilidad
                example.scope = changes["scope"]
                example.company_id = None if example.scope == ExampleScope.GROUP else example.company_id
            if changes.get("active") is not None:
                example.status = ExampleStatus.ACTIVE if changes["active"] else ExampleStatus.INACTIVE
            example.updated_by, example.updated_at = actor.id, self._clock.now()
            await self._history(uow, example, "edited", before, actor)
            await self._recalculate(uow, example)
            await uow.audit.add(AuditEntry("example_updated", "example", str(example.id), actor.id, data=changes))
            await uow.commit()
        await self._contexts.invalidate()
        return example

    async def decide(self, actor: Employee, example_id: uuid.UUID, approve: bool) -> ClassificationExample:
        async with self._uow() as uow:
            example = await self._manageable(uow, actor, example_id)
            if example.status != ExampleStatus.PENDING:
                raise InvalidOperationError("Only pending examples are validated", code="example_not_pending")
            if example.created_by == actor.id:
                raise InvalidOperationError("Nobody validates their own correction", code="self_validation")
            status = ExampleStatus.ACTIVE if approve else ExampleStatus.REJECTED
            await self._set_status(uow, example, status, actor, "approved" if approve else "rejected")
            await uow.commit()
        await self._contexts.invalidate()
        return example

    async def _set_status(
        self, uow: UnitOfWork, example: ClassificationExample, status: ExampleStatus, actor: Employee, action: str
    ) -> None:
        before = example.snapshot()
        example.status, example.updated_by, example.updated_at = status, actor.id, self._clock.now()
        await self._history(uow, example, action, before, actor)
        await self._recalculate(uow, example)

    async def _manageable(self, uow: UnitOfWork, actor: Employee, example_id: uuid.UUID) -> ClassificationExample:
        """Contabilidad gestiona los de sus compañías; un aprobador, lo que creó o lo de su equipo."""
        example = await uow.examples.get(example_id)
        if example is None:
            raise NotFoundError("example")
        if actor.is_admin:
            return example
        if actor.role == Role.ACCOUNTANT:
            if example.company_id is None or actor.works_for(example.company_id):
                return example
            raise NotFoundError("example")
        creator = await uow.employees.get(example.created_by)
        if creator is not None and (creator.id == actor.id or actor.can_approve_for(creator)):
            return example
        raise NotFoundError("example")

    async def _check_label(self, uow: UnitOfWork, example: ClassificationExample, label: str) -> None:
        if example.kind == ExampleKind.LINE_CONCEPT:
            valid = {NO_CONCEPT} | (
                {c.code for c in await uow.concepts.list_for_company(example.company_id)} if example.company_id else set()
            )
        else:
            valid = {c.code for c in await uow.categories.list_for_company(example.company_id)} if example.company_id else set()
        if example.company_id is not None and label not in valid:
            raise ValidationError("Unknown label", code="unknown_example_label", label=label)

    @staticmethod
    async def _history(
        uow: UnitOfWork, example: ClassificationExample, action: str, before: dict[str, Any] | None, actor: Employee
    ) -> None:
        await uow.examples.add_history(ExampleHistory(example.id, action, before, example.snapshot(), actor.id))
