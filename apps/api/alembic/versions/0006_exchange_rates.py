"""tasas de cambio (TRM y BCE) y conversión automática de gastos

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-16 21:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCES = ("trm", "ecb", "ecb_cross", "manual")
POLICIES = ("daily", "previous_month_close")

SYSTEM_SETTINGS: list[dict] = [
    {"key": "defaults.exchange_rate_policy", "value": "daily", "value_type": "enum", "constraints": {"options": list(POLICIES)},
     "description": "Política de tasa de cambio de las compañías nuevas: tasa del día de la factura o cierre del mes anterior."},
    {"key": "exchange.sync_days_back", "value": 10, "value_type": "int", "constraints": {"min": 1, "max": 60},
     "description": "Días hacia atrás que se descargan en cada sincronización de tasas (recupera días sin publicar)."},
    {"key": "exchange.max_rate_age_days", "value": 7, "value_type": "int", "constraints": {"min": 1, "max": 31},
     "description": "Antigüedad máxima de una tasa para usarla en fines de semana y festivos; más vieja = conversión manual."},
]


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column(
            "exchange_rate_policy",
            sa.Enum(*POLICIES, name="exchangeratepolicy", native_enum=False, length=32),
            server_default="daily",
            nullable=False,
        ),
    )
    op.alter_column("companies", "exchange_rate_policy", server_default=None)
    op.add_column("expenses", sa.Column("exchange_rate", sa.Numeric(precision=18, scale=8), nullable=True))
    op.add_column(
        "expenses",
        sa.Column("exchange_rate_source", sa.Enum(*SOURCES, name="exchangeratesource", native_enum=False, length=32), nullable=True),
    )
    op.add_column("expenses", sa.Column("exchange_rate_date", sa.Date(), nullable=True))
    op.create_table(
        "exchange_rates",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("base", sa.String(length=3), nullable=False),
        sa.Column("quote", sa.String(length=3), nullable=False),
        sa.Column("rate", sa.Numeric(precision=18, scale=8), nullable=False),
        sa.Column("source", sa.Enum(*SOURCES, name="exchangeratesource", native_enum=False, length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("day", "base", "quote", name=op.f("pk_exchange_rates")),
    )
    settings = sa.table(
        "system_settings",
        sa.column("key", sa.String),
        sa.column("value", postgresql.JSONB),
        sa.column("value_type", sa.String),
        sa.column("constraints", postgresql.JSONB),
        sa.column("description", sa.String),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(UTC)
    op.bulk_insert(settings, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    op.drop_table("exchange_rates")
    op.drop_column("expenses", "exchange_rate_date")
    op.drop_column("expenses", "exchange_rate_source")
    op.drop_column("expenses", "exchange_rate")
    op.drop_column("companies", "exchange_rate_policy")
