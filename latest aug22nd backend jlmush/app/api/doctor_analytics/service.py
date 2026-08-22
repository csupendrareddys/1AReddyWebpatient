"""
Doctor Analytics Service
Business logic for doctor metrics, appointment settings, and live status.
"""
import logging
from datetime import date, timedelta
from sqlalchemy import func, and_, case

from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    Doctor, TimeSlot, Appointment, Payment,
    AppointmentStatus, PaymentStatus, AcceptingAppointmentType, UserRole,
)

logger = logging.getLogger(__name__)


class DoctorAnalyticsService:
    """Handles analytics queries and settings updates for doctors."""

    # ------------------------------------------------------------------ #
    # Date-range helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _date_range(period, reference_date=None):
        """
        Return (start_date, end_date) inclusive for the given period.
        period: 'day' | 'week' | 'month'
        """
        ref = reference_date or date.today()
        if period == 'day':
            return ref, ref
        elif period == 'week':
            start = ref - timedelta(days=ref.weekday())  # Monday
            end = start + timedelta(days=6)               # Sunday
            return start, end
        elif period == 'month':
            start = ref.replace(day=1)
            # Last day of month
            if ref.month == 12:
                end = ref.replace(year=ref.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                end = ref.replace(month=ref.month + 1, day=1) - timedelta(days=1)
            return start, end
        else:
            return ref, ref

    # ------------------------------------------------------------------ #
    # Metrics
    # ------------------------------------------------------------------ #
    @classmethod
    def get_metrics(cls, doctor_id, period='day', reference_date=None):
        """
        Aggregate slot / booking / revenue metrics for a doctor.

        Returns dict:
            slots_generated, slots_booked, slots_available,
            booking_rate, revenue_earned,
            appointments_completed, appointments_cancelled, appointments_pending
        """
        start_date, end_date = cls._date_range(period, reference_date)
        tid = current_tenant_id_strict()

        # --- Slot counts ---
        slot_q = TimeSlot.query.filter(
            TimeSlot.tenant_id == tid,
            TimeSlot.doctor_id == doctor_id,
            TimeSlot.date >= start_date,
            TimeSlot.date <= end_date,
        )
        slots_generated = slot_q.count()
        slots_booked = slot_q.filter(TimeSlot.is_booked == True).count()
        slots_available = slots_generated - slots_booked
        booking_rate = round((slots_booked / slots_generated * 100), 1) if slots_generated > 0 else 0

        # --- Appointment counts by status ---
        appt_base = Appointment.query.filter(
            Appointment.tenant_id == tid,
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.is_deleted == False,
        )
        appointments_completed = appt_base.filter(
            Appointment.status == AppointmentStatus.COMPLETED
        ).count()
        appointments_cancelled = appt_base.filter(
            Appointment.status == AppointmentStatus.CANCELLED
        ).count()
        appointments_pending = appt_base.filter(
            Appointment.status.in_([
                AppointmentStatus.PENDING,
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.PENDING_PAYMENT,
            ])
        ).count()
        appointments_total = appt_base.count()

        # --- Revenue from completed appointments with successful payments ---
        revenue_result = (
            db.session.query(func.coalesce(func.sum(Payment.amount), 0))
            .join(Appointment, Payment.appointment_id == Appointment.id)
            .filter(
                Payment.tenant_id == tid,
                Appointment.tenant_id == tid,
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date >= start_date,
                Appointment.appointment_date <= end_date,
                Appointment.is_deleted == False,
                Payment.status == PaymentStatus.SUCCESS,
            )
            .scalar()
        )
        revenue_earned = float(revenue_result) if revenue_result else 0.0

        # --- Scheduled hours + employee/consultant compliance (Phase 2) ---
        # Reuses this analytics engine + the day/week/month period selector to
        # track scheduled slot-hours against the agreement minimums (track+warn).
        from app.models import DoctorBillingProfile
        bp = DoctorBillingProfile.query.filter_by(tenant_id=tid, doctor_id=doctor_id).first()
        compliance = None
        # Item 2C — min-slot rules come from the doctor's active plan (employment
        # terms), falling back to a legacy employment agreement.
        emp = cls._employment_terms(doctor_id, tid)
        if emp:
            compliance = cls._compute_compliance(
                doctor_id, tid, start_date, end_date, period, emp)
            scheduled_hours = compliance['scheduled_hours']
        else:
            dur = db.session.query(
                func.coalesce(func.sum(func.extract('epoch', TimeSlot.end_time - TimeSlot.start_time)), 0)
            ).filter(
                TimeSlot.tenant_id == tid, TimeSlot.doctor_id == doctor_id,
                TimeSlot.date >= start_date, TimeSlot.date <= end_date,
            ).scalar()
            scheduled_hours = round(float(dur or 0) / 3600.0, 2)

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'slots_generated': slots_generated,
            'slots_booked': slots_booked,
            'slots_available': slots_available,
            'booking_rate': booking_rate,
            'revenue_earned': revenue_earned,
            'appointments_completed': appointments_completed,
            'appointments_cancelled': appointments_cancelled,
            'appointments_pending': appointments_pending,
            'appointments_total': appointments_total,
            'scheduled_hours': scheduled_hours,
            'billing_type': bp.billing_type.value if bp else 'plan',
            'compliance': compliance,
        }

    @classmethod
    def _employment_terms(cls, doctor_id, tid):
        """Normalized employment terms for compliance: active plan → legacy
        agreement → None. Returns a dict with min_hours_per_*, day_window_start/end
        ('HH:MM'), per_type_minimums."""
        from app.models import Doctor, DoctorBillingProfile
        from app.api.common.payment.billing_service import resolve_active_plan
        doctor = Doctor.query.filter_by(tenant_id=tid, id=doctor_id).first()
        plan = resolve_active_plan(doctor) if doctor else None
        if plan:
            emp = plan.billing_terms()['employment']
            if (any(emp.get(k) is not None for k in
                    ('min_hours_per_day', 'min_hours_per_week', 'min_hours_per_month'))
                    or emp.get('per_type_minimums') or emp.get('day_window_start')):
                return emp
        bp = DoctorBillingProfile.query.filter_by(tenant_id=tid, doctor_id=doctor_id).first()
        agr = bp.active_agreement if (bp and bp.active_agreement_id) else None
        if agr:
            return {
                'min_hours_per_day': agr.min_hours_per_day,
                'min_hours_per_week': agr.min_hours_per_week,
                'min_hours_per_month': agr.min_hours_per_month,
                'day_window_start': agr.day_window_start.strftime('%H:%M') if agr.day_window_start else None,
                'day_window_end': agr.day_window_end.strftime('%H:%M') if agr.day_window_end else None,
                'per_type_minimums': agr.per_type_minimums or {},
            }
        return None

    @staticmethod
    def _compute_compliance(doctor_id, tid, start_date, end_date, period, emp):
        """Scheduled slot-hours vs the plan/agreement minimums (track+warn).
        ``emp`` is the normalized terms dict from :meth:`_employment_terms`."""
        from datetime import datetime as _dt

        def _parse_time(v):
            if not v:
                return None
            if hasattr(v, 'hour'):  # already a time
                return v
            try:
                return _dt.strptime(str(v), '%H:%M').time()
            except ValueError:
                return None

        slots = TimeSlot.query.filter(
            TimeSlot.tenant_id == tid, TimeSlot.doctor_id == doctor_id,
            TimeSlot.date >= start_date, TimeSlot.date <= end_date,
        ).all()

        total_hours = 0.0
        per_type = {}
        outside_window_hours = 0.0
        ws, we = _parse_time(emp.get('day_window_start')), _parse_time(emp.get('day_window_end'))
        for s in slots:
            if not s.start_time or not s.end_time:
                continue
            dur = (_dt.combine(date.min, s.end_time) - _dt.combine(date.min, s.start_time)).total_seconds() / 3600.0
            total_hours += dur
            for tt in (s.consultation_types or []):
                ct = getattr(tt.consultation_type, 'value', tt.consultation_type)
                per_type[ct] = per_type.get(ct, 0.0) + dur
            if ws and we and (s.start_time < ws or s.end_time > we):
                outside_window_hours += dur

        total_hours = round(total_hours, 2)
        req_map = {
            'day': emp.get('min_hours_per_day'),
            'week': emp.get('min_hours_per_week'),
            'month': emp.get('min_hours_per_month'),
        }
        required = req_map.get(period)
        required = float(required) if required is not None else None

        warnings, met = [], True
        if required is not None and total_hours < required:
            met = False
            warnings.append(f'Scheduled {total_hours}h is below the required {required}h for the {period}.')

        per_type_status = {}
        for ct, minh in (emp.get('per_type_minimums') or {}).items():
            actual = round(per_type.get(ct, 0.0), 2)
            ok = actual >= float(minh)
            per_type_status[ct] = {'required': float(minh), 'actual': actual, 'met': ok}
            if not ok:
                met = False
                warnings.append(f'{ct}: {actual}h below the required {minh}h.')

        if outside_window_hours > 0 and ws and we:
            met = False
            warnings.append(
                f'{round(outside_window_hours, 2)}h scheduled outside the allowed window '
                f'{ws.strftime("%H:%M")}–{we.strftime("%H:%M")}.')

        return {
            'period': period,
            'scheduled_hours': total_hours,
            'required_hours': required,
            'met': met,
            'per_type': per_type_status,
            'outside_window_hours': round(outside_window_hours, 2),
            'day_window': {
                'start': ws.strftime('%H:%M') if ws else None,
                'end': we.strftime('%H:%M') if we else None,
            },
            'warnings': warnings,
        }

    # ------------------------------------------------------------------ #
    # Settings (is_live, accepting_appointments, admin_allowed_modes)
    # ------------------------------------------------------------------ #
    @staticmethod
    def get_settings(doctor_id):
        """Return current analytics-related settings for a doctor."""
        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        if not doctor:
            return None
        from app.models import DoctorBillingProfile
        bp = DoctorBillingProfile.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor.id,
        ).first()
        return {
            'is_live': doctor.is_live,
            'accepting_appointments': doctor.accepting_appointments.value if doctor.accepting_appointments else 'manual',
            'admin_allowed_appointment_modes': doctor.admin_allowed_appointment_modes or ['manual'],
            # Payout config (Phase 1) — admin-controlled.
            'billing_type': bp.billing_type.value if bp else 'plan',
            'payout_mode': bp.payout_mode.value if bp else 'autopay',
            'hold_days_override': bp.hold_days_override if bp else None,
            'tds_rate_override': (
                float(bp.tds_rate_override)
                if bp and bp.tds_rate_override is not None else None
            ),
        }

    @staticmethod
    def update_settings(doctor_id, data, current_user):
        """
        Update doctor settings.
        - Admin: can change is_live, admin_allowed_appointment_modes, accepting_appointments
        - Doctor: can only change accepting_appointments (within admin-allowed modes)
        """
        doctor = Doctor.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=doctor_id,
        ).first()
        if not doctor:
            return None, 'Doctor not found'

        is_admin = current_user.role in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER)

        # Admin-only fields
        if is_admin:
            if 'is_live' in data:
                doctor.is_live = bool(data['is_live'])

            if 'admin_allowed_appointment_modes' in data:
                allowed = data['admin_allowed_appointment_modes']
                # Validate all values are valid enum members
                valid_modes = {e.value for e in AcceptingAppointmentType if e.value not in ('other1', 'other2')}
                sanitized = [m for m in allowed if m in valid_modes]
                if not sanitized:
                    sanitized = ['manual']
                doctor.admin_allowed_appointment_modes = sanitized

                # If current accepting_appointments is no longer allowed, reset to first allowed
                if doctor.accepting_appointments.value not in sanitized:
                    doctor.accepting_appointments = AcceptingAppointmentType(sanitized[0])

            # Payout config (Phase 1) — admin-only per-doctor autopay|claim +
            # hold override, stored on DoctorBillingProfile.
            if ('payout_mode' in data or 'hold_days_override' in data
                    or 'tds_rate_override' in data):
                from app.api.common.payment.billing_service import get_or_create_billing_profile
                from app.models import PayoutMode
                bp = get_or_create_billing_profile(doctor)
                if 'payout_mode' in data:
                    try:
                        bp.payout_mode = PayoutMode(data['payout_mode'])
                    except ValueError:
                        return None, f"Invalid payout_mode: {data['payout_mode']}"
                if 'hold_days_override' in data:
                    v = data['hold_days_override']
                    bp.hold_days_override = None if v in (None, '') else max(0, int(v))
                if 'tds_rate_override' in data:
                    v = data['tds_rate_override']
                    if v in (None, ''):
                        bp.tds_rate_override = None
                    else:
                        try:
                            v = float(v)
                        except (ValueError, TypeError):
                            return None, "Invalid tds_rate_override: must be a number"
                        if v < 0 or v > 100:
                            return None, "tds_rate_override must be between 0 and 100"
                        bp.tds_rate_override = v

        # Both admin and doctor can change accepting_appointments
        if 'accepting_appointments' in data:
            new_mode = data['accepting_appointments']
            allowed_modes = doctor.admin_allowed_appointment_modes or ['manual']
            if new_mode not in allowed_modes:
                return None, f'Mode "{new_mode}" is not allowed by admin. Allowed: {allowed_modes}'
            try:
                doctor.accepting_appointments = AcceptingAppointmentType(new_mode)
            except ValueError:
                return None, f'Invalid appointment mode: {new_mode}'

        db.session.commit()
        logger.debug(f"[ANALYTICS:SETTINGS] Updated doctor={doctor_id}, is_live={doctor.is_live}, mode={doctor.accepting_appointments.value}")

        return DoctorAnalyticsService.get_settings(doctor_id), None
