"""documents: dedicated rejection_reason column

The admin reject route (``/api/admin/document-config/reject/<id>``) was
copied from the prescription one and appended the reason to ``notes``.
That worked for prescriptions — ``Prescription.notes`` still exists — but
``f1a2b3c4d5e6`` dropped ``notes`` from ``doctor_documents`` along with the
rest of the clinical schema, so the write raised AttributeError and any
rejection *with a reason* 500'd. Reject-with-no-reason silently worked,
which is why it went unnoticed.

A dedicated column rather than resurrecting ``notes``: the reason is
admin-authored review metadata, not doctor-authored clinical content, and
the previous scheme (string-appending ``[Admin Rejection: ...]`` into a
content field) made it impossible to display or clear the reason on its own.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-07-25 09:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a2b3c4d5e6f7'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rejection_reason', sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table('doctor_documents', schema=None) as batch_op:
        batch_op.drop_column('rejection_reason')
