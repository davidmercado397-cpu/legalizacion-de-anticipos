"""sesiones de WhatsApp, duplicado propio, recordatorios de legalizar y formato de moneda por país

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-18 10:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NUMBER_FORMATS = {
    "CO": {"thousands": ".", "decimal": ",", "always_decimals": False},
    "PA": {"thousands": ",", "decimal": ".", "always_decimals": True},
    "MX": {"thousands": ",", "decimal": ".", "always_decimals": True},
}
COUNTRIES = {
    "CO": {"timezone": "America/Bogota", "generic_tax_id": "222222222222", "number_format": NUMBER_FORMATS["CO"]},
    "PA": {"timezone": "America/Panama", "generic_tax_id": None, "number_format": NUMBER_FORMATS["PA"]},
    "MX": {"timezone": "America/Mexico_City", "generic_tax_id": "XAXX010101000", "number_format": NUMBER_FORMATS["MX"]},
}
KEYWORDS = {
    "menu": ["menu", "menú", "hola", "buenas", "buenos días", "buenas tardes", "inicio", "ayuda", "opciones"],
    "balance": ["saldo", "saldos", "mi saldo"],
    "pending": ["pendientes", "pendiente", "por confirmar"],
    "expenses": ["gastos", "mis gastos", "facturas"],
    "advances": ["anticipos", "mis anticipos", "anticipo"],
    "farewell": ["gracias", "muchas gracias", "listo", "chao", "adiós", "adios", "hasta luego", "eso es todo"],
}

SYSTEM_SETTINGS: list[dict] = [
    {"key": "whatsapp.session_ttl_minutes", "value": 15, "value_type": "int", "constraints": {"min": 1, "max": 1440},
     "description": "Minutos sin mensajes tras los que se cierra la conversación (el siguiente mensaje saluda de nuevo)."},
    {"key": "whatsapp.assistant_name", "value": "", "value_type": "string", "constraints": {"max_length": 40},
     "description": "Nombre con el que se presenta el asistente en el saludo (vacío = sin nombre)."},
    {"key": "whatsapp.notice_template", "value": "", "value_type": "string", "constraints": {"max_length": 120},
     "description": "Plantilla de Meta para avisos y recordatorios fuera de la ventana de 24 h ({{1}} nombre, {{2}} aviso). "
                    "Vacía = fuera de la ventana no se avisa."},
    {"key": "whatsapp.reminder_days", "value": [1, 3], "value_type": "json", "constraints": {},
     "description": "Días después del fin del viaje en que se recuerda enviar la legalización."},
    {"key": "whatsapp.keywords", "value": KEYWORDS, "value_type": "json", "constraints": {},
     "description": "Palabras que entiende el bot por opción (menu, balance, pending, expenses, advances, farewell)."},
]
SETTING_UPDATES: dict[str, object] = {"defaults.countries": COUNTRIES}

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
    op.create_table(
        "whatsapp_sessions",
        sa.Column("employee_id", sa.Uuid, sa.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_whatsapp_sessions_open", "whatsapp_sessions", ["last_inbound_at"], postgresql_where=sa.text("closed_at IS NULL"))
    op.add_column("expenses", sa.Column("duplicate_of_id", sa.Uuid, sa.ForeignKey("expenses.id")))
    op.add_column(
        "advances", sa.Column("reminders_sent", postgresql.JSONB, nullable=False, server_default="[]")
    )
    now = datetime.now(UTC)
    op.bulk_insert(_SETTINGS, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])
    # Se agrega el formato a cada país sin pisar lo que el superadmin haya cambiado en la llave.
    for country, number_format in NUMBER_FORMATS.items():
        op.execute(
            sa.text(
                "UPDATE system_settings SET value = jsonb_set(value, :path, CAST(:fmt AS jsonb)), updated_at = :now "
                "WHERE key = 'defaults.countries' AND value ? :country"
            ).bindparams(path=[country, "number_format"], fmt=json.dumps(number_format), now=now, country=country)
        )


def downgrade() -> None:
    for country in NUMBER_FORMATS:
        op.execute(
            sa.text("UPDATE system_settings SET value = value #- :path WHERE key = 'defaults.countries'").bindparams(
                path=[country, "number_format"]
            )
        )
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=[r["key"] for r in SYSTEM_SETTINGS]))
    op.drop_column("advances", "reminders_sent")
    op.drop_column("expenses", "duplicate_of_id")
    op.drop_index("ix_whatsapp_sessions_open", table_name="whatsapp_sessions")
    op.drop_table("whatsapp_sessions")
