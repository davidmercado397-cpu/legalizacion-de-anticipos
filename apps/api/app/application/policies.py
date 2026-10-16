from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.application.access import AccessPolicy
from app.application.cache import SharedCache
from app.application.settings import SettingsService
from app.domain.entities import (
    NO_CONCEPT,
    AuditEntry,
    BlockedConcept,
    Category,
    Employee,
    Expense,
    ExpenseLine,
    PolicyRuleConfig,
)
from app.domain.enums import PolicyAction
from app.domain.errors import ConflictError, NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.policies import RULES, EffectiveRule, PolicyContext, PolicyEngine, effective_rules
from app.domain.ports import (
    CacheVersions,
    CategoryHint,
    Clock,
    ConceptHint,
    ExtractionContext,
    LearnedExample,
    UnitOfWork,
    UnitOfWorkFactory,
)
from app.domain.time import local_datetime

_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


class PolicyEvaluator:
    def __init__(self, settings: SettingsService, engine: PolicyEngine | None = None) -> None:
        self._settings = settings
        self._engine = engine or PolicyEngine()

    async def apply(self, uow: UnitOfWork, expense: Expense, lines: list[ExpenseLine], now: datetime) -> None:
        company = await uow.companies.get(expense.company_id) if expense.company_id else None
        if company is None:
            return
        advance = await uow.advances.get(expense.advance_id) if expense.advance_id else None
        concepts = {c.code: c for c in await uow.concepts.list_for_company(company.id)}
        # El mes de los topes es el mes calendario de la compañía, no el de UTC.
        month_start = local_datetime(now, company.timezone).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        year_start = month_start.replace(month=1)
        exclude = [expense.id]
        settings = await self._settings.current()
        group = {c.tax_id: c.name for c in await uow.companies.find() if c.active and c.tax_id and c.id != company.id}
        generic = {
            *settings.generic_buyer_ids.get(company.country, []),
            *([company.generic_tax_id] if company.generic_tax_id else []),
        }
        ctx = PolicyContext(
            expense=expense,
            lines=lines,
            company=company,
            advance=advance,
            concepts=concepts,
            is_duplicate=await uow.expenses.has_duplicate(expense),
            non_fiscal_month_total=await uow.expenses.sum_non_fiscal(expense.employee_id, company.currency, month_start, exclude),
            non_fiscal_year_total=await uow.expenses.sum_non_fiscal(expense.employee_id, company.currency, year_start, exclude),
            group_companies=group,
            generic_buyer_ids=tuple(sorted(generic)),
        )
        result = self._engine.evaluate(ctx, await uow.policy_rules.list_for_company(company.id), settings.policy_rule_defaults)
        expense.set_policy_result([f.as_dict() for f in result.findings], result.deductibility, result.suggested_non_reimbursable)


class CompanyContextProvider:
    """Contexto del prompt por compañía (nombre, moneda, conceptos bloqueados), cacheado: se lee en
    cada factura y casi nunca cambia. Además mantiene estable el prefijo cacheable del prompt."""

    def __init__(self, uow: UnitOfWorkFactory, versions: CacheVersions, settings: SettingsService) -> None:
        self._uow = uow
        self._settings = settings
        self._cache: SharedCache[uuid.UUID, ExtractionContext] = SharedCache("company_context", versions, ttl_seconds=300)

    async def get(self, company_id: uuid.UUID | None) -> ExtractionContext:
        if company_id is None:
            return ExtractionContext()
        return await self._cache.get_or_load(company_id, lambda: self._load(company_id))

    async def _load(self, company_id: uuid.UUID) -> ExtractionContext:
        async with self._uow() as uow:
            company = await uow.companies.get(company_id)
            concepts = await uow.concepts.list_for_company(company_id) if company else []
            categories = await uow.categories.list_for_company(company_id) if company else []
            limit = (await self._settings.current()).learning_prompt_examples
            learned = await uow.examples.recent(company_id, limit) if company and limit else []
        if company is None:
            return ExtractionContext()
        return ExtractionContext(
            company.name,
            company.country,
            company.currency,
            tuple(ConceptHint(c.code, c.name, c.description, tuple(c.examples)) for c in concepts),
            tuple(CategoryHint(c.code, c.name, c.emoji) for c in categories),
            company.timezone,
            tuple(LearnedExample(e.original_text, None if e.label == NO_CONCEPT else e.label) for e in learned),
        )

    async def invalidate(self) -> None:
        await self._cache.invalidate()


@dataclass(frozen=True)
class CategoryData:
    code: str
    name: str
    emoji: str | None = None
    accounting_account: str | None = None
    position: int = 0
    active: bool = True


@dataclass(frozen=True)
class RuleUpdate:
    rule_type: str
    action: PolicyAction
    params: dict[str, Any]
    active: bool = True


@dataclass(frozen=True)
class ConceptData:
    code: str
    name: str
    description: str | None = None
    examples: list[str] | None = None
    active: bool = True
    deductible: bool = False


