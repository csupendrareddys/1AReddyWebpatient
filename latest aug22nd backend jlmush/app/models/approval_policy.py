"""Approval policy — the tenant-wide DEFAULT approval modes for a doctor's
sections and actions, kept in its own table (one row per tenant).

Two maps, both read live so an admin edit takes effect on the next submission:

* ``permission_modes`` — the Admin→Doctor permission per section
  (``auto`` = the doctor's change to that section auto-applies; ``manual`` =
  it stays PENDING for admin approval). Keys are the field-approval sections
  plus the recurring-ops / appointment / payments sections.

* ``action_modes`` — the doctor's own operating mode per action
  (``auto_accept`` / ``auto_reject`` / ``manual``) for appointment acceptance,
  prescription, document and group-plan. The admin sets this directly.

Per-doctor OVERRIDES live on the Doctor model (``approval_permission_modes`` /
``approval_action_modes`` JSON columns); the effective mode is
``per-doctor override → this global default → a hardcoded default``. See
:mod:`app.api.admin.approval_policy_service`.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin


# ── Canonical keys + defaults ────────────────────────────────────────────────
# permission_modes: 'auto' | 'manual'  (default 'manual' — preserves today's
# behaviour where every change needs admin approval until switched to auto).
PERMISSION_SECTIONS = (
    # Non-recurring profile (flow through FieldApprovalRequest — wired Phase 1)
    'personal_details', 'signatures', 'about_me', 'education', 'bank_details',
    # Recurring / operations (separate approval flow — wired Phase 2)
    'slot_visibility', 'consultation_pricing', 'working_hours',
    # Clinical push gates (auto = doctor pushes straight to patient — wired
    # Phase 2): prescription / document / group_plan.
    'prescription', 'document', 'group_plan',
)

# action_modes: 'auto_accept' | 'auto_reject' | 'manual'
#   * appointment_acceptance → the doctor's own accept mode (Phase 1)
#   * appointment_cancel / appointment_reschedule / payments → 3-way GATE on a
#     doctor-initiated action: auto_accept = proceed, auto_reject = auto-deny,
#     manual = HOLD pending admin approval (Phase 2b). reschedule has no app
#     action to hold yet (config only).
ACTION_KEYS = (
    'appointment_acceptance',
    'appointment_cancel', 'appointment_reschedule', 'payments',
)

DEFAULT_PERMISSION_MODE = 'manual'
DEFAULT_ACTION_MODE = 'manual'
PERMISSION_VALUES = ('auto', 'manual')
ACTION_VALUES = ('auto_accept', 'auto_reject', 'manual')


class ApprovalPolicy(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'approval_policies'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='policy_id')
    # { section: 'auto'|'manual' }
    permission_modes = db.Column(JSONB, nullable=False, default=dict)
    # { action: 'auto_accept'|'auto_reject'|'manual' }
    action_modes = db.Column(JSONB, nullable=False, default=dict)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', name='uq_approval_policy_tenant'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'permission_modes': self.permission_modes or {},
            'action_modes': self.action_modes or {},
            'is_active': self.is_active,
        }
