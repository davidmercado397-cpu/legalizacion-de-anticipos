"""sin presupuesto de IA: el superadmin consulta el costo por modelo, compañía y mes

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-18 08:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REMOVED_SETTINGS: list[dict] = [
    {"key": "ai.monthly_budget_usd", "value": 40, "value_type": "decimal", "constraints": {"min": 0, "max": 100000},
     "description": "Presupuesto mensual de IA en USD (0 = sin control). Al agotarse se usa el modelo Lite sin escalar."},
    {"key": "ai.budget_alert_ratio", "value": 0.8, "value_type": "decimal", "constraints": {"min": 0.1, "max": 1},
     "description": "Fracción del presupuesto de IA a la que se avisa a los administradores (una vez al mes)."},
]


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in REMOVED_SETTINGS])
    )


def downgrade() -> None:
    settings = sa.table(
        "system_settings",
        sa.column("key", sa.String),
        sa.column("value", postgresql.JSONB),
        sa.column("value_type", sa.String),
        sa.column("constraints", postgresql.JSONB),
        sa.column("description", sa.String),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(settings, [{**row, "updated_at": datetime.now(UTC)} for row in REMOVED_SETTINGS])