class PolicyConfigService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        contexts: CompanyContextProvider,
        clock: Clock,
        settings: SettingsService,
    ) -> None:
        self._uow = uow
        self._access = access
        self._contexts = contexts
        self._clock = clock
        self._settings = settings

    def _check(self, actor: Employee, company_id: uuid.UUID, manage: bool) -> None:
        if manage:
            self._access.require(actor, Permission.POLICIES_MANAGE)
        if not (actor.is_admin or actor.works_for(company_id)):
            raise NotFoundError("company")

    async def rules(self, actor: Employee, company_id: uuid.UUID) -> list[EffectiveRule]:
        self._check(actor, company_id, manage=False)
        defaults = (await self._settings.current()).policy_rule_defaults
        async with self._uow() as uow:
            return effective_rules(await uow.policy_rules.list_for_company(company_id), defaults)

    async def update_rules(self, actor: Employee, company_id: uuid.UUID, updates: list[RuleUpdate]) -> list[EffectiveRule]:
        self._check(actor, company_id, manage=True)
        defaults = (await self._settings.current()).policy_rule_defaults
        for update in updates:
            if update.rule_type not in RULES or update.rule_type not in defaults:
                raise ValidationError("Unknown rule type", code="unknown_rule_type", rule=update.rule_type)
            unknown = set(update.params) - set(defaults[update.rule_type]["params"])
            if unknown:
                raise ValidationError(
                    "Unknown rule parameters",
                    code="unknown_rule_params",
                    rule=update.rule_type,
                    params=", ".join(sorted(unknown)),
                )
        async with self._uow() as uow:
            stored = {r.rule_type: r for r in await uow.policy_rules.list_for_company(company_id)}
            for update in updates:
                rule = stored.get(update.rule_type)
                if rule is None:
                    rule = PolicyRuleConfig(company_id, update.rule_type, update.action)
                    await uow.policy_rules.add(rule)
                rule.action, rule.params, rule.active = update.action, dict(update.params), update.active
                rule.updated_by, rule.updated_at = actor.id, self._clock.now()
            await uow.audit.add(
                AuditEntry(
                    "policy_rules_updated",
                    "company",
                    str(company_id),
                    actor.id,
                    data={"rules": [u.__dict__ for u in updates]},
                )
            )
            await uow.commit()
            return effective_rules(await uow.policy_rules.list_for_company(company_id), defaults)

    async def concepts(self, actor: Employee, company_id: uuid.UUID) -> list[BlockedConcept]:
        self._check(actor, company_id, manage=False)
        async with self._uow() as uow:
            return await uow.concepts.list_for_company(company_id, active_only=False)

    async def add_concept(self, actor: Employee, company_id: uuid.UUID, data: ConceptData) -> BlockedConcept:
        self._check(actor, company_id, manage=True)
        if not _CODE_RE.match(data.code):
            raise ValidationError("Invalid concept code", code="invalid_concept_code")
        concept = BlockedConcept(
            company_id, data.code, data.name.strip(), data.description, list(data.examples or []), data.active, data.deductible
        )
        async with self._uow() as uow:
            existing = await uow.concepts.list_for_company(company_id, active_only=False)
            if any(c.code == data.code for c in existing):
                raise ConflictError("A concept with that code already exists", code="concept_exists")
            await uow.concepts.add(concept)
            await uow.audit.add(
                AuditEntry("blocked_concept_created", "company", str(company_id), actor.id, data={"code": data.code})
            )
            await uow.commit()
        await self._contexts.invalidate()
        return concept

    async def update_concept(
        self, actor: Employee, company_id: uuid.UUID, concept_id: uuid.UUID, changes: dict[str, Any]
    ) -> BlockedConcept:
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            concept = await uow.concepts.get(concept_id)
            if concept is None or concept.company_id != company_id:
                raise NotFoundError("blocked concept")
            for name in ("name", "description", "examples", "active", "deductible"):
                if name in changes and changes[name] is not None:
                    setattr(concept, name, list(changes[name]) if name == "examples" else changes[name])
            await uow.audit.add(AuditEntry("blocked_concept_updated", "company", str(company_id), actor.id, data=changes))
            await uow.commit()
        await self._contexts.invalidate()
        return concept

    async def categories(self, actor: Employee, company_id: uuid.UUID) -> list[Category]:
        self._check(actor, company_id, manage=False)
        async with self._uow() as uow:
            return await uow.categories.list_for_company(company_id, active_only=False)

    async def add_category(self, actor: Employee, company_id: uuid.UUID, data: CategoryData) -> Category:
        self._check(actor, company_id, manage=True)
        if not _CODE_RE.match(data.code):
            raise ValidationError("Invalid category code", code="invalid_concept_code")
        category = Category(
            company_id, data.code, data.name.strip(), data.emoji, data.accounting_account, data.position, data.active
        )
        async with self._uow() as uow:
            if any(c.code == data.code for c in await uow.categories.list_for_company(company_id, active_only=False)):
                raise ConflictError("A category with that code already exists", code="category_exists")
            await uow.categories.add(category)
            await uow.audit.add(AuditEntry("category_created", "company", str(company_id), actor.id, data={"code": data.code}))
            await uow.commit()
        await self._contexts.invalidate()
        return category

    async def update_category(
        self, actor: Employee, company_id: uuid.UUID, category_id: uuid.UUID, changes: dict[str, Any]
    ) -> Category:
        """Las categorías no se borran (los gastos viejos las referencian): se desactivan."""
        self._check(actor, company_id, manage=True)
        async with self._uow() as uow:
            category = await uow.categories.get(category_id)
            if category is None or category.company_id != company_id:
                raise NotFoundError("category")
            for name in ("name", "emoji", "accounting_account", "position", "active"):
                if name in changes and changes[name] is not None:
                    setattr(category, name, changes[name])
            await uow.audit.add(AuditEntry("category_updated", "company", str(company_id), actor.id, data=changes))
            await uow.commit()
        await self._contexts.invalidate()
        return category
