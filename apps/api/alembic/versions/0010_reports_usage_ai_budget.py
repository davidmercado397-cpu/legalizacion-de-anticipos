"""tableros, uso de la plataforma y presupuesto de IA

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-17 08:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SYSTEM_SETTINGS: list[dict] = [
    {"key": "reports.aging_buckets", "value_type": "json", "constraints": {}, "value": [15, 30],
     "description": "Tramos de antigüedad (días) de los saldos por legalizar: [15, 30] = 0-15, 16-30 y +30."},
    {"key": "usage.included_documents", "value": 1500, "value_type": "int", "constraints": {"min": 0, "max": 1000000},
     "description": "Comprobantes al mes incluidos en el plan."},
    {"key": "usage.extra_document_price", "value": 350, "value_type": "decimal", "constraints": {"min": 0, "max": 100000},
     "description": "Precio de cada comprobante adicional."},
    {"key": "usage.price_currency", "value": "COP", "value_type": "string", "constraints": {"max_length": 3},
     "description": "Moneda del precio de los comprobantes adicionales."},
    {"key": "ai.monthly_budget_usd", "value": 40, "value_type": "decimal", "constraints": {"min": 0, "max": 100000},
     "description": "Presupuesto mensual de IA en USD (0 = sin control). Al agotarse se usa el modelo Lite sin escalar."},
    {"key": "ai.budget_alert_ratio", "value": 0.8, "value_type": "decimal", "constraints": {"min": 0.1, "max": 1},
     "description": "Fracción del presupuesto de IA a la que se avisa a los administradores (una vez al mes)."},
]


def upgrade() -> None:
    op.create_index("ix_expenses_company_invoice_date", "expenses", ["company_id", "invoice_date"])
    op.create_index("ix_expenses_processed_at", "expenses", ["processed_at"])
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
    op.drop_index("ix_expenses_processed_at", table_name="expenses")
    op.drop_index("ix_expenses_company_invoice_date", table_name="expenses")
