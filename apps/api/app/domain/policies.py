"""Motor de políticas de gastos.

Los *tipos* de regla son clases Strategy en código (Open/Closed: regla nueva = clase nueva en el
registro). Sus parámetros, acción (warn / require_justification / block) y encendido/apagado son datos
guardados por compañía. La evaluación es determinista y auditable: cada hallazgo registra la regla, la
acción y los parámetros que lo dispararon. La IA nunca decide el cumplimiento; solo lee hechos."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.domain.entities import Advance, BlockedConcept, Company, Expense, ExpenseLine, PolicyRuleConfig
from app.domain.enums import Deductibility, DocumentType, PolicyAction
from app.domain.fiscal import is_valid_colombian_nit, same_tax_id
from app.domain.settings import SettingMissingError


@dataclass(frozen=True)
class PolicyContext:
    expense: Expense
    lines: list[ExpenseLine]
    company: Company
    advance: Advance | None = None
    concepts: dict[str, BlockedConcept] = field(default_factory=dict)
    is_duplicate: bool = False
    non_fiscal_month_total: Decimal = Decimal(0)  # otros recibos de caja del empleado en el mes
    non_fiscal_year_total: Decimal = Decimal(0)
    group_companies: dict[str, str] = field(default_factory=dict)  # NIT -> nombre de las otras compañías del grupo
    generic_buyer_ids: tuple[str, ...] = ()  # consumidor final / extranjero genéricos del país

    @property
    def is_foreign(self) -> bool:
        """Factura de otro país (el empleado viajó): no se le exige el NIT de la compañía."""
        return bool(self.expense.country) and self.expense.country != self.company.country


@dataclass(frozen=True)
class Finding:
    rule: str
    action: PolicyAction
    code: str
    detail: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {"rule": self.rule, "action": self.action.value, "code": self.code, "detail": self.detail}


@dataclass(frozen=True)
class PolicyResult:
    findings: list[Finding]
    suggested_non_reimbursable: Decimal | None
    deductibility: Deductibility


class PolicyRule(ABC):
    """Comportamiento de un tipo de regla. Su acción y parámetros por defecto son datos (llave
    defaults.policy_rules) y cada compañía puede sobrescribirlos."""

    rule_type: str

    @abstractmethod
    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]: ...


def _dec(value: Any) -> Decimal | None:
    return None if value in (None, "") else Decimal(str(value))


class DuplicateRule(PolicyRule):
    rule_type = "duplicate"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        return [Finding(self.rule_type, action, "duplicate_invoice")] if ctx.is_duplicate else []


class MissingTaxIdRule(PolicyRule):
    rule_type = "missing_tax_id"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e = ctx.expense
        if e.document_type == DocumentType.CASH_RECEIPT:
            return []  # los recibos sin tercero los maneja la regla de documento no fiscal
        invalid = (e.country or ctx.company.country) == "CO" and is_valid_colombian_nit(e.vendor_tax_id) is False
        if e.vendor_tax_id and not invalid:
            return []
        code = "invalid_tax_id" if invalid else "missing_tax_id"
        return [Finding(self.rule_type, action, code, {"generic_tax_id": ctx.company.generic_tax_id})]


def trip_margins(params: dict[str, Any]) -> tuple[int, int]:
    """Días aceptados antes de la salida y después del regreso (antes era una sola tolerancia simétrica)."""
    legacy = int(params.get("tolerance_days", 0))
    return int(params.get("days_before", legacy)), int(params.get("days_after", legacy))


class OutsideTripDatesRule(PolicyRule):
    rule_type = "outside_trip_dates"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        if ctx.advance is None or ctx.expense.invoice_date is None:
            return []
        if ctx.advance.covers(ctx.expense.invoice_date, *trip_margins(params)):
            return []
        detail = {
            "invoice_date": str(ctx.expense.invoice_date),
            "start": str(ctx.advance.start_date),
            "end": str(ctx.advance.end_date),
        }
        return [Finding(self.rule_type, action, "outside_trip_dates", detail)]


class BlockedConceptRule(PolicyRule):
    rule_type = "blocked_concept"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        min_confidence = float(params["min_confidence"])
        sure: list[dict[str, Any]] = []
        possible: list[dict[str, Any]] = []
        overridden: list[dict[str, Any]] = []
        for line in ctx.lines:
            if line.similar_concept_code in ctx.concepts and not line.is_blocked:
                # Se parece a una línea que alguien corrigió como bloqueada: solo alerta, nunca etiqueta.
                possible.append(
                    {
                        "position": line.position,
                        "description": line.description,
                        "concept": line.similar_concept_code,
                        "concept_name": ctx.concepts[line.similar_concept_code or ""].name,
                        "similar_to": line.similar_text,
                    }
                )
            if line.ai_concept_code and not line.is_blocked and line.corrected_by == ctx.expense.employee_id:
                # El dueño quitó un concepto bloqueado que marcó la IA: lo ve el aprobador aunque desaparezca.
                overridden.append({"position": line.position, "description": line.description, "concept": line.ai_concept_code})
            if not line.is_blocked or line.final_concept_code not in ctx.concepts:
                continue
            item = {
                "position": line.position,
                "description": line.description,
                "concept": line.final_concept_code,
                "concept_name": ctx.concepts[line.final_concept_code].name,
                "amount": str(line.amount) if line.amount is not None else None,
            }
            # Una corrección humana (directa o aprendida) es segura; lo de la IA solo cuenta sobre el umbral.
            human = line.corrected_by is not None or line.memory_example_id is not None
            confident = human or (line.ai_concept_confidence or 0) >= min_confidence
            (sure if confident else possible).append(item)
        findings = []
        if sure:
            findings.append(Finding(self.rule_type, action, "blocked_concept", {"lines": sure}))
        if possible:
            findings.append(Finding(self.rule_type, PolicyAction.WARN, "possible_blocked_concept", {"lines": possible}))
        if overridden:
            findings.append(Finding(self.rule_type, action, "owner_concept_override", {"lines": overridden}))
        return findings


_RECEIPT_FIELDS = {
    "concept": lambda e: e.description,
    "date": lambda e: e.invoice_date,
    "total": lambda e: e.total,
    "vendor": lambda e: e.vendor_name,
    "vendor_tax_id": lambda e: e.vendor_tax_id,
}


class NonFiscalDocumentRule(PolicyRule):
    """Recibos de caja y notas a mano: datos mínimos (configurables) y topes por recibo, mes y año."""

    rule_type = "non_fiscal_document"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e = ctx.expense
        if e.document_type != DocumentType.CASH_RECEIPT:
            return []
        findings = []
        missing = [
            name for name in params.get("required_fields") or [] if name in _RECEIPT_FIELDS and not _RECEIPT_FIELDS[name](e)
        ]
        if missing:
            findings.append(Finding(self.rule_type, action, "receipt_missing_data", {"fields": missing}))
        if not e.receipt_signed:
            findings.append(Finding(self.rule_type, action, "receipt_not_signed"))
        if e.total is None or e.currency != ctx.company.currency:
            return findings
        checks = (
            ("max_per_receipt", e.total, "receipt_cap_exceeded"),
            ("max_monthly", ctx.non_fiscal_month_total + e.total, "monthly_cap_exceeded"),
            ("max_yearly", ctx.non_fiscal_year_total + e.total, "yearly_cap_exceeded"),
        )
        for param, value, code in checks:
            cap = _dec(params.get(param))
            if cap is not None and value > cap:
                findings.append(Finding(self.rule_type, action, code, {"cap": str(cap), "value": str(value)}))
        return findings


class BuyerNotCompanyRule(PolicyRule):
    """La factura electrónica debe venir a nombre de la compañía del anticipo: sin eso no es deducible.
    Si viene a nombre de otra compañía del grupo, se alerta para reclasificarla entre compañías."""

    rule_type = "buyer_not_company"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e, company = ctx.expense, ctx.company
        if e.document_type != DocumentType.ELECTRONIC_INVOICE or ctx.is_foreign or not company.tax_id:
            return []
        buyer = e.buyer_tax_id
        if same_tax_id(buyer, company.tax_id):
            return []
        if buyer and not any(same_tax_id(buyer, generic) for generic in ctx.generic_buyer_ids):
            for tax_id, name in ctx.group_companies.items():
                if same_tax_id(buyer, tax_id):
                    return [Finding(self.rule_type, action, "invoice_to_other_group_company", {"company": name})]
        reason = "missing" if not buyer else ("generic" if any(same_tax_id(buyer, g) for g in ctx.generic_buyer_ids) else "other")
        detail = {"reason": reason, "buyer": buyer, "legal_name": company.legal_name or company.name, "tax_id": company.tax_id}
        return [Finding(self.rule_type, action, "invoice_not_to_company", detail)]


class MissingFiscalIdRule(PolicyRule):
    """Factura electrónica sin CUFE (Colombia), UUID (México) o chave de acesso (Brasil): la decide contabilidad
    (decisión 5.3). Los tiquetes POS no lo traen y se aceptan (5.7). Solo aplica en los países de `countries`,
    donde la factura electrónica siempre lo trae."""

    rule_type = "missing_fiscal_id"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e = ctx.expense
        if e.document_type != DocumentType.ELECTRONIC_INVOICE or (e.fiscal_id or "").strip():
            return []
        if e.country not in (params.get("countries") or ()):
            return []
        return [Finding(self.rule_type, action, "missing_fiscal_id")]


class ExcessiveTipRule(PolicyRule):
    """La propina se acepta hasta la sugerida (decisión 3.3, en Colombia el 10 % del consumo); el exceso
    queda como no reembolsable si contabilidad acepta el gasto sin lo no permitido."""

    rule_type = "excessive_tip"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e = ctx.expense
        pct = _dec(params.get("suggested_pct"))
        if pct is None or not e.tip_amount or e.tip_amount <= 0 or e.total is None:
            return []
        base = e.subtotal if e.subtotal is not None else e.total - e.tip_amount - (e.tax_amount or Decimal(0))
        suggested = (base * pct / 100).quantize(Decimal("0.01"))
        if base <= 0 or e.tip_amount <= suggested:
            return []
        excess = e.tip_amount - suggested
        detail = {"tip": str(e.tip_amount), "suggested": str(suggested), "excess": str(excess), "pct": str(pct)}
        return [Finding(self.rule_type, action, "excessive_tip", detail)]


class CashWithoutWithdrawalRule(PolicyRule):
    """Pagado en efectivo en otra moneda sin un retiro registrado que lo cubra: se valoró con la tasa del día de
    la factura en vez de la del retiro, así que contabilidad lo revisa (no frena al viajero)."""

    rule_type = "cash_without_withdrawal"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        uncovered = ctx.expense.cash_uncovered
        if not uncovered or uncovered <= 0:
            return []
        return [Finding(self.rule_type, action, "cash_without_withdrawal", {"value": str(uncovered)})]


class ItemizedRequiredRule(PolicyRule):
    rule_type = "itemized_required"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        e = ctx.expense
        limit = _dec(params.get("above_amount"))
        if limit is None or e.itemized or e.total is None or e.currency != ctx.company.currency or e.total <= limit:
            return []
        return [Finding(self.rule_type, action, "not_itemized", {"above_amount": str(limit)})]


class LowConfidenceRule(PolicyRule):
    rule_type = "low_confidence"

    def evaluate(self, ctx: PolicyContext, params: dict[str, Any], action: PolicyAction) -> list[Finding]:
        confidence = ctx.expense.ai_confidence
        if confidence is None or confidence >= float(params["threshold"]):
            return []
        return [Finding(self.rule_type, action, "low_confidence", {"confidence": round(confidence, 2)})]


RULES: dict[str, PolicyRule] = {
    rule.rule_type: rule
    for rule in (
        DuplicateRule(),
        MissingTaxIdRule(),
        OutsideTripDatesRule(),
        BlockedConceptRule(),
        NonFiscalDocumentRule(),
        BuyerNotCompanyRule(),
        MissingFiscalIdRule(),
        ExcessiveTipRule(),
        CashWithoutWithdrawalRule(),
        ItemizedRequiredRule(),
        LowConfidenceRule(),
    )
}


@dataclass(frozen=True)
class EffectiveRule:
    rule_type: str
    action: PolicyAction
    params: dict[str, Any]
    active: bool
    customized: bool


def effective_rules(configs: list[PolicyRuleConfig], defaults: dict[str, Any]) -> list[EffectiveRule]:
    """Valores por defecto (datos del sistema) sobrescritos por la configuración de la compañía."""
    by_type = {c.rule_type: c for c in configs}
    result = []
    for rule_type in RULES:
        default = defaults.get(rule_type)
        if default is None:
            raise SettingMissingError(f"defaults.policy_rules.{rule_type}")
        stored = by_type.get(rule_type)
        params = {**default["params"], **(stored.params if stored else {})}
        result.append(
            EffectiveRule(
                rule_type,
                stored.action if stored else PolicyAction(default["action"]),
                params,
                stored.active if stored else True,
                stored is not None,
            )
        )
    return result


class PolicyEngine:
    def evaluate(self, ctx: PolicyContext, configs: list[PolicyRuleConfig], defaults: dict[str, Any]) -> PolicyResult:
        findings: list[Finding] = []
        for rule in effective_rules(configs, defaults):
            if rule.active:
                findings.extend(RULES[rule.rule_type].evaluate(ctx, rule.params, rule.action))
        return PolicyResult(findings, self._suggested_non_reimbursable(ctx, findings), suggest_deductibility(ctx, findings))

    @staticmethod
    def _suggested_non_reimbursable(ctx: PolicyContext, findings: list[Finding]) -> Decimal | None:
        """Líneas bloqueadas más su parte de impuestos y propina (total × líneas bloqueadas / todas las líneas),
        más la propina que pasa de la sugerida."""
        total = ctx.expense.total
        if not total:
            return None
        tip_excess = sum((Decimal(f.detail["excess"]) for f in findings if f.code == "excessive_tip"), Decimal(0))
        blocked_positions = {
            item["position"] for f in findings if f.code == "blocked_concept" for item in f.detail.get("lines", [])
        }
        amounts = [line.amount for line in ctx.lines if line.amount is not None]
        lines_sum = sum(amounts, Decimal(0))
        blocked = Decimal(0)
        if blocked_positions and lines_sum > 0:
            blocked_sum = sum((line.amount or Decimal(0) for line in ctx.lines if line.position in blocked_positions), Decimal(0))
            blocked = (total * blocked_sum / lines_sum).quantize(Decimal("0.01"))
        if not blocked and not tip_excess:
            return None
        return min(total, blocked + tip_excess)


def suggest_deductibility(ctx: PolicyContext, findings: list[Finding]) -> Deductibility:
    """Sugerencia para contabilidad (el criterio tributario lo define Forsa): exterior según la
    compañía, factura que no está a su nombre no es deducible y lo demás según el tipo de documento."""
    if ctx.is_foreign:
        return ctx.company.deductibility_for("foreign_invoice")
    if any(f.code == "invoice_not_to_company" for f in findings):
        return Deductibility.NON_DEDUCTIBLE
    return ctx.company.deductibility_for(ctx.expense.document_type)
