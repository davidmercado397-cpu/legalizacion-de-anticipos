"""Compañías del grupo cliente (Colombia, Panamá, México...)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.application.access import AccessPolicy
from app.application.settings import SettingsService, check_currency
from app.domain.approvals import check_thresholds
from app.domain.entities import AuditEntry, Company, Employee, blocked_concepts_from, categories_from
from app.domain.enums import Deductibility, DocumentType, ExchangeRatePolicy
from app.domain.errors import NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import UnitOfWorkFactory
from app.domain.time import is_valid_timezone

_EDITABLE = (
    "name",
    "legal_name",
    "country",
    "currency",
    "tax_id",
    "is_test",
    "active",
    "generic_tax_id",
    "deductibility",
    "timezone",
    "exchange_rate_policy",
)


@dataclass(frozen=True)
class CompanyData:
    name: str
    country: str
    currency: str
    tax_id: str | None = None
    is_test: bool = False
    legal_name: str | None = None
    timezone: str | None = None  # None = la del país (defaults.countries)


def _check_codes(country: str | None, timezone: str | None) -> None:
    if country is not None and (len(country) != 2 or not country.isalpha()):
        raise ValidationError("Invalid country code", code="invalid_country")
    if timezone is not None and not is_valid_timezone(timezone):
        raise ValidationError("Invalid time zone", code="invalid_timezone", timezone=timezone)


class CompanyService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy, settings: SettingsService) -> None:
        self._uow = uow
        self._access = access
        self._settings = settings

    async def create(self, actor: Employee, data: CompanyData) -> Company:
        self._access.require(actor, Permission.COMPANIES_MANAGE)
        _check_codes(data.country, data.timezone)
        defaults = await self._settings.current()
        check_currency(data.currency, defaults.supported_currencies)
        country = defaults.country_defaults.get(data.country.upper())
        if country is None and data.timezone is None:
            raise ValidationError("Unknown country", code="unknown_country", country=data.country.upper())
        company = Company(
            data.name.strip(),
            data.country,
            data.currency,
            data.tax_id,
            data.is_test,
            generic_tax_id=(country or {}).get("generic_tax_id"),
            deductibility=dict(defaults.deductibility_defaults),
            legal_name=data.legal_name,
            timezone=data.timezone or (country or {})["timezone"],
            exchange_rate_policy=ExchangeRatePolicy(defaults.exchange_rate_policy_default),
        )
        async with self._uow() as uow:
            await uow.companies.add(company)
            await uow.flush()  # sin relaciones ORM: la compañía debe existir antes que sus conceptos
            for concept in blocked_concepts_from(company.id, defaults.blocked_concept_defaults):
                await uow.concepts.add(concept)
            for category in categories_from(company.id, defaults.category_defaults):
                await uow.categories.add(category)
            await uow.audit.add(AuditEntry("company_created", "company", str(company.id), actor.id, data={"name": company.name}))
            await uow.commit()
        return company

    async def search(self, actor: Employee) -> list[Company]:
        async with self._uow() as uow:
            return await uow.companies.find(None if actor.is_admin else list(actor.company_ids))

    async def get(self, actor: Employee, company_id: uuid.UUID) -> Company:
        async with self._uow() as uow:
            company = await uow.companies.get(company_id)
        if company is None or not (actor.is_admin or actor.works_for(company_id)):
            raise NotFoundError("company")
        return company

    async def approval_rules(self, actor: Employee, company_id: uuid.UUID) -> ApprovalRules:
        company = await self.get(actor, company_id)
        return ApprovalRules(company.approval_tolerance_pct, dict(company.approval_thresholds))

    async def set_approval_rules(self, actor: Employee, company_id: uuid.UUID, rules: ApprovalRules) -> ApprovalRules:
        """Cuándo una solicitud escala al jefe directivo (decisiones 4.1 y 4.2): lo ajusta contabilidad."""
        self._access.require(actor, Permission.POLICIES_MANAGE)
        if not Decimal(0) <= rules.tolerance_pct <= Decimal(100):
            raise ValidationError("Invalid tolerance", code="invalid_approval_tolerance")
        thresholds = check_thresholds(rules.thresholds)
        async with self._uow() as uow:
            company = await uow.companies.get(company_id)
            if company is None or not (actor.is_admin or actor.works_for(company_id)):
                raise NotFoundError("company")
            before = {"tolerance_pct": str(company.approval_tolerance_pct), "thresholds": company.approval_thresholds}
            company.approval_tolerance_pct, company.approval_thresholds = rules.tolerance_pct, thresholds
            after = {"tolerance_pct": str(rules.tolerance_pct), "thresholds": thresholds}
            await uow.audit.add(
                AuditEntry(
                    "approval_rules_updated", "company", str(company.id), actor.id, data={"before": before, "after": after}
                )
            )
            await uow.commit()
        return ApprovalRules(rules.tolerance_pct, thresholds)

    async def update(self, actor: Employee, company_id: uuid.UUID, changes: dict[str, Any]) -> Company:
        self._access.require(actor, Permission.COMPANIES_MANAGE)
        _check_codes(changes.get("country"), changes.get("timezone"))
        supported = (await self._settings.current()).supported_currencies
        check_currency(changes.get("currency"), supported)
        if changes.get("deductibility") is not None:
            for doc_type, value in changes["deductibility"].items():
                if doc_type not in DocumentType._value2member_map_ or value not in Deductibility._value2member_map_:
                    raise ValidationError("Invalid deductibility rule", code="invalid_deductibility", document_type=doc_type)
        async with self._uow() as uow:
            company = await uow.companies.get(company_id)
            if company is None:
                raise NotFoundError("company")
            for name in _EDITABLE:
                if name in changes and changes[name] is not None:
                    value = changes[name]
                    setattr(company, name, value.upper() if name in ("country", "currency") else value)
            if "cash_international_cap" in changes:
                company.cash_international_cap = _cash_cap(changes["cash_international_cap"], supported)
            await uow.audit.add(AuditEntry("company_updated", "company", str(company.id), actor.id, data=changes))
            await uow.commit()
        return company


@dataclass(frozen=True)
class ApprovalRules:
    tolerance_pct: Decimal
    thresholds: dict[str, str]


def _cash_cap(value: dict[str, Any] | None, supported: list[str]) -> dict[str, str] | None:
    """None borra el tope; si llega, el valor debe ser positivo y la moneda habilitada."""
    if value is None:
        return None
    amount, currency = value.get("amount"), str(value.get("currency") or "").upper()
    if amount is None or Decimal(str(amount)) <= 0 or currency not in supported:
        raise ValidationError("Invalid cash cap", code="invalid_cash_cap")
    return {"amount": str(amount), "currency": currency}
