from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.domain.approvals import Approver, build_route, check_thresholds, escalation_reasons
from app.domain.errors import ValidationError

ME, BOSS, DIRECTOR = (Approver(uuid.uuid4(), name) for name in ("Ana", "Carlos", "Diana"))


def _levels(steps: list[dict]) -> list[tuple[str, str | None]]:  # type: ignore[type-arg]
    return [(s["level"], s["approver_name"]) for s in steps]


def test_escalation_needs_more_than_the_tolerance_or_the_threshold() -> None:
    budget = Decimal("500000")
    assert escalation_reasons(Decimal("550000"), "COP", budget, Decimal(10), {}) == []  # justo el 10 %
    over = escalation_reasons(Decimal("550001"), "COP", budget, Decimal(10), {})
    assert [r["code"] for r in over] == ["over_budget"]
    assert escalation_reasons(Decimal("900"), "USD", None, Decimal(10), {"USD": "1000"}) == []
    assert [r["code"] for r in escalation_reasons(Decimal("1000.01"), "usd", None, Decimal(10), {"USD": "1000"})] == [
        "over_threshold"
    ]


def test_route_by_case() -> None:
    assert _levels(build_route(ME.id, BOSS, DIRECTOR, escalated=False)) == [("boss", "Carlos")]
    assert _levels(build_route(ME.id, BOSS, DIRECTOR, escalated=True)) == [("boss", "Carlos"), ("director", "Diana")]
    # Directivos (sin jefe): gerencia, que no es una persona fija.
    assert _levels(build_route(ME.id, None, None, escalated=True)) == [("management", None)]
    # Escala y el jefe no tiene jefe: sube a gerencia.
    assert _levels(build_route(ME.id, BOSS, None, escalated=True)) == [("boss", "Carlos"), ("management", None)]
    # La misma persona aprueba una sola vez, en el nivel más alto; nadie se aprueba a sí mismo.
    assert _levels(build_route(ME.id, BOSS, BOSS, escalated=True)) == [("director", "Carlos")]
    assert _levels(build_route(ME.id, ME, None, escalated=False)) == [("management", None)]


def test_thresholds_are_validated() -> None:
    assert check_thresholds({"usd": 1000}) == {"USD": "1000"}
    for wrong in ({"US": 10}, {"USD": 0}, {"USD": "abc"}):
        with pytest.raises(ValidationError):
            check_thresholds(wrong)
