"""políticas, líneas y revisión

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15 22:48:30.667020
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# Copia congelada de los valores por defecto al momento de esta migración: una migración no debe
# importar código de la app, que puede cambiar después.
DEFAULT_BLOCKED_CONCEPTS = (
    (
        "alcohol",
        "Bebidas alcohólicas",
        "Cerveza, vino, licores y cocteles, por marca o por tipo",
        ["cerveza", "Club Colombia", "Águila", "Poker", "vino de la casa", "Old Parr", "aguardiente", "michelada", "house wine"],
    ),
    ("minibar", "Minibar", "Consumos del minibar de la habitación del hotel", ["minibar", "frigobar", "consumo minibar"]),
    ("tobacco", "Tabaco", "Cigarrillos, tabacos y vapeadores", ["cigarrillos", "Marlboro", "vape"]),
)

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('blocked_concepts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('company_id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=True),
    sa.Column('examples', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_blocked_concepts_company_id_companies'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_blocked_concepts')),
    sa.UniqueConstraint('company_id', 'code', name='uq_blocked_concepts_company_code')
    )
    op.create_table('policy_rules',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('company_id', sa.Uuid(), nullable=False),
    sa.Column('rule_type', sa.String(length=40), nullable=False),
    sa.Column('action', sa.Enum('warn', 'require_justification', 'block', name='policyaction', native_enum=False, length=32), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('updated_by', sa.Uuid(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_policy_rules_company_id_companies'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_policy_rules')),
    sa.UniqueConstraint('company_id', 'rule_type', name='uq_policy_rules_company_rule')
    )
    op.create_table('expense_lines',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('expense_id', sa.Uuid(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('description', sa.String(length=300), nullable=False),
    sa.Column('normalized_text', sa.String(length=300), nullable=False),
    sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('quantity', sa.Numeric(precision=12, scale=3), nullable=True),
    sa.Column('ai_concept_code', sa.String(length=40), nullable=True),
    sa.Column('ai_concept_confidence', sa.Float(), nullable=True),
    sa.Column('final_concept_code', sa.String(length=40), nullable=True),
    sa.Column('corrected_by', sa.Uuid(), nullable=True),
    sa.Column('corrected_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['corrected_by'], ['employees.id'], name=op.f('fk_expense_lines_corrected_by_employees')),
    sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], name=op.f('fk_expense_lines_expense_id_expenses'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_expense_lines'))
    )
    op.create_index(op.f('ix_expense_lines_expense_id'), 'expense_lines', ['expense_id'], unique=False)
    op.add_column('companies', sa.Column('generic_tax_id', sa.String(length=40), nullable=True))
    op.add_column('companies', sa.Column('deductibility', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('expenses', sa.Column('policy_findings', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('expenses', sa.Column('justification', sa.String(length=1000), nullable=True))
    op.add_column('expenses', sa.Column('deductibility', sa.Enum('deductible', 'non_deductible', 'requires_support_document', name='deductibility', native_enum=False, length=32), nullable=True))
    op.add_column('expenses', sa.Column('suggested_non_reimbursable', sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column('expenses', sa.Column('non_reimbursable_amount', sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column('expenses', sa.Column('review_status', sa.Enum('not_required', 'pending', 'accepted', 'accepted_partial', 'rejected', name='reviewstatus', native_enum=False, length=32), server_default='not_required', nullable=False))
    op.add_column('expenses', sa.Column('reviewed_by', sa.Uuid(), nullable=True))
    op.add_column('expenses', sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('expenses', sa.Column('review_note', sa.String(length=1000), nullable=True))
    op.create_index('ix_expenses_company_vendor_date_total', 'expenses', ['company_id', 'vendor_name', 'invoice_date', 'total'], unique=False)
    op.create_foreign_key(op.f('fk_expenses_reviewed_by_employees'), 'expenses', 'employees', ['reviewed_by'], ['id'])

    # Las compañías existentes reciben los conceptos bloqueados por defecto (las nuevas los reciben al crearse).
    companies = sa.table("companies", sa.column("id", sa.Uuid))
    concepts = sa.table(
        "blocked_concepts",
        sa.column("id", sa.Uuid),
        sa.column("company_id", sa.Uuid),
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("examples", postgresql.JSONB),
        sa.column("active", sa.Boolean),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    connection = op.get_bind()
    rows = []
    for (company_id,) in connection.execute(sa.select(companies.c.id)):
        for code, name, description, examples in DEFAULT_BLOCKED_CONCEPTS:
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "company_id": company_id,
                    "code": code,
                    "name": name,
                    "description": description,
                    "examples": examples,
                    "active": True,
                    "created_at": datetime.now(UTC),
                }
            )
    if rows:
        op.bulk_insert(concepts, rows)


def downgrade() -> None:
    op.drop_constraint(op.f('fk_expenses_reviewed_by_employees'), 'expenses', type_='foreignkey')
    op.drop_index('ix_expenses_company_vendor_date_total', table_name='expenses')
    op.drop_column('expenses', 'review_note')
    op.drop_column('expenses', 'reviewed_at')
    op.drop_column('expenses', 'reviewed_by')
    op.drop_column('expenses', 'review_status')
    op.drop_column('expenses', 'non_reimbursable_amount')
    op.drop_column('expenses', 'suggested_non_reimbursable')
    op.drop_column('expenses', 'deductibility')
    op.drop_column('expenses', 'justification')
    op.drop_column('expenses', 'policy_findings')
    op.drop_column('companies', 'deductibility')
    op.drop_column('companies', 'generic_tax_id')
    op.drop_index(op.f('ix_expense_lines_expense_id'), table_name='expense_lines')
    op.drop_table('expense_lines')
    op.drop_table('policy_rules')
    op.drop_table('blocked_concepts')
