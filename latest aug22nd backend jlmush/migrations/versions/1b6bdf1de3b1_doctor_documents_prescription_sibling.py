"""doctor documents — deliverables attached to purchased services (marketplace orders)

Revision ID: 1b6bdf1de3b1
Revises: 8dfd6eb651c9
Create Date: 2026-07-20 07:26:38.930196

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# ``followuptype`` / ``consultationtype`` already exist in the DB (created
# with the prescription tables), so reference them with create_type=False —
# otherwise this migration dies with "type already exists". Only
# ``documentstatus`` is new and has to actually be created.
followuptype = postgresql.ENUM(
    'free_doctor', 'paid_patient_picks', 'paid_doctor_picks',
    name='followuptype', create_type=False,
)
consultationtype = postgresql.ENUM(
    'video', 'audio', 'chat', 'complete', 'home_visit', 'camp',
    name='consultationtype', create_type=False,
)
documentstatus = postgresql.ENUM(
    'draft', 'pending_approval', 'approved', 'active', 'rejected',
    'revised', 'expired', 'cancelled', name='documentstatus',
    create_type=False,   # created explicitly in upgrade(), see below
)


# revision identifiers, used by Alembic.
revision = '1b6bdf1de3b1'
down_revision = '8dfd6eb651c9'
branch_labels = None
depends_on = None


def upgrade():
    documentstatus.create(op.get_bind(), checkfirst=True)

    op.create_table('doctor_documents',
    sa.Column('document_id', sa.UUID(), nullable=False),
    sa.Column('order_id', sa.UUID(), nullable=False),
    sa.Column('patient_id', sa.UUID(), nullable=False),
    sa.Column('doctor_id', sa.UUID(), nullable=False),
    sa.Column('diagnosis', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('allergies', sa.Text(), nullable=True),
    sa.Column('diagnostic_tests', sa.Text(), nullable=True),
    sa.Column('instructions', sa.Text(), nullable=True),
    sa.Column('previous_medical_history', sa.Text(), nullable=True),
    sa.Column('doctors_advice', sa.Text(), nullable=True),
    sa.Column('follow_up', sa.Text(), nullable=True),
    sa.Column('follow_up_type', followuptype, nullable=True),
    sa.Column('follow_up_consultation_type', consultationtype, nullable=True),
    sa.Column('follow_up_date', sa.Date(), nullable=True),
    sa.Column('follow_up_time_slot_id', sa.UUID(), nullable=True),
    sa.Column('status', documentstatus, nullable=False),
    sa.Column('parent_document_id', sa.UUID(), nullable=True),
    sa.Column('revision_number', sa.Integer(), nullable=False),
    sa.Column('issue_date', sa.Date(), nullable=False),
    sa.Column('valid_until', sa.Date(), nullable=True),
    sa.Column('pdf_link', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('is_deleted', sa.Boolean(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['marketplace_orders.order_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['follow_up_time_slot_id'], ['time_slots.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_document_id'], ['doctor_documents.document_id'], ),
    sa.ForeignKeyConstraint(['patient_id'], ['patients.patient_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('document_id')
    )
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.create_index('ix_doctor_documents_active', ['tenant_id', 'status'], unique=False, postgresql_where=sa.text('is_deleted = FALSE'))
        batch_op.create_index(batch_op.f('ix_doctor_documents_order_id'), ['order_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_doctor_id'), ['doctor_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_parent_document_id'), ['parent_document_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_patient_id'), ['patient_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_documents_tenant_id'), ['tenant_id'], unique=False)

    op.create_table('doctor_document_medicines',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('document_id', sa.UUID(), nullable=False),
    sa.Column('medicine_id', sa.UUID(), nullable=True),
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
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['doctor_documents.document_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['medicine_id'], ['medicines.medicine_id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('doctor_document_medicines', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_doctor_document_medicines_document_id'), ['document_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_document_medicines_medicine_id'), ['medicine_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_document_medicines_tenant_id'), ['tenant_id'], unique=False)

    # ── Row-Level Security: both tables are tenant-scoped ──
    # Same policy set every other tenant table carries (see
    # c3d4e5f6a7b8_enable_rls_tenant_tables). Without it these tables are
    # readable across tenants by any endpoint that leans on RLS instead
    # of an explicit tenant filter.
    from app.models._base import generate_rls_sql
    for table in ('doctor_documents', 'doctor_document_medicines'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in ('doctor_document_medicines', 'doctor_documents'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    with op.batch_alter_table('doctor_document_medicines', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_doctor_document_medicines_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_document_medicines_medicine_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_document_medicines_document_id'))

    op.drop_table('doctor_document_medicines')
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_doctor_documents_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_status'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_patient_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_parent_document_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_is_deleted'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_doctor_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_documents_order_id'))
        batch_op.drop_index('ix_doctor_documents_active', postgresql_where=sa.text('is_deleted = FALSE'))

    op.drop_table('doctor_documents')
    documentstatus.drop(op.get_bind(), checkfirst=True)
