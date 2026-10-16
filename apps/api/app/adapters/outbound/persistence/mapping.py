"""Mapeo imperativo para que las dataclasses del dominio no hereden de clases base del ORM."""

from __future__ import annotations

from sqlalchemy.orm import registry

from app.adapters.outbound.persistence import tables as t
from app.domain.entities import (
    Advance,
    ApproverDelegation,
    AuditEntry,
    BlockedConcept,
    Category,
    ClassificationExample,
    Company,
    Employee,
    ExampleHistory,
    ExchangeRate,
    Expense,
    ExpenseLine,
    ExtractionAttempt,
    InboundMessage,
    PolicyRuleConfig,
    RefreshToken,
    TravelBudgetRate,
    TravelZone,
    WhatsAppLinkCode,
    WhatsAppSession,
)
from app.domain.settings import SystemSetting

mapper_registry = registry(metadata=t.metadata)
_started = False


def start_mappers() -> None:
    global _started
    if _started:
        return
    mapper_registry.map_imperatively(Company, t.companies)
    mapper_registry.map_imperatively(Employee, t.employees)
    mapper_registry.map_imperatively(RefreshToken, t.refresh_tokens)
    mapper_registry.map_imperatively(WhatsAppLinkCode, t.whatsapp_link_codes)
    mapper_registry.map_imperatively(Advance, t.advances)
    mapper_registry.map_imperatively(Expense, t.expenses)
    mapper_registry.map_imperatively(ExtractionAttempt, t.extraction_attempts)
    mapper_registry.map_imperatively(AuditEntry, t.audit_log)
    mapper_registry.map_imperatively(InboundMessage, t.inbound_messages)
    mapper_registry.map_imperatively(BlockedConcept, t.blocked_concepts)
    mapper_registry.map_imperatively(PolicyRuleConfig, t.policy_rules)
    mapper_registry.map_imperatively(ExpenseLine, t.expense_lines)
    mapper_registry.map_imperatively(SystemSetting, t.system_settings)
    mapper_registry.map_imperatively(Category, t.expense_categories)
    mapper_registry.map_imperatively(ExchangeRate, t.exchange_rates)
    mapper_registry.map_imperatively(TravelZone, t.travel_zones)
    mapper_registry.map_imperatively(TravelBudgetRate, t.travel_budget_rates)
    mapper_registry.map_imperatively(ApproverDelegation, t.approver_delegations)
    mapper_registry.map_imperatively(ClassificationExample, t.classification_examples)
    mapper_registry.map_imperatively(ExampleHistory, t.classification_example_history)
    mapper_registry.map_imperatively(WhatsAppSession, t.whatsapp_sessions)
    _started = True
