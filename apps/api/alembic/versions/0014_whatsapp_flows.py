"""WhatsApp Flows: identificadores de los formularios publicados en WhatsApp Manager

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-18 14:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FLOW = "ID del Flow publicado en WhatsApp Manager (whatsapp_flows/{file}). Vacío = el bot remite a la app."
SYSTEM_SETTINGS: list[dict] = [
    {"key": "whatsapp.flow_advance_request_id", "value": "", "value_type": "string", "constraints": {"max_length": 40},
     "description": "Solicitar anticipo. " + _FLOW.format(file="advance_request.json")},
    {"key": "whatsapp.flow_expense_correction_id", "value": "", "value_type": "string", "constraints": {"max_length": 40},
     "description": "Corregir un gasto. " + _FLOW.format(file="expense_correction.json")},
    {"key": "whatsapp.flow_justification_id", "value": "", "value_type": "string", "constraints": {"max_length": 40},
     "description": "Justificar un gasto. " + _FLOW.format(file="justification.json")},
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
