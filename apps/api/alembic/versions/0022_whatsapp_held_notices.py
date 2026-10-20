"""avisos de WhatsApp guardados para entregar completos

Fuera de la ventana de 24 h el aviso sale por plantilla en una sola línea con el botón [Ver detalle]; el mensaje
completo (motivo, botones) queda en whatsapp_held_notices hasta que el empleado escribe o vence.

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-20 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_SETTINGS: list[dict] = [
    {"key": "whatsapp.notice_hold_days", "value": 7, "value_type": "int", "constraints": {"min": 1, "max": 30},
     "description": "Días que se guarda el detalle de un aviso enviado por plantilla para mostrarlo cuando el "
                    "empleado escriba o toque [Ver detalle]."},
]
NOTICE_TEMPLATE_DESCRIPTIONS = (
    "Plantilla de Meta para avisos y recordatorios fuera de la ventana de 24 h ({{1}} nombre, {{2}} aviso). "
    "Vacía = fuera de la ventana no se avisa.",
    "Plantilla de Meta para avisos y recordatorios fuera de la ventana de 24 h ({{1}} nombre, {{2}} aviso, un botón "
    "de respuesta rápida «Ver detalle»). Vacía = fuera de la ventana no se avisa.",
)

_SETTINGS = sa.table(
    "system_settings",
    sa.column("key", sa.String),
    sa.column("value", postgresql.JSONB),
    sa.column("value_type", sa.String),
    sa.column("constraints", postgresql.JSONB),
    sa.column("description", sa.String),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)


def _notice_description(text: str) -> None:
    op.execute(
        sa.text("UPDATE system_settings SET description = :d WHERE key = 'whatsapp.notice_template'").bindparams(d=text)
    )


def upgrade() -> None:
    op.create_table(
        "whatsapp_held_notices",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("employee_id", sa.Uuid, sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("buttons", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_whatsapp_held_notices_employee_id", "whatsapp_held_notices", ["employee_id"])
    op.bulk_insert(_SETTINGS, [{**row, "updated_at": datetime.now(UTC)} for row in SYSTEM_SETTINGS])
    _notice_description(NOTICE_TEMPLATE_DESCRIPTIONS[1])


def downgrade() -> None:
    _notice_description(NOTICE_TEMPLATE_DESCRIPTIONS[0])
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    op.drop_index("ix_whatsapp_held_notices_employee_id", table_name="whatsapp_held_notices")
    op.drop_table("whatsapp_held_notices")
