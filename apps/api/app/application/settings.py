"""Parámetros del sistema (tabla llave-valor). Los administra solo el superadmin (NextByte).

Los valores viven únicamente en la BD (cargados por migración y editados por API); aquí solo están
los nombres de las llaves y su tipo de Python para leerlas."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any

from app.application.access import AccessPolicy
from app.application.cache import SharedCache
from app.domain.entities import AuditEntry, Employee
from app.domain.errors import ValidationError
from app.domain.permissions import Permission
from app.domain.ports import CacheVersions, Clock, UnitOfWorkFactory
from app.domain.settings import SettingMissingError, SystemSetting


def _key(name: str) -> Any:
    return field(metadata={"key": name})


@dataclass(frozen=True)
class RuntimeSettings:
    whatsapp_welcome_template: str = _key("whatsapp.welcome_template")
    whatsapp_approval_template: str = _key("whatsapp.approval_template")
    whatsapp_template_language: str = _key("whatsapp.template_language")
    whatsapp_batch_grace_seconds: float = _key("whatsapp.batch_grace_seconds")
    whatsapp_slow_notice_seconds: float = _key("whatsapp.slow_notice_seconds")
    whatsapp_session_ttl_minutes: int = _key("whatsapp.session_ttl_minutes")
    whatsapp_notice_template: str = _key("whatsapp.notice_template")
    whatsapp_notice_hold_days: int = _key("whatsapp.notice_hold_days")
    whatsapp_reminder_days: list[int] = _key("whatsapp.reminder_days")
    whatsapp_assistant_name: str = _key("whatsapp.assistant_name")
    whatsapp_keywords: dict[str, list[str]] = _key("whatsapp.keywords")
    whatsapp_flow_advance_request_id: str = _key("whatsapp.flow_advance_request_id")
    whatsapp_flow_expense_correction_id: str = _key("whatsapp.flow_expense_correction_id")
    whatsapp_flow_justification_id: str = _key("whatsapp.flow_justification_id")
    ai_primary_model: str = _key("ai.primary_model")
    ai_lite_model: str = _key("ai.lite_model")
    ai_fallback_model: str = _key("ai.fallback_model")
    ai_availability_fallbacks: list[str] = _key("ai.availability_fallbacks")
    ai_routing: str = _key("ai.routing")
    ai_escalation_threshold: float = _key("ai.escalation_threshold")
    ai_reasoning_off: str = _key("ai.reasoning_off")
    ai_reasoning_on: str = _key("ai.reasoning_on")
    ai_max_tokens: int = _key("ai.max_tokens")
    ai_zero_data_retention: bool = _key("ai.zero_data_retention")
    ai_prompt_version: str = _key("ai.prompt_version")
    image_max_side_px: int = _key("image.max_side_px")
    image_hires_max_side_px: int = _key("image.hires_max_side_px")
    image_blur_threshold: float = _key("image.blur_threshold")
    image_thumbnail_side_px: int = _key("image.thumbnail_side_px")
    policy_rule_defaults: dict[str, Any] = _key("defaults.policy_rules")
    blocked_concept_defaults: list[dict[str, Any]] = _key("defaults.blocked_concepts")
    category_defaults: list[dict[str, Any]] = _key("defaults.categories")
    deductibility_defaults: dict[str, str] = _key("defaults.deductibility")
    country_defaults: dict[str, dict[str, Any]] = _key("defaults.countries")
    supported_currencies: list[str] = _key("operation.supported_currencies")
    currency_aliases: dict[str, str] = _key("operation.currency_aliases")
    exchange_rate_policy_default: str = _key("defaults.exchange_rate_policy")
    exchange_sync_days_back: int = _key("exchange.sync_days_back")
    exchange_max_rate_age_days: int = _key("exchange.max_rate_age_days")
    generic_buyer_ids: dict[str, list[str]] = _key("fiscal.generic_buyer_ids")
    aging_buckets: list[int] = _key("reports.aging_buckets")
    usage_included_documents: int = _key("usage.included_documents")
    usage_extra_document_price: float = _key("usage.extra_document_price")
    usage_price_currency: str = _key("usage.price_currency")
    learning_similarity: float = _key("learning.similarity")
    learning_prompt_examples: int = _key("learning.prompt_examples")
    legalization_deadline_months: int = _key("legalization.deadline_months")
    reconciliation_match: dict[str, Any] = _key("reconciliation.match")
    reconciliation_max_file_mb: int = _key("reconciliation.max_file_mb")
    ai_statement_prompt_version: str = _key("ai.statement_prompt_version")

    @classmethod
    def setting_keys(cls) -> list[str]:
        return [f.metadata["key"] for f in dataclasses.fields(cls)]

    @classmethod
    def from_values(cls, values: dict[str, Any]) -> RuntimeSettings:
        kwargs = {}
        for f in dataclasses.fields(cls):
            key = f.metadata["key"]
            if key not in values:
                raise SettingMissingError(key)
            kwargs[f.name] = values[key]
        return cls(**kwargs)


def check_currency(code: str | None, supported: list[str]) -> None:
    """Las monedas soportadas son configuración del sistema (operation.supported_currencies)."""
    if code is not None and code.upper() not in supported:
        raise ValidationError(
            "Unsupported currency", code="unsupported_currency", currency=code.upper(), supported=", ".join(supported)
        )


class SettingsService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy, clock: Clock, versions: CacheVersions) -> None:
        self._uow = uow
        self._access = access
        self._clock = clock
        self._cache: SharedCache[str, RuntimeSettings] = SharedCache("settings", versions, ttl_seconds=300)

    async def current(self) -> RuntimeSettings:
        return await self._cache.get_or_load("current", self._load)

    async def _load(self) -> RuntimeSettings:
        async with self._uow() as uow:
            rows = await uow.settings.all()
        return RuntimeSettings.from_values({row.key: row.value for row in rows})

    async def missing_keys(self) -> list[str]:
        async with self._uow() as uow:
            present = {row.key for row in await uow.settings.all()}
        return [key for key in RuntimeSettings.setting_keys() if key not in present]

    async def describe(self, actor: Employee) -> list[SystemSetting]:
        self._access.require(actor, Permission.SETTINGS_MANAGE)
        async with self._uow() as uow:
            return await uow.settings.all()

    async def update(self, actor: Employee, changes: dict[str, Any]) -> list[SystemSetting]:
        self._access.require(actor, Permission.SETTINGS_MANAGE)
        now = self._clock.now()
        async with self._uow() as uow:
            rows = {row.key: row for row in await uow.settings.all()}
            unknown = sorted(set(changes) - set(rows))
            if unknown:
                raise ValidationError("Unknown settings", code="unknown_setting", keys=", ".join(unknown))
            before = {key: rows[key].value for key in changes}
            for key, raw in changes.items():
                rows[key].change(raw, actor.id, now)
            after = {key: rows[key].value for key in changes}
            await uow.audit.add(AuditEntry("settings_updated", "system", None, actor.id, data={"before": before, "after": after}))
            await uow.commit()
        await self._cache.invalidate()
        return sorted(rows.values(), key=lambda row: row.key)
