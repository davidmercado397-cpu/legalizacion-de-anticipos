"""reglas confirmadas por el negocio: fechas del viaje, CUFE, propina, firma del recibo, plazo y exclusiones

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-19 12:00:00.000000
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Decisiones 2.1 (fechas: 0 días antes, 1 después; lo decide contabilidad), 5.2 (a nombre de otro: decide
# contabilidad), 5.3 (sin CUFE: decide contabilidad) y 3.3 (propina hasta la sugerida, el 10 % del consumo).
RULE_CHANGES: dict[str, dict] = {
    "outside_trip_dates": {"action": "review", "params": {"days_before": 0, "days_after": 1}},
    "buyer_not_company": {"action": "review", "params": {}},
    "missing_fiscal_id": {"action": "review", "params": {"countries": ["CO", "MX", "BR", "PA"]}},
    "excessive_tip": {"action": "review", "params": {"suggested_pct": 10}},
}
PREVIOUS_RULES: dict[str, dict] = {
    "outside_trip_dates": {"action": "require_justification", "params": {"tolerance_days": 1}},
    "buyer_not_company": {"action": "warn", "params": {}},
}

ALCOHOL_EXAMPLES = ["ron", "whisky", "tequila", "vodka", "ginebra", "cachaça", "caipirinha", "sangría", "chopp", "mojito"]
# Decisiones 3.0 y 3.1: cualquier licor; lavandería sí, pero películas, cine y spa no.
NEW_CONCEPTS: list[dict] = [
    {"code": "entertainment", "name": "Entretenimiento",
     "description": "Películas en la habitación, cine, pago por evento y suscripciones de video",
     "examples": ["película", "pay per view", "cine", "Netflix", "movie", "filme"]},
    {"code": "spa", "name": "Spa y masajes", "description": "Spa, masajes, sauna y tratamientos de belleza",
     "examples": ["spa", "masaje", "massage", "sauna", "manicure"]},
]  # fmt: skip
BLOCKED_CONCEPTS: list[dict] = [
    {"code": "alcohol", "name": "Bebidas alcohólicas",
     "description": "Cualquier licor: cerveza, vino, licores y cocteles, por marca o por tipo",
     "examples": ["cerveza", "Club Colombia", "Águila", "Poker", "vino de la casa", "Old Parr", "aguardiente",
                  "michelada", "house wine", *ALCOHOL_EXAMPLES]},
    {"code": "minibar", "name": "Minibar", "description": "Consumos del minibar de la habitación del hotel",
     "examples": ["minibar", "frigobar", "consumo minibar"]},
    {"code": "tobacco", "name": "Tabaco", "description": "Cigarrillos, tabacos y vapeadores",
     "examples": ["cigarrillos", "Marlboro", "vape"]},
    *NEW_CONCEPTS,
]  # fmt: skip
POLICY_RULES = {
    "duplicate": {"action": "require_justification", "params": {}},
    "missing_tax_id": {"action": "warn", "params": {}},
    "outside_trip_dates": RULE_CHANGES["outside_trip_dates"],
    "blocked_concept": {"action": "require_justification", "params": {"min_confidence": 0.6}},
    "non_fiscal_document": {
        "action": "require_justification",
        "params": {"max_per_receipt": None, "max_monthly": None, "max_yearly": None, "required_fields": ["concept", "date", "total"]},
    },
    "buyer_not_company": RULE_CHANGES["buyer_not_company"],
    "missing_fiscal_id": RULE_CHANGES["missing_fiscal_id"],
    "excessive_tip": RULE_CHANGES["excessive_tip"],
    "itemized_required": {"action": "warn", "params": {"above_amount": None}},
    "low_confidence": {"action": "warn", "params": {"threshold": 0.7}},
}
SETTING_UPDATES: dict[str, object] = {"defaults.policy_rules": POLICY_RULES, "defaults.blocked_concepts": BLOCKED_CONCEPTS}
SYSTEM_SETTINGS: list[dict] = [
    {"key": "legalization.deadline_months", "value": 1, "value_type": "int", "constraints": {"min": 1, "max": 12},
     "description": "Meses después del regreso para enviar la legalización (decisión 2.5); después queda vencida."},
]  # fmt: skip

_SETTINGS = sa.table(
    "system_settings",
    sa.column("key", sa.String),
    sa.column("value", postgresql.JSONB),
    sa.column("value_type", sa.String),
    sa.column("constraints", postgresql.JSONB),
    sa.column("description", sa.String),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)


def _set_rule(rule: str, value: dict, now: datetime) -> None:
    # Por llave, para no pisar lo que el superadmin haya cambiado en las demás reglas.
    op.execute(
        sa.text(
            "UPDATE system_settings SET value = jsonb_set(value, :path, CAST(:rule AS jsonb)), updated_at = :now "
            "WHERE key = 'defaults.policy_rules'"
        ).bindparams(path=[rule], rule=json.dumps(value), now=now)
    )


def upgrade() -> None:
    op.add_column("expenses", sa.Column("receipt_signed", sa.Boolean, server_default=sa.false(), nullable=False))
    op.add_column("advances", sa.Column("legalization_due", sa.Date))
    now = datetime.now(UTC)
    for rule, value in RULE_CHANGES.items():
        _set_rule(rule, value, now)
    op.execute(
        sa.text("UPDATE system_settings SET value = CAST(:v AS jsonb), updated_at = :now WHERE key = 'defaults.blocked_concepts'")
        .bindparams(v=json.dumps(BLOCKED_CONCEPTS, ensure_ascii=False), now=now)
    )
    op.bulk_insert(_SETTINGS, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])
    # Las compañías que ya existen reciben los conceptos nuevos y los licores ampliados.
    conn = op.get_bind()
    for (company_id,) in conn.execute(sa.text("SELECT id FROM companies")).all():
        for concept in NEW_CONCEPTS:
            conn.execute(
                sa.text(
                    "INSERT INTO blocked_concepts (id, company_id, code, name, description, examples, active, deductible, created_at) "
                    "VALUES (:id, :company, :code, :name, :description, CAST(:examples AS jsonb), true, false, :now) "
                    "ON CONFLICT (company_id, code) DO NOTHING"
                ).bindparams(
                    id=uuid.uuid4(),
                    company=company_id,
                    code=concept["code"],
                    name=concept["name"],
                    description=concept["description"],
                    examples=json.dumps(concept["examples"], ensure_ascii=False),
                    now=now,
                )
            )
    op.execute(
        sa.text(
            "UPDATE blocked_concepts SET examples = (SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements(examples || "
            "CAST(:more AS jsonb)) AS e) WHERE code = 'alcohol'"
        ).bindparams(more=json.dumps(ALCOHOL_EXAMPLES, ensure_ascii=False))
    )


def downgrade() -> None:
    now = datetime.now(UTC)
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    for rule in ("missing_fiscal_id", "excessive_tip"):
        op.execute(
            sa.text("UPDATE system_settings SET value = value - :rule WHERE key = 'defaults.policy_rules'").bindparams(rule=rule)
        )
    for rule, value in PREVIOUS_RULES.items():
        _set_rule(rule, value, now)
    op.drop_column("advances", "legalization_due")
    op.drop_column("expenses", "receipt_signed")
