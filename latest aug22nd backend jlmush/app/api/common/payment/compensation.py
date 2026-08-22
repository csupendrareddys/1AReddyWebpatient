"""
Compensation strategy — the single answer to "how is this doctor paid".

Three models today, resolved from ``DoctorBillingProfile.billing_type``:

  PLAN_BASED                     per-patient payout for every appointment
  EMPLOYEE_FIXED                 fixed salary only; never a per-patient payout
  CONSULTANT_RETAINER_INCENTIVE  base retainer covering work up to a period
                                 target, then a per-patient payout for each
                                 appointment ABOVE it

Anything that would otherwise branch on ``billing_type`` asks a strategy
instead, so adding a compensation model is a new subclass rather than another
scattered ``if``. Future consultant models (hourly, per-session, custom) plug in
here and read their parameters from the plan's ``features`` JSONB — the same
extensibility route ``billing_terms()`` already uses, so no schema change.

Deliberately read-only: this is called from the appointment-completion path, so
it must never write (no get-or-create) and never raise — a doctor with no
billing profile is simply PLAN_BASED, which is the column default.
"""
import logging

logger = logging.getLogger(__name__)

PLAN_BASED = 'plan_based'
EMPLOYEE_FIXED = 'employee_fixed'
CONSULTANT_RETAINER_INCENTIVE = 'consultant_retainer_incentive'


class Strategy:
    """How one doctor earns. Subclasses answer the two questions callers ask."""

    name = None

    def __init__(self, doctor, profile=None):
        self.doctor = doctor
        self.profile = profile

    def earns_per_appointment(self, appointment=None):
        """True when a completed appointment should create a DoctorPayout."""
        raise NotImplementedError

    def periodic_kind(self):
        """``'salary'`` / ``'retainer'`` for a periodic run, else None."""
        return None

    def to_dict(self):
        return {
            'model': self.name,
            'periodic_kind': self.periodic_kind(),
            'earns_per_appointment': self.earns_per_appointment(),
        }

    def __repr__(self):
        return f'<Strategy {self.name} doctor={getattr(self.doctor, "id", None)}>'


class PlanBasedStrategy(Strategy):
    """The existing, untouched model: every appointment earns."""

    name = PLAN_BASED

    def earns_per_appointment(self, appointment=None):
        return True


class EmployeeFixedStrategy(Strategy):
    """Salaried. The fixed salary replaces per-appointment earnings entirely.

    The salary is never reduced because bookings were light — healthcare demand
    is unpredictable and a doctor may sit available with no patients. Only an
    explicit, reasoned admin adjustment changes what is paid.
    """

    name = EMPLOYEE_FIXED

    def earns_per_appointment(self, appointment=None):
        return False

    def periodic_kind(self):
        return 'salary'


class ConsultantRetainerIncentiveStrategy(Strategy):
    """Base retainer up to a target, per-patient earnings beyond it.

    The retainer already pays for the work up to the target, so charging a
    per-patient payout for those appointments would pay twice. Past the target
    each further appointment earns through the ordinary plan calculation.

    With no target configured every appointment counts as above target, which is
    exactly today's behaviour — so consultants are unaffected until a tenant
    opts in.
    """

    name = CONSULTANT_RETAINER_INCENTIVE

    def earns_per_appointment(self, appointment=None):
        return incentive_target(self.doctor, self.profile) is None

    def periodic_kind(self):
        return 'retainer'


_BY_BILLING_TYPE = {
    'plan': PlanBasedStrategy,
    'employee': EmployeeFixedStrategy,
    'consultant': ConsultantRetainerIncentiveStrategy,
}


def incentive_target(doctor, profile=None):
    """The period target gating consultant incentives, or None if unset.

    Resolution mirrors the established precedence used by ``resolve_hold_days``:
    per-doctor override → plan default. Returns ``{'metric': str, 'value': num}``.

    Kept separate from the agreement's ``min_hours_per_month``: that measures
    *scheduled availability* for compliance warnings, and overloading it would
    mean changing a warning threshold silently changes someone's pay.
    """
    override = getattr(profile, 'incentive_target_override', None) if profile else None
    if override is not None:
        try:
            value = float(override)
        except (TypeError, ValueError):
            value = None
        if value and value > 0:
            return {'metric': 'appointment_minutes', 'value': value}

    from app.api.common.payment.billing_service import resolve_active_plan
    plan = resolve_active_plan(doctor)
    if not plan:
        return None
    cfg = (plan.features or {}).get('incentive_target') or {}
    try:
        value = float(cfg.get('value'))
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return {'metric': cfg.get('metric') or 'appointment_minutes', 'value': value}


def resolve_strategy(doctor, profile=None):
    """The compensation strategy for one doctor. Never writes, never raises."""
    from app.models import DoctorBillingProfile

    if profile is None and doctor is not None:
        profile = DoctorBillingProfile.query.filter_by(
            tenant_id=doctor.tenant_id, doctor_id=doctor.id,
        ).first()

    billing_type = 'plan'
    if profile is not None and profile.billing_type is not None:
        billing_type = profile.billing_type.value

    cls = _BY_BILLING_TYPE.get(billing_type, PlanBasedStrategy)
    return cls(doctor, profile)
