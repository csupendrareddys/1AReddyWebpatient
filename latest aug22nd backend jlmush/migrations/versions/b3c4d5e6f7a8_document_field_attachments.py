"""documents: per-field attachments + stable custom field ids

Each doctor-authored custom field can now carry its own list of files.
The document-wide ``attachment_link`` slot is unchanged — that one is
about the document as a whole; this table is the per-field list.

Custom fields gain a stable ``id``, backfilled here for existing rows.
Attachments are keyed to that id rather than to the field's position,
because the form lets the doctor reorder and delete rows.

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-07-26 06:10:00.000000

"""
import json
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b3c4d5e6f7a8'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'doctor_document_field_attachments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('document_id', postgresql.UUID(as_uuid=True), nullable=False),
        # Deliberately NOT a foreign key: custom fields live inside the
        # doctor_documents.custom_fields JSON column, not in a table.
        # The routes enforce the reference and prune orphans.
        sa.Column('field_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('s3_link', sa.String(length=500), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ['document_id'], ['doctor_documents.document_id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
    )
    op.create_index(
        'ix_doc_field_attachments_lookup',
        'doctor_document_field_attachments', ['document_id', 'field_id'],
    )
    op.create_index(
        op.f('ix_doctor_document_field_attachments_document_id'),
        'doctor_document_field_attachments', ['document_id'],
    )
    op.create_index(
        op.f('ix_doctor_document_field_attachments_field_id'),
        'doctor_document_field_attachments', ['field_id'],
    )
    # TenantMixin declares tenant_id with index=True — without this the
    # schema-parity check sees the model and the migration disagree.
    op.create_index(
        op.f('ix_doctor_document_field_attachments_tenant_id'),
        'doctor_document_field_attachments', ['tenant_id'],
    )

    # Same tenant isolation every other tenant-scoped table carries.
    op.execute('ALTER TABLE doctor_document_field_attachments ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE doctor_document_field_attachments FORCE ROW LEVEL SECURITY')
    op.execute("""
        CREATE POLICY tenant_isolation_doctor_document_field_attachments
            ON doctor_document_field_attachments
            USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("""
        CREATE POLICY tenant_insert_doctor_document_field_attachments
            ON doctor_document_field_attachments FOR INSERT
            WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)

    # Backfill ids on custom fields written before they existed. Without
    # this, older documents have fields that can never hold an attachment
    # (nothing to key it to) and would all collide on a null id.
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT document_id, custom_fields FROM doctor_documents "
        "WHERE custom_fields IS NOT NULL AND custom_fields::text <> '[]'"
    )).fetchall()

    for doc_id, fields in rows:
        if isinstance(fields, str):
            fields = json.loads(fields)
        if not isinstance(fields, list):
            continue
        changed = False
        for f in fields:
            if isinstance(f, dict) and not f.get('id'):
                f['id'] = str(uuid.uuid4())
                changed = True
        if changed:
            conn.execute(
                sa.text(
                    'UPDATE doctor_documents SET custom_fields = CAST(:cf AS json) '
                    'WHERE document_id = :id'
                ),
                {'cf': json.dumps(fields), 'id': doc_id},
            )


def downgrade():
    op.drop_table('doctor_document_field_attachments')
    # The ``id`` keys left behind in custom_fields are harmless — the older
    # code ignores unknown keys — so they are not stripped back out.
