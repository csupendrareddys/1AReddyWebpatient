"""Notification Template registry — DB-backed replacement for the
``COMBIRDS_TEMPLATE_*`` env vars.

Creates ``notification_templates`` (platform-level, no tenant_id) and
seeds the four auth-flow templates (login OTP, signup OTP, password
reset OTP, mobile-verify OTP) with the bodies that match the DLT
submissions. ``template_id`` columns are seeded as NULL — they get
filled in once DLT returns the approved IDs (via the admin UI or a
direct UPDATE).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-26
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


SEED_ROWS = [
    {
        'purpose': 'login_otp',
        'name': 'Login OTP',
        'body_template': (
            '{otp} is your OTP to log in to {company_name}. '
            'Valid for 10 minutes. Do not share it with anyone. - LARAZN'
        ),
        'variable_names': ['otp', 'company_name'],
        'notes': 'DLT submission pending — fill template_id once approved.',
    },
    {
        'purpose': 'signup_otp',
        'name': 'Signup verification OTP',
        'body_template': (
            '{otp} is your verification code to create your {company_name} '
            'account. Valid for 10 minutes. Do not share it with anyone. - LARAZN'
        ),
        'variable_names': ['otp', 'company_name'],
        'notes': 'DLT submission pending — fill template_id once approved.',
    },
    {
        'purpose': 'reset_pw_otp',
        'name': 'Password reset OTP',
        'body_template': (
            '{otp} is your OTP to reset your password on {company_name}. '
            'Valid for 10 minutes. Do not share it with anyone. - LARAZN'
        ),
        'variable_names': ['otp', 'company_name'],
        'notes': 'DLT submission pending — fill template_id once approved.',
    },
    {
        'purpose': 'verify_phone_otp',
        'name': 'Mobile-number verification OTP',
        'body_template': (
            '{otp} is your OTP to verify your mobile number on {company_name}. '
            'Valid for 10 minutes. Do not share it with anyone. - LARAZN'
        ),
        'variable_names': ['otp', 'company_name'],
        'notes': 'DLT submission pending — fill template_id once approved.',
    },
]


def upgrade():
    op.create_table(
        'notification_templates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('purpose', sa.String(80), nullable=False, unique=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('channel', sa.String(20), nullable=False, server_default='sms'),
        sa.Column('template_id', sa.String(100), nullable=True),
        sa.Column('sender_id', sa.String(20), nullable=False, server_default='LARAZN'),
        sa.Column('body_template', sa.Text, nullable=False),
        sa.Column('variable_names', JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        'ix_notification_templates_purpose',
        'notification_templates', ['purpose'], unique=True,
    )
    op.create_index(
        'ix_notification_templates_channel_active',
        'notification_templates', ['channel', 'is_active'],
    )

    # Seed the 4 auth-flow templates.
    import json
    bind = op.get_bind()
    for row in SEED_ROWS:
        bind.execute(
            sa.text(
                """
                INSERT INTO notification_templates
                    (id, purpose, name, channel, template_id, sender_id,
                     body_template, variable_names, is_active, notes)
                VALUES
                    (:id, :purpose, :name, 'sms', NULL, 'LARAZN',
                     :body, CAST(:vars AS JSONB), TRUE, :notes)
                """
            ),
            {
                'id': str(uuid.uuid4()),
                'purpose': row['purpose'],
                'name': row['name'],
                'body': row['body_template'],
                'vars': json.dumps(row['variable_names']),
                'notes': row['notes'],
            },
        )


def downgrade():
    op.drop_index('ix_notification_templates_channel_active', table_name='notification_templates')
    op.drop_index('ix_notification_templates_purpose', table_name='notification_templates')
    op.drop_table('notification_templates')
