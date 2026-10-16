"""esquema inicial

Revision ID: 0001
Revises: 
Create Date: 2026-10-15 22:31:15.215721
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('audit_log',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('entity_type', sa.String(length=40), nullable=False),
    sa.Column('entity_id', sa.String(length=80), nullable=True),
    sa.Column('channel', sa.Enum('api', 'whatsapp', 'system', name='channel', native_enum=False, length=32), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_log'))
    )
    op.create_index('ix_audit_entity', 'audit_log', ['entity_type', 'entity_id'], unique=False)
    op.create_index(op.f('ix_audit_log_created_at'), 'audit_log', ['created_at'], unique=False)
    op.create_table('companies',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('country', sa.String(length=2), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('tax_id', sa.String(length=40), nullable=True),
    sa.Column('is_test', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_companies'))
    )
    op.create_table('employees',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('full_name', sa.String(length=200), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('role', sa.Enum('employee', 'approver', 'accountant', 'admin', name='role', native_enum=False, length=32), nullable=False),
    sa.Column('phone', sa.String(length=20), nullable=True),
    sa.Column('company_ids', postgresql.ARRAY(sa.Uuid()), server_default='{}', nullable=False),
    sa.Column('approver_id', sa.Uuid(), nullable=True),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('token_version', sa.Integer(), server_default='0', nullable=False),
    sa.Column('failed_logins', sa.Integer(), server_default='0', nullable=False),
    sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('wa_user_id', sa.String(length=140), nullable=True),
    sa.Column('wa_pending_user_id', sa.String(length=140), nullable=True),
    sa.Column('wa_link_status', sa.Enum('none', 'pending', 'active', name='whatsapplinkstatus', native_enum=False, length=32), nullable=False),
    sa.Column('wa_username', sa.String(length=64), nullable=True),
    sa.Column('wa_profile_name', sa.String(length=200), nullable=True),
    sa.Column('wa_welcome_message_id', sa.String(length=200), nullable=True),
    sa.Column('privacy_accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['approver_id'], ['employees.id'], name=op.f('fk_employees_approver_id_employees'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_employees')),
    sa.UniqueConstraint('email', name=op.f('uq_employees_email')),
    sa.UniqueConstraint('phone', name=op.f('uq_employees_phone')),
    sa.UniqueConstraint('wa_user_id', name=op.f('uq_employees_wa_user_id'))
    )
    op.create_index('ix_employees_company_ids', 'employees', ['company_ids'], unique=False, postgresql_using='gin')
    op.create_index(op.f('ix_employees_wa_welcome_message_id'), 'employees', ['wa_welcome_message_id'], unique=False)
    op.create_table('inbound_messages',
    sa.Column('wa_message_id', sa.String(length=200), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('wa_message_id', name=op.f('pk_inbound_messages'))
    )
    op.create_table('advances',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('company_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.Enum('cash', 'reloadable_card', 'corporate_card', name='advancekind', native_enum=False, length=32), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=False),
    sa.Column('purpose', sa.String(length=500), nullable=False),
    sa.Column('destination', sa.String(length=200), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('status', sa.Enum('requested', 'approved', 'rejected', 'in_review', 'closed', name='advancestatus', native_enum=False, length=32), nullable=False),
    sa.Column('decided_by', sa.Uuid(), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decision_note', sa.String(length=1000), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_advances_company_id_companies')),
    sa.ForeignKeyConstraint(['decided_by'], ['employees.id'], name=op.f('fk_advances_decided_by_employees')),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_advances_employee_id_employees')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_advances'))
    )
    op.create_index('ix_advances_company', 'advances', ['company_id'], unique=False)
    op.create_index('ix_advances_employee_status', 'advances', ['employee_id', 'status'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('family_id', sa.Uuid(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rotated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_refresh_tokens_employee_id_employees'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_tokens_token_hash'))
    )
    op.create_index(op.f('ix_refresh_tokens_employee_id'), 'refresh_tokens', ['employee_id'], unique=False)
    op.create_index(op.f('ix_refresh_tokens_family_id'), 'refresh_tokens', ['family_id'], unique=False)
    op.create_table('whatsapp_link_codes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('code_hash', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_whatsapp_link_codes_employee_id_employees'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_whatsapp_link_codes')),
    sa.UniqueConstraint('code_hash', name=op.f('uq_whatsapp_link_codes_code_hash'))
    )
    op.create_table('expenses',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('company_id', sa.Uuid(), nullable=True),
    sa.Column('source', sa.Enum('whatsapp', 'app', name='expensesource', native_enum=False, length=32), nullable=False),
    sa.Column('status', sa.Enum('received', 'processing', 'extracted', 'confirmed', 'discarded', 'unreadable', 'failed', name='expensestatus', native_enum=False, length=32), nullable=False),
    sa.Column('advance_id', sa.Uuid(), nullable=True),
    sa.Column('file_key', sa.String(length=300), nullable=True),
    sa.Column('mime_type', sa.String(length=100), nullable=True),
    sa.Column('file_sha256', sa.String(length=64), nullable=True),
    sa.Column('document_index', sa.Integer(), server_default='0', nullable=False),
    sa.Column('parent_id', sa.Uuid(), nullable=True),
    sa.Column('wa_message_id', sa.String(length=200), nullable=True),
    sa.Column('wa_media_id', sa.String(length=200), nullable=True),
    sa.Column('client_ref', sa.String(length=100), nullable=True),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('document_type', sa.Enum('electronic_invoice', 'pos_ticket', 'cash_receipt', 'other', name='documenttype', native_enum=False, length=32), nullable=True),
    sa.Column('vendor_name', sa.String(length=300), nullable=True),
    sa.Column('vendor_tax_id', sa.String(length=40), nullable=True),
    sa.Column('invoice_number', sa.String(length=80), nullable=True),
    sa.Column('invoice_date', sa.Date(), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=True),
    sa.Column('subtotal', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('tax_amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('tip_amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('total', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('fiscal_id', sa.String(length=120), nullable=True),
    sa.Column('country', sa.String(length=2), nullable=True),
    sa.Column('category', sa.Enum('lodging', 'meals', 'transport', 'laundry', 'airport_tax', 'fuel', 'tolls', 'other', name='expensecategory', native_enum=False, length=32), nullable=True),
    sa.Column('description', sa.String(length=1000), nullable=True),
    sa.Column('itemized', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('legibility', sa.Enum('good', 'poor', 'unreadable', name='legibility', native_enum=False, length=32), nullable=True),
    sa.Column('ai_confidence', sa.Float(), nullable=True),
    sa.Column('ai_snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('field_sources', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('amount_applied', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('warnings', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.Column('processing_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('notification_batch_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['advance_id'], ['advances.id'], name=op.f('fk_expenses_advance_id_advances')),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_expenses_company_id_companies')),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_expenses_employee_id_employees')),
    sa.ForeignKeyConstraint(['parent_id'], ['expenses.id'], name=op.f('fk_expenses_parent_id_expenses')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_expenses')),
    sa.UniqueConstraint('employee_id', 'client_ref', name='uq_expenses_employee_client_ref'),
    sa.UniqueConstraint('wa_message_id', name=op.f('uq_expenses_wa_message_id'))
    )
    op.create_index('ix_expenses_advance', 'expenses', ['advance_id'], unique=False)
    op.create_index('ix_expenses_employee_status', 'expenses', ['employee_id', 'status'], unique=False)
    op.create_index(op.f('ix_expenses_file_sha256'), 'expenses', ['file_sha256'], unique=False)
    op.create_index(op.f('ix_expenses_fiscal_id'), 'expenses', ['fiscal_id'], unique=False)
    op.create_index(op.f('ix_expenses_notification_batch_id'), 'expenses', ['notification_batch_id'], unique=False)
    op.create_index('ix_expenses_updated_at', 'expenses', ['updated_at'], unique=False)
    op.create_index('ix_expenses_vendor_invoice', 'expenses', ['vendor_tax_id', 'invoice_number'], unique=False)
    op.create_table('extraction_attempts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('expense_id', sa.Uuid(), nullable=False),
    sa.Column('attempt_no', sa.Integer(), nullable=False),
    sa.Column('tier', sa.String(length=20), nullable=False),
    sa.Column('model_requested', sa.String(length=120), nullable=False),
    sa.Column('model_used', sa.String(length=120), nullable=True),
    sa.Column('prompt_version', sa.String(length=40), nullable=False),
    sa.Column('raw_response', sa.Text(), nullable=True),
    sa.Column('parsed', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('validation_errors', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('escalation_reason', sa.String(length=300), nullable=True),
    sa.Column('confidence', sa.Float(), nullable=True),
    sa.Column('prompt_tokens', sa.Integer(), nullable=True),
    sa.Column('completion_tokens', sa.Integer(), nullable=True),
    sa.Column('cached_tokens', sa.Integer(), nullable=True),
    sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('timings', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('error', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['expense_id'], ['expenses.id'], name=op.f('fk_extraction_attempts_expense_id_expenses'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_extraction_attempts'))
    )
    op.create_index(op.f('ix_extraction_attempts_created_at'), 'extraction_attempts', ['created_at'], unique=False)
    op.create_index(op.f('ix_extraction_attempts_expense_id'), 'extraction_attempts', ['expense_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_extraction_attempts_expense_id'), table_name='extraction_attempts')
    op.drop_index(op.f('ix_extraction_attempts_created_at'), table_name='extraction_attempts')
    op.drop_table('extraction_attempts')
    op.drop_index('ix_expenses_vendor_invoice', table_name='expenses')
    op.drop_index('ix_expenses_updated_at', table_name='expenses')
    op.drop_index(op.f('ix_expenses_notification_batch_id'), table_name='expenses')
    op.drop_index(op.f('ix_expenses_fiscal_id'), table_name='expenses')
    op.drop_index(op.f('ix_expenses_file_sha256'), table_name='expenses')
    op.drop_index('ix_expenses_employee_status', table_name='expenses')
    op.drop_index('ix_expenses_advance', table_name='expenses')
    op.drop_table('expenses')
    op.drop_table('whatsapp_link_codes')
    op.drop_index(op.f('ix_refresh_tokens_family_id'), table_name='refresh_tokens')
    op.drop_index(op.f('ix_refresh_tokens_employee_id'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index('ix_advances_employee_status', table_name='advances')
    op.drop_index('ix_advances_company', table_name='advances')
    op.drop_table('advances')
    op.drop_table('inbound_messages')
    op.drop_index(op.f('ix_employees_wa_welcome_message_id'), table_name='employees')
    op.drop_index('ix_employees_company_ids', table_name='employees', postgresql_using='gin')
    op.drop_table('employees')
    op.drop_table('companies')
    op.drop_index(op.f('ix_audit_log_created_at'), table_name='audit_log')
    op.drop_index('ix_audit_entity', table_name='audit_log')
    op.drop_table('audit_log')
