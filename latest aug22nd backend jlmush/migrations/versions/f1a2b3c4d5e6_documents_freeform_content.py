"""documents: free-form content (description + custom_fields + attachment)

Replaces the document's fixed clinical schema with doctor-authored
sections. A document is whatever the doctor sold, so the section names
belong to the doctor, not to the table.

Dropped on purpose (product decision — the old columns are NOT migrated
into custom_fields, any existing content in them is discarded):
  * the eight clinical text columns
  * the four structured follow-up columns — documents never activated
    follow-ups anyway (FollowUpService is prescription-scoped)
  * the whole ``doctor_document_medicines`` table

Prescriptions are untouched: they keep the structured clinical schema,
their own medicines table, and the follow-up machinery.

Revision ID: f1a2b3c4d5e6
Revises: c4e62a239e10
Create Date: 2026-07-25 09:05:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'f1a2b3c4d5e6'
down_revision = 'c4e62a239e10'
branch_labels = None
depends_on = None


_CLINICAL_COLUMNS = (
    'diagnosis',
    'notes',
    'allergies',
    'diagnostic_tests',
    'instructions',
    'previous_medical_history',
    'doctors_advice',
    'follow_up',
)

_FOLLOW_UP_COLUMNS = (
    'follow_up_type',
    'follow_up_consultation_type',
    'follow_up_date',
    'follow_up_time_slot_id',
)


def upgrade():
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('description', sa.Text(), nullable=True))
        # server_default so the NOT NULL holds for rows that already exist;
        # the model default keeps new rows a real list either way.
        batch_op.add_column(sa.Column(
            'custom_fields', postgresql.JSON(astext_type=sa.Text()),
            nullable=False, server_default='[]',
        ))
        batch_op.add_column(sa.Column('attachment_link', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('attachment_name', sa.String(length=255), nullable=True))

    # Carry the old free-text "title" of an uploaded PDF over — upload_document
    # used to stash the filename in ``notes`` and now uses ``description``.
    # Everything else in the dropped columns is intentionally discarded.
    op.execute("""
        UPDATE doctor_documents
           SET description = notes
         WHERE pdf_link IS NOT NULL
           AND notes IS NOT NULL
           AND description IS NULL
    """)

    # The FK to time_slots goes with the column; name it explicitly because
    # batch_alter_table cannot reflect it on Postgres without a naming
    # convention in scope.
    op.execute(
        'ALTER TABLE doctor_documents '
        'DROP CONSTRAINT IF EXISTS doctor_documents_follow_up_time_slot_id_fkey'
    )

    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        for col in _CLINICAL_COLUMNS + _FOLLOW_UP_COLUMNS:
            batch_op.drop_column(col)

    # Policies and indexes are dropped with the table.
    op.drop_table('doctor_document_medicines')


def downgrade():
    """Restores the shape, not the data — the dropped content is gone."""
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        for col in _CLINICAL_COLUMNS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))
        batch_op.add_column(sa.Column(
            'follow_up_type',
            postgresql.ENUM(name='followuptype', create_type=False), nullable=True,
        ))
        batch_op.add_column(sa.Column(
            'follow_up_consultation_type',
            postgresql.ENUM(name='consultationtype', create_type=False), nullable=True,
        ))
        batch_op.add_column(sa.Column('follow_up_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column(
            'follow_up_time_slot_id', postgresql.UUID(as_uuid=True), nullable=True,
        ))

    op.execute("""
        UPDATE doctor_documents
           SET notes = description
         WHERE pdf_link IS NOT NULL
           AND description IS NOT NULL
    """)

    op.create_foreign_key(
        'doctor_documents_follow_up_time_slot_id_fkey',
        'doctor_documents', 'time_slots',
        ['follow_up_time_slot_id'], ['id'], ondelete='SET NULL',
    )

    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.drop_column('attachment_name')
        batch_op.drop_column('attachment_link')
        batch_op.drop_column('custom_fields')
        batch_op.drop_column('description')

    op.create_table(
        'doctor_document_medicines',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('document_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('medicine_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('custom_generic_name', sa.String(length=300), nullable=True),
        sa.Column('custom_brand_name', sa.String(length=300), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=True),
        sa.Column('quantity_unit', sa.String(length=50), nullable=True),
        sa.Column('dosage', sa.String(length=200), nullable=True),
        sa.Column('frequency', sa.String(length=200), nullable=True),
        sa.Column('duration', sa.String(length=200), nullable=True),
        sa.Column('morning', sa.String(length=10), nullable=True),
        sa.Column('afternoon', sa.String(length=10), nullable=True),
        sa.Column('evening', sa.String(length=10), nullable=True),
        sa.Column('night', sa.String(length=10), nullable=True),
        sa.Column('medicine_type', sa.String(length=20), nullable=True),
        sa.Column('timing', sa.String(length=200), nullable=True),
        sa.Column('morning_timing', sa.String(length=100), nullable=True),
        sa.Column('afternoon_timing', sa.String(length=100), nullable=True),
        sa.Column('evening_timing', sa.String(length=100), nullable=True),
        sa.Column('night_timing', sa.String(length=100), nullable=True),
        sa.Column('morning_instructions', sa.Text(), nullable=True),
        sa.Column('afternoon_instructions', sa.Text(), nullable=True),
        sa.Column('evening_instructions', sa.Text(), nullable=True),
        sa.Column('night_instructions', sa.Text(), nullable=True),
        sa.Column('custom_dose_unit', sa.String(length=50), nullable=True),
        sa.Column('special_instructions', sa.Text(), nullable=True),
        sa.Column('serial_no', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['doctor_documents.document_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['medicine_id'], ['medicines.medicine_id']),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    )
