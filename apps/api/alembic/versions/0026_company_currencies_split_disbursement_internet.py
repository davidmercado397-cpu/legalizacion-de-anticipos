"""monedas por compañía, entrega repartida por método, internet cada 15 días y alimentación con refrescos

- companies.currencies: monedas en que la compañía entrega y legaliza; un anticipo en otra se legaliza en la
  local (decisión 9.2). Las compañías existentes quedan solo con su moneda local, como funcionaban.
- advances.disbursement_parts reemplaza disbursement_method/disbursement_ref: tesorería reparte la entrega
  entre tarjeta, efectivo y transferencia, y las partes suman lo entregado.
- Tabla de viáticos de Forsa: categoría internet (un plan cada 15 días, unidad per_15_days) y alimentación
  incluye los refrescos.

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-26 22:30:00.000000
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MEALS_NAME, PREVIOUS_MEALS_NAME = "Alimentación y refrescos", "Alimentación"
INTERNET = {"code": "internet", "name": "Internet", "emoji": "🌐"}
CATEGORIES = [
    {"code": "lodging", "name": "Hospedaje", "emoji": "🏨"},
    {"code": "meals", "name": MEALS_NAME, "emoji": "🍽️"},
    {"code": "transport", "name": "Transporte", "emoji": "🚕"},
    {"code": "laundry", "name": "Lavandería", "emoji": "🧺"},
    INTERNET,
    {"code": "airport_tax", "name": "Impuesto aeroportuario", "emoji": "✈️"},
    {"code": "fuel", "name": "Combustible", "emoji": "⛽"},
    {"code": "tolls", "name": "Peajes", "emoji": "🛣️"},
    {"code": "other", "name": "Otro", "emoji": "🧾"},
]
SETTING_UPDATES: dict[str, object] = {"defaults.categories": CATEGORIES}
_PREVIOUS_CATEGORIES = [
    {**c, "name": PREVIOUS_MEALS_NAME} if c["code"] == "meals" else c for c in CATEGORIES if c is not INTERNET
]

_SETTINGS = sa.table(
    "system_settings",
    sa.column("key", sa.String),
    sa.column("value", pg.JSONB),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
_CATEGORIES = sa.table(
    "expense_categories",
    sa.column("id", sa.Uuid),
    sa.column("company_id", sa.Uuid),
    sa.column("code", sa.String),
    sa.column("name", sa.String),
    sa.column("emoji", sa.String),
    sa.column("position", sa.Integer),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def _set_categories(value: list[dict[str, str]]) -> None:
    op.execute(
        _SETTINGS.update().where(_SETTINGS.c.key == "defaults.categories").values(value=value, updated_at=datetime.now(UTC))
    )


def upgrade() -> None:
    op.add_column("companies", sa.Column("currencies", pg.JSONB, nullable=False, server_default="[]"))
    op.execute("UPDATE companies SET currencies = jsonb_build_array(currency)")

    op.add_column("advances", sa.Column("disbursement_parts", pg.JSONB, nullable=False, server_default="[]"))
    op.execute(
        "UPDATE advances SET disbursement_parts = jsonb_build_array(jsonb_build_object("
        "'method', disbursement_method, "
        "'amount', (CASE WHEN settlement_currency IS NULL THEN amount ELSE COALESCE(settlement_amount, amount) END)::text, "
        "'reference', disbursement_ref)) "
        "WHERE disbursement_method IS NOT NULL"
    )
    op.drop_column("advances", "disbursement_method")
    op.drop_column("advances", "disbursement_ref")

    _set_categories(CATEGORIES)
    op.execute(
        _CATEGORIES.update()
        .where(_CATEGORIES.c.code == "meals", _CATEGORIES.c.name == PREVIOUS_MEALS_NAME)
        .values(name=MEALS_NAME)
    )
    rows = op.get_bind().execute(
        sa.text(
            "SELECT company_id, max(position) FROM expense_categories GROUP BY company_id "
            "HAVING bool_and(code <> 'internet')"
        )
    ).all()
    now = datetime.now(UTC)
    for company_id, position in rows:
        op.execute(
            _CATEGORIES.insert().values(id=uuid.uuid4(), company_id=company_id, position=position + 1, created_at=now, **INTERNET)
        )


def downgrade() -> None:
    op.execute("DELETE FROM travel_budget_rates WHERE unit = 'per_15_days'")
    op.execute(_CATEGORIES.delete().where(_CATEGORIES.c.code == "internet"))
    op.execute(
        _CATEGORIES.update().where(_CATEGORIES.c.code == "meals", _CATEGORIES.c.name == MEALS_NAME).values(name=PREVIOUS_MEALS_NAME)
    )
    _set_categories(_PREVIOUS_CATEGORIES)

    op.add_column(
        "advances",
        sa.Column(
            "disbursement_method",
            sa.Enum("cash", "transfer", "card", name="disbursementmethod", native_enum=False, length=32),
        ),
    )
    op.add_column("advances", sa.Column("disbursement_ref", sa.String(120)))
    op.execute(
        "UPDATE advances SET disbursement_method = disbursement_parts->0->>'method', "
        "disbursement_ref = disbursement_parts->0->>'reference' WHERE jsonb_array_length(disbursement_parts) > 0"
    )
    op.drop_column("advances", "disbursement_parts")
    op.drop_column("companies", "currencies")
