"""presupuestos de viaje: zonas, tarifas, tipo de personal y tope de efectivo

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-16 23:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STAFF = ("administrative", "operational")
UNITS = ("per_day", "per_night", "per_trip")


def upgrade() -> None:
    op.add_column(
        "employees", sa.Column("staff_type", sa.Enum(*STAFF, name="stafftype", native_enum=False, length=32), nullable=True)
    )
    op.add_column("companies", sa.Column("cash_international_cap", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_table(
        "travel_zones",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("places", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_travel_zones_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_travel_zones")),
        sa.UniqueConstraint("company_id", "name", name="uq_travel_zones_company_name"),
    )
    op.create_table(
        "travel_budget_rates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.Uuid(), nullable=False),
        sa.Column("staff_type", sa.Enum(*STAFF, name="stafftype", native_enum=False, length=32), nullable=False),
        sa.Column("category_code", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("unit", sa.Enum(*UNITS, name="budgetunit", native_enum=False, length=32), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_travel_budget_rates_company_id_companies"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["zone_id"], ["travel_zones.id"], name=op.f("fk_travel_budget_rates_zone_id_travel_zones"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_travel_budget_rates")),
    )
    op.create_index("ix_travel_budget_rates_lookup", "travel_budget_rates", ["company_id", "zone_id", "staff_type"])
    op.add_column("advances", sa.Column("budget_zone_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_advances_budget_zone_id_travel_zones"), "advances", "travel_zones", ["budget_zone_id"], ["id"]
    )
    op.add_column("advances", sa.Column("budget_amount", sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column(
        "advances",
        sa.Column("budget_breakdown", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.add_column("advances", sa.Column("budget_justification", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("advances", "budget_justification")
    op.drop_column("advances", "budget_breakdown")
    op.drop_column("advances", "budget_amount")
    op.drop_constraint(op.f("fk_advances_budget_zone_id_travel_zones"), "advances", type_="foreignkey")
    op.drop_column("advances", "budget_zone_id")
    op.drop_index("ix_travel_budget_rates_lookup", table_name="travel_budget_rates")
    op.drop_table("travel_budget_rates")
    op.drop_table("travel_zones")
    op.drop_column("companies", "cash_international_cap")
    op.drop_column("employees", "staff_type")
