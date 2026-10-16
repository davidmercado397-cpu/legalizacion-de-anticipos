"""países, categorías configurables y extracción v3

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-16 18:00:00.000000
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COUNTRIES = {
    "CO": {"timezone": "America/Bogota", "generic_tax_id": "222222222222"},
    "PA": {"timezone": "America/Panama", "generic_tax_id": None},
    "MX": {"timezone": "America/Mexico_City", "generic_tax_id": "XAXX010101000"},
}
CATEGORIES = [
    {"code": "lodging", "name": "Hospedaje", "emoji": "🏨"},
    {"code": "meals", "name": "Alimentación", "emoji": "🍽️"},
    {"code": "transport", "name": "Transporte", "emoji": "🚕"},
    {"code": "laundry", "name": "Lavandería", "emoji": "🧺"},
    {"code": "airport_tax", "name": "Impuesto aeroportuario", "emoji": "✈️"},
    {"code": "fuel", "name": "Combustible", "emoji": "⛽"},
    {"code": "tolls", "name": "Peajes", "emoji": "🛣️"},
    {"code": "other", "name": "Otro", "emoji": "🧾"},
]
DEDUCTIBILITY = {
    "electronic_invoice": "deductible",
    "pos_ticket": "deductible",
    "cash_receipt": "requires_support_document",
    "other": "non_deductible",
}

SYSTEM_SETTINGS: list[dict] = [
    {"key": "defaults.countries", "value_type": "json", "constraints": {}, "value": COUNTRIES,
     "description": "Zona horaria y tercero genérico por país; se usan al crear una compañía."},
    {"key": "defaults.categories", "value_type": "json", "constraints": {}, "value": CATEGORIES,
     "description": "Categorías de gasto que se copian a cada compañía nueva."},
    {"key": "defaults.deductibility", "value_type": "json", "constraints": {}, "value": DEDUCTIBILITY,
     "description": "Deducibilidad sugerida por tipo de documento que se copia a cada compañía nueva."},
    {"key": "operation.supported_currencies", "value_type": "list", "constraints": {},
     "value": ["COP", "USD", "EUR", "BRL", "MXN"],
     "description": "Monedas aceptadas en compañías, anticipos y gastos (ISO-4217)."},
    {"key": "operation.currency_aliases", "value_type": "json", "constraints": {}, "value": {"PAB": "USD"},
     "description": "Monedas que se leen en una factura y se registran como otra (el balboa circula a la par del dólar)."},
]
# Llaves existentes que cambian de valor con esta versión.
SETTING_UPDATES: dict[str, object] = {"ai.prompt_version": "v3"}


def upgrade() -> None:
    op.add_column("companies", sa.Column("legal_name", sa.String(length=200), nullable=True))
    op.add_column("companies", sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False))
    for country, values in COUNTRIES.items():
        op.execute(sa.text("UPDATE companies SET timezone = :tz WHERE country = :c").bindparams(tz=values["timezone"], c=country))
    op.alter_column("companies", "timezone", server_default=None)
    op.execute(
        sa.text("UPDATE companies SET deductibility = CAST(:d AS JSONB) WHERE deductibility = '{}'::jsonb").bindparams(
            d=json.dumps(DEDUCTIBILITY)
        )
    )

    categories = op.create_table(
        "expense_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=True),
        sa.Column("accounting_account", sa.String(length=40), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_expense_categories_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_expense_categories")),
        sa.UniqueConstraint("company_id", "code", name="uq_expense_categories_company_code"),
    )
    now = datetime.now(UTC)
    company_ids = [row[0] for row in op.get_bind().execute(sa.text("SELECT id FROM companies"))]
    op.bulk_insert(
        categories,
        [
            {"id": uuid.uuid4(), "company_id": cid, "position": i, "active": True, "created_at": now, **item}
            for cid in company_ids
            for i, item in enumerate(CATEGORIES)
        ],
    )

    op.alter_column("expenses", "category", type_=sa.String(length=40), existing_nullable=True)
    op.add_column("expenses", sa.Column("invoice_time", sa.Time(), nullable=True))
    op.add_column("expenses", sa.Column("buyer_tax_id", sa.String(length=40), nullable=True))
    op.add_column("expenses", sa.Column("taxes", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False))
    op.add_column(
        "expenses",
        sa.Column(
            "unreadable_reason",
            sa.Enum("unreadable", "not_a_receipt", name="unreadablereason", native_enum=False, length=32),
            nullable=True,
        ),
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
    op.bulk_insert(settings, [{**row, "updated_at": now} for row in SYSTEM_SETTINGS])
    for key, value in SETTING_UPDATES.items():
        op.execute(settings.update().where(settings.c.key == key).values(value=value, updated_at=now))


def downgrade() -> None:
    keys = [row["key"] for row in SYSTEM_SETTINGS]
    op.execute(sa.text("DELETE FROM system_settings WHERE key = ANY(:k)").bindparams(k=keys))
    op.execute(sa.text("""UPDATE system_settings SET value = '"v2"'::jsonb WHERE key = 'ai.prompt_version'"""))
    op.drop_column("expenses", "unreadable_reason")
    op.drop_column("expenses", "taxes")
    op.drop_column("expenses", "buyer_tax_id")
    op.drop_column("expenses", "invoice_time")
    op.execute("UPDATE expenses SET category = 'other' WHERE length(category) > 32")
    op.alter_column("expenses", "category", type_=sa.String(length=32), existing_nullable=True)
    op.drop_table("expense_categories")
    op.drop_column("companies", "timezone")
    op.drop_column("companies", "legal_name")
