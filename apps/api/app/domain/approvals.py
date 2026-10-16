"""Ruta de aprobación de una solicitud de anticipo (decisiones 4.1 a 4.5).

El jefe inmediato aprueba. Si la solicitud supera el presupuesto calculado más la tolerancia, o el
monto total configurado, escala al jefe directivo (el jefe del jefe), que puede aprobar sin esperar al
jefe inmediato. Los viajes de quien no tiene jefe (directivos) los aprueba la gerencia."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.domain.enums import ApprovalLevel, StepStatus
from app.domain.errors import ValidationError


@dataclass(frozen=True)
class Approver:
    id: uuid.UUID
    name: str


def escalation_reasons(
    amount: Decimal,
    currency: str,
    budget: Decimal | None,
    tolerance_pct: Decimal,
    thresholds: dict[str, str],
) -> list[dict[str, Any]]:
    """Por qué la solicitud necesita al jefe directivo; vacío = basta el jefe inmediato."""
    reasons: list[dict[str, Any]] = []
    if budget is not None and amount > budget * (1 + tolerance_pct / 100):
        reasons.append({"code": "over_budget", "budget": str(budget), "tolerance_pct": str(tolerance_pct)})
    threshold = thresholds.get(currency.upper())
    if threshold is not None and amount > Decimal(threshold):
        reasons.append({"code": "over_threshold", "threshold": threshold})
    return reasons


def build_route(
    requester_id: uuid.UUID, boss: Approver | None, director: Approver | None, escalated: bool
) -> list[dict[str, Any]]:
    """Pasos en orden. La misma persona aprueba una sola vez, en el nivel más alto; nadie aprueba lo suyo."""
    boss = boss if boss and boss.id != requester_id else None
    director = director if director and director.id != requester_id else None
    if boss is None:
        return [_step(ApprovalLevel.MANAGEMENT, None)]
    if not escalated:
        return [_step(ApprovalLevel.BOSS, boss)]
    superior = _step(ApprovalLevel.DIRECTOR, director) if director else _step(ApprovalLevel.MANAGEMENT, None)
    if director is not None and director.id == boss.id:
        return [superior]
    return [_step(ApprovalLevel.BOSS, boss), superior]


def _step(level: ApprovalLevel, approver: Approver | None) -> dict[str, Any]:
    # La gerencia no es una persona fija: decide cualquier usuario de gerencia de la compañía.
    return {
        "level": level.value,
        "approver_id": str(approver.id) if approver else None,
        "approver_name": approver.name if approver else None,
        "status": StepStatus.PENDING.value,
        "decided_by": None,
        "decided_at": None,
        "note": None,
    }


def check_thresholds(thresholds: dict[str, Any]) -> dict[str, str]:
    """Umbral por moneda: positivo y con código de 3 letras."""
    clean: dict[str, str] = {}
    for currency, value in thresholds.items():
        try:
            amount = Decimal(str(value))
        except ArithmeticError as exc:
            raise ValidationError("Invalid threshold", code="invalid_approval_threshold") from exc
        if len(currency) != 3 or not currency.isalpha() or not amount.is_finite() or amount <= 0:
            raise ValidationError("Invalid threshold", code="invalid_approval_threshold")
        clean[currency.upper()] = str(amount)
    return clean
