"""WhatsApp Flow para registrar un retiro de efectivo en el exterior

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-20 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_SETTINGS: list[dict] = [
    {
        "key": "whatsapp.flow_withdrawal_id",
        "value": "",
        "value_type": "string",
        "constraints": {"max_length": 40},
        "description": "Registrar un retiro de efectivo. ID del Flow publicado en WhatsApp Manager "
        "(whatsapp_flows/cash_withdrawal.json). Vacío = el bot remite a la app.",
    },
]


def upgrade() -> None:
    settings = sa.table(
        "system_settings",
        sa.column("key", sa.String),
        sa.column("value", postgresql.JSONB),
        sa.column("value_type", sa.String),
        sa.column("constraints", postgresql.JSONB),
        sa.column("description", sa.String),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(settings, [{**row, "updated_at": datetime.now(UTC)} for row in SYSTEM_SETTINGS])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
