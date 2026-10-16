"""aprendizaje por correcciones: ejemplos, historial y similitud por trigramas

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-17 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# pg_trgm es una extensión "confiable" (PostgreSQL 13+): la crea el dueño de la base, sin superusuario.
# Los tests la crean antes que las tablas.
EXTENSIONS_SQL = ["CREATE EXTENSION IF NOT EXISTS pg_trgm"]

SYSTEM_SETTINGS: list[dict] = [
    {"key": "learning.similarity", "value": 0.5, "value_type": "decimal", "constraints": {"min": 0.3, "max": 0.95},
     "description": "Parecido mínimo (trigramas, 0 a 1) para alertar que una línea podría ser un concepto bloqueado aprendido."},
    {"key": "learning.prompt_examples", "value": 20, "value_type": "int", "constraints": {"min": 0, "max": 100},
     "description": "Correcciones recientes que se le dan a la IA como ejemplos en cada lectura (0 = ninguna)."},
]

_ENUM = {"native_enum": False, "length": 32}


def upgrade() -> None:
    for statement in EXTENSIONS_SQL:
        op.execute(statement)
    op.create_table(
        "classification_examples",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Enum("line_concept", "vendor_category", name="examplekind", **_ENUM), nullable=False),
        sa.Column("key_text", sa.String(length=300), nullable=False),
        sa.Column("original_text", sa.String(length=300), nullable=False),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("scope", sa.Enum("company", "group", name="examplescope", **_ENUM), nullable=False),
        sa.Column("company_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status", sa.Enum("active", "pending", "rejected", "inactive", name="examplestatus", **_ENUM), nullable=False
        ),
        sa.Column("conflicted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("source_expense_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_classification_examples_company_id_companies"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["employees.id"], name=op.f("fk_classification_examples_created_by_employees")),
        sa.ForeignKeyConstraint(
            ["source_expense_id"],
            ["expenses.id"],
            name=op.f("fk_classification_examples_source_expense_id_expenses"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["updated_by"], ["employees.id"], name=op.f("fk_classification_examples_updated_by_employees")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_classification_examples")),
        sa.UniqueConstraint(
            "scope", "company_id", "kind", "key_text", name="uq_classification_examples_key", postgresql_nulls_not_distinct=True
        ),
    )
    op.create_index(
        "ix_classification_examples_trgm",
        "classification_examples",
        ["key_text"],
        postgresql_using="gin",
        postgresql_ops={"key_text": "gin_trgm_ops"},
    )
    op.create_table(
        "classification_example_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("example_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["example_id"],
            ["classification_examples.id"],
            name=op.f("fk_classification_example_history_example_id_classification_examples"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"], ["employees.id"], name=op.f("fk_classification_example_history_actor_id_employees")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_classification_example_history")),
    )
    op.create_index(
        op.f("ix_classification_example_history_example_id"), "classification_example_history", ["example_id"]
    )
    op.add_column("expense_lines", sa.Column("memory_example_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_expense_lines_memory_example_id_classification_examples"),
        "expense_lines",
        "classification_examples",
        ["memory_example_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("expense_lines", sa.Column("similar_concept_code", sa.String(length=40), nullable=True))
    op.add_column("expense_lines", sa.Column("similar_text", sa.String(length=300), nullable=True))
    op.create_index("ix_expense_lines_normalized_text", "expense_lines", ["normalized_text"])
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
    op.drop_index("ix_expense_lines_normalized_text", table_name="expense_lines")
    op.drop_column("expense_lines", "similar_text")
    op.drop_column("expense_lines", "similar_concept_code")
    op.drop_constraint(
        op.f("fk_expense_lines_memory_example_id_classification_examples"), "expense_lines", type_="foreignkey"
    )
    op.drop_column("expense_lines", "memory_example_id")
    op.drop_index(op.f("ix_classification_example_history_example_id"), table_name="classification_example_history")
    op.drop_table("classification_example_history")
    op.drop_index("ix_classification_examples_trgm", table_name="classification_examples")
    op.drop_table("classification_examples")
    # pg_trgm se deja instalada: otras bases o consultas pueden usarla.
