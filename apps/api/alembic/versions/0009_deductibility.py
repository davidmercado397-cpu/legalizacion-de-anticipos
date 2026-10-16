"""deducibilidad: adquiriente de la factura, grupo, exterior, recibos y desglose por línea

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-17 05:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_SETTINGS: list[dict] = [
    {"key": "fiscal.generic_buyer_ids", "value_type": "json", "constraints": {},
     "value": {"CO": ["222222222222"], "MX": ["XAXX010101000", "XEXX010101000"], "PA": []},
     "description": "Identificaciones genéricas de adquiriente por país (consumidor final, extranjero): no son la compañía."},
]
POLICY_RULES = {
    "duplicate": {"action": "require_justification", "params": {}},
    "missing_tax_id": {"action": "warn", "params": {}},
    "outside_trip_dates": {"action": "require_justification", "params": {"tolerance_days": 1}},
    "blocked_concept": {"action": "require_justification", "params": {"min_confidence": 0.6}},
    "non_fiscal_document": {
        "action": "require_justification",
        "params": {
            "max_per_receipt": None,
            "max_monthly": None,
            "max_yearly": None,
            "required_fields": ["concept", "date", "total"],
        },
    },
    "buyer_not_company": {"action": "warn", "params": {}},
    "itemized_required": {"action": "warn", "params": {"above_amount": None}},
    "low_confidence": {"action": "warn", "params": {"threshold": 0.7}},
}
DEDUCTIBILITY = {
    "electronic_invoice": "deductible",
    "pos_ticket": "deductible",
    "cash_receipt": "requires_support_document",
    "other": "non_deductible",
    "foreign_invoice": "requires_review",
}
SETTING_UPDATES: dict[str, object] = {"defaults.policy_rules": POLICY_RULES, "defaults.deductibility": DEDUCTIBILITY}

_SETTINGS = sa.table(
    "system_settings",
    sa.column("key", sa.String),
    sa.column("value", postgresql.JSONB),
    sa.column("value_type", sa.String),
    sa.column("constraints", postgresql.JSONB),
    sa.column("description", sa.String),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.add_column("blocked_concepts", sa.Column("deductible", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("expenses", sa.Column("deductibility_set_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_expenses_deductibility_set_by_employees"), "expenses", "employees", ["deductibility_set_by"], ["id"]
    )
    # El enum se guarda como VARCHAR: requires_review no necesita cambio de tipo.
    op.execute(
        """UPDATE companies SET deductibility = deductibility || '{"foreign_invoice": "requires_review"}'::jsonb
           WHERE NOT deductibility ? 'foreign_invoice'"""
    )
    now = datetime.now(UTC)
    op.bulk_insert(_SETTINGS, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])
    for key, value in SETTING_UPDATES.items():
        op.execute(_SETTINGS.update().where(_SETTINGS.c.key == key).values(value=value, updated_at=now))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    rules = {k: v for k, v in POLICY_RULES.items() if k != "buyer_not_company"}
    rules["non_fiscal_document"] = {
        "action": "require_justification",
        "params": {"max_per_receipt": None, "max_monthly": None, "max_yearly": None},
    }
    deductibility = {k: v for k, v in DEDUCTIBILITY.items() if k != "foreign_invoice"}
    now = datetime.now(UTC)
    for key, value in (("defaults.policy_rules", rules), ("defaults.deductibility", deductibility)):
        op.execute(_SETTINGS.update().where(_SETTINGS.c.key == key).values(value=value, updated_at=now))
    op.execute("UPDATE companies SET deductibility = deductibility - 'foreign_invoice'")
    op.execute("UPDATE expenses SET deductibility = 'non_deductible' WHERE deductibility = 'requires_review'")
    op.drop_constraint(op.f("fk_expenses_deductibility_set_by_employees"), "expenses", type_="foreignkey")
    op.drop_column("expenses", "deductibility_set_by")
    op.drop_column("blocked_concepts", "deductible")
