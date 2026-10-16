"""Configuración de negocio por compañía: reglas (acción + parámetros), conceptos bloqueados y categorías."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, status

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import (
    ApprovalRulesIO,
    BlockedConceptIn,
    BlockedConceptOut,
    BlockedConceptPatch,
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    ListOut,
    PolicyRuleIn,
    PolicyRuleOut,
)
from app.application.companies import ApprovalRules
from app.application.messages import RULE_DESCRIPTIONS
from app.application.policies import CategoryData, ConceptData, RuleUpdate
from app.domain.policies import EffectiveRule

router = APIRouter(prefix="/companies/{company_id}", tags=["policies"])


def _rules_out(rules: ApprovalRules) -> ApprovalRulesIO:
    return ApprovalRulesIO(tolerance_pct=rules.tolerance_pct, thresholds={k: Decimal(v) for k, v in rules.thresholds.items()})


@router.get("/approval-rules", response_model=ApprovalRulesIO, summary="When a request escalates to the director")
async def approval_rules(company_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ApprovalRulesIO:
    rules = await container.companies.approval_rules(actor, company_id)
    return _rules_out(rules)


@router.put("/approval-rules", response_model=ApprovalRulesIO, summary="Configure the escalation (accounting)")
async def set_approval_rules(
    company_id: uuid.UUID, body: ApprovalRulesIO, actor: CurrentEmployee, container: ContainerDep
) -> ApprovalRulesIO:
    wanted = ApprovalRules(body.tolerance_pct, {k: str(v) for k, v in body.thresholds.items()})
    rules = await container.companies.set_approval_rules(actor, company_id, wanted)
    return _rules_out(rules)


@router.get("/policy-rules", response_model=ListOut[PolicyRuleOut], summary="Effective rules (defaults + overrides)")
async def list_rules(company_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[PolicyRuleOut]:
    return ListOut[PolicyRuleOut](data=[rule_out(r) for r in await container.policies.rules(actor, company_id)])


@router.put("/policy-rules", response_model=ListOut[PolicyRuleOut], summary="Configure rules (accounting)")
async def update_rules(
    company_id: uuid.UUID, body: list[PolicyRuleIn], actor: CurrentEmployee, container: ContainerDep
) -> ListOut[PolicyRuleOut]:
    updates = [RuleUpdate(r.rule_type, r.action, r.params, r.active) for r in body]
    rules = await container.policies.update_rules(actor, company_id, updates)
    return ListOut[PolicyRuleOut](data=[rule_out(r) for r in rules])


@router.get("/blocked-concepts", response_model=ListOut[BlockedConceptOut])
async def list_concepts(company_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[BlockedConceptOut]:
    concepts = await container.policies.concepts(actor, company_id)
    return ListOut[BlockedConceptOut](data=[BlockedConceptOut.model_validate(c) for c in concepts])


@router.post("/blocked-concepts", response_model=BlockedConceptOut, status_code=status.HTTP_201_CREATED)
async def add_concept(
    company_id: uuid.UUID, body: BlockedConceptIn, actor: CurrentEmployee, container: ContainerDep
) -> BlockedConceptOut:
    concept = await container.policies.add_concept(actor, company_id, ConceptData(**body.model_dump()))
    return BlockedConceptOut.model_validate(concept)


@router.patch("/blocked-concepts/{concept_id}", response_model=BlockedConceptOut)
async def update_concept(
    company_id: uuid.UUID, concept_id: uuid.UUID, body: BlockedConceptPatch, actor: CurrentEmployee, container: ContainerDep
) -> BlockedConceptOut:
    concept = await container.policies.update_concept(actor, company_id, concept_id, body.model_dump(exclude_unset=True))
    return BlockedConceptOut.model_validate(concept)


@router.delete("/blocked-concepts/{concept_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Deactivate a concept")
async def deactivate_concept(
    company_id: uuid.UUID, concept_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep
) -> None:
    await container.policies.update_concept(actor, company_id, concept_id, {"active": False})


@router.get("/categories", response_model=ListOut[CategoryOut], summary="Expense categories (active and inactive)")
async def list_categories(company_id: uuid.UUID, actor: CurrentEmployee, container: ContainerDep) -> ListOut[CategoryOut]:
    categories = await container.policies.categories(actor, company_id)
    return ListOut[CategoryOut](data=[CategoryOut.model_validate(c) for c in categories])


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def add_category(company_id: uuid.UUID, body: CategoryIn, actor: CurrentEmployee, container: ContainerDep) -> CategoryOut:
    category = await container.policies.add_category(actor, company_id, CategoryData(**body.model_dump()))
    return CategoryOut.model_validate(category)


@router.patch("/categories/{category_id}", response_model=CategoryOut, summary="Edit or deactivate a category")
async def update_category(
    company_id: uuid.UUID, category_id: uuid.UUID, body: CategoryPatch, actor: CurrentEmployee, container: ContainerDep
) -> CategoryOut:
    category = await container.policies.update_category(actor, company_id, category_id, body.model_dump(exclude_unset=True))
    return CategoryOut.model_validate(category)


def rule_out(rule: EffectiveRule) -> PolicyRuleOut:
    return PolicyRuleOut(**rule.__dict__, description=RULE_DESCRIPTIONS.get(rule.rule_type, ""))
