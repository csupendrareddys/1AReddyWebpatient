"""
Doctor Attendance Service
Business logic for attendance metrics, appointment tracking, metric overrides, and config.
"""
import logging
from datetime import date, timedelta, datetime, timezone
from sqlalchemy import func, and_, case

from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    Doctor, Appointment, MetricOverride, AttendancePageConfig,
    AssetLibraryUsage, AppointmentStatus, AcceptanceMethod, MetricOverrideStatus,
    ConsultationType, UserRole,
)

logger = logging.getLogger(__name__)


class DoctorAttendanceService:
    """Handles attendance metrics, doctor actions, overrides, and config."""

    # ------------------------------------------------------------------ #
    # Date-range helpers (reused from analytics)
    # ------------------------------------------------------------------ #
    @staticmethod
    def _date_range(period, reference_date=None):
        ref = reference_date or date.today()
        if period == 'day':
            return ref, ref
        elif period == 'week':
            start = ref - timedelta(days=ref.weekday())
            end = start + timedelta(days=6)
            return start, end
        elif period == 'month':
            start = ref.replace(day=1)
            if ref.month == 12:
                end = ref.replace(year=ref.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                end = ref.replace(month=ref.month + 1, day=1) - timedelta(days=1)
            return start, end
        return ref, ref

    # ------------------------------------------------------------------ #
    # Acceptance Metrics
    # ------------------------------------------------------------------ #
    @classmethod
    def get_acceptance_metrics(cls, doctor_id, period='day', reference_date=None, consultation_type=None):
        """
        Aggregate acceptance-stage metrics for a doctor.
        Returns counts grouped by auto_approved vs manually_approved.
        """
        start_date, end_date = cls._date_range(period, reference_date)

        # Base query
        base = Appointment.query.filter(
            Appointment.tenant_id == current_tenant_id_strict(),
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.is_deleted == False,
        )

        # Optional consultation type filter
        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
                base = base.filter(Appointment.consultation_type == ct_enum)
            except (ValueError, KeyError):
                pass  # ignore invalid type, return all

        total_received = base.count()

        # --- Auto-approved metrics ---
        auto_base = base.filter(Appointment.acceptance_method == AcceptanceMethod.AUTO_APPROVED)
        auto_total = auto_base.count()
        auto_verified = auto_base.filter(Appointment.doctor_verified == True).count()
        auto_accepted = auto_base.filter(Appointment.doctor_accepted == True).count()
        auto_rejected = auto_base.filter(Appointment.doctor_rejected == True).count()
        auto_cancelled = auto_base.filter(Appointment.doctor_cancelled == True).count()
        auto_rescheduled = auto_base.filter(Appointment.is_rescheduled == True).count()

        # --- Manual metrics ---
        manual_base = base.filter(Appointment.acceptance_method == AcceptanceMethod.MANUALLY_APPROVED)
        manual_total = manual_base.count()
        manual_accepted = manual_base.filter(Appointment.doctor_accepted == True).count()
        manual_rejected = manual_base.filter(Appointment.doctor_rejected == True).count()
        manual_cancelled = manual_base.filter(Appointment.doctor_cancelled == True).count()
        manual_rescheduled = manual_base.filter(Appointment.is_rescheduled == True).count()

        # --- Approved overrides for this period ---
        overrides = MetricOverride.query.filter(
            MetricOverride.tenant_id == current_tenant_id_strict(),
            MetricOverride.doctor_id == doctor_id,
            MetricOverride.status == MetricOverrideStatus.APPROVED,
            MetricOverride.period_start == start_date,
            MetricOverride.period_end == end_date,
        )
        if consultation_type:
            overrides = overrides.filter(
                (MetricOverride.consultation_type == consultation_type) |
                (MetricOverride.consultation_type == None)
            )
        override_map = {o.metric_type: o.suggested_value for o in overrides.all()}

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'consultation_type': consultation_type,
            'total_received': total_received,
            'auto_approved': {
                'total': override_map.get('auto_approved_total', auto_total),
                'verified': override_map.get('auto_verified', auto_verified),
                'accepted': override_map.get('auto_accepted', auto_accepted),
                'rejected': override_map.get('auto_rejected', auto_rejected),
                'cancelled': override_map.get('auto_cancelled', auto_cancelled),
                'rescheduled': override_map.get('auto_rescheduled', auto_rescheduled),
                # Raw (unoverridden) values for reference
                '_raw': {
                    'total': auto_total,
                    'verified': auto_verified,
                    'accepted': auto_accepted,
                    'rejected': auto_rejected,
                    'cancelled': auto_cancelled,
                    'rescheduled': auto_rescheduled,
                },
            },
            'manual': {
                'total': override_map.get('manual_total', manual_total),
                'accepted': override_map.get('manual_accepted', manual_accepted),
                'rejected': override_map.get('manual_rejected', manual_rejected),
                'cancelled': override_map.get('manual_cancelled', manual_cancelled),
                'rescheduled': override_map.get('manual_rescheduled', manual_rescheduled),
                '_raw': {
                    'total': manual_total,
                    'accepted': manual_accepted,
                    'rejected': manual_rejected,
                    'cancelled': manual_cancelled,
                    'rescheduled': manual_rescheduled,
                },
            },
            'has_overrides': len(override_map) > 0,
        }

    # ------------------------------------------------------------------ #
    # Doctor Actions (tracking flags)
    # ------------------------------------------------------------------ #
    @staticmethod
    def verify_appointment(appointment_id, doctor_user_id):
        """Mark appointment as verified by doctor (viewed patient details)."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'
        if appt.doctor_verified:
            return appt, None  # Already verified, idempotent

        appt.doctor_verified = True
        appt.doctor_verified_at = datetime.now(timezone.utc)
        db.session.commit()
        logger.info(f"[ATTENDANCE] Appointment {appointment_id} verified by doctor")
        return appt, None

    @staticmethod
    def doctor_accept_appointment(appointment_id, doctor_user_id):
        """Doctor confirms they can treat this patient."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'
        if appt.doctor_rejected:
            return None, 'Cannot accept a rejected appointment'

        appt.doctor_accepted = True
        appt.doctor_accepted_at = datetime.now(timezone.utc)
        db.session.commit()
        logger.info(f"[ATTENDANCE] Appointment {appointment_id} accepted by doctor")
        return appt, None

    @staticmethod
    def doctor_reject_appointment(appointment_id, doctor_user_id, reason=''):
        """Doctor flags wrong specialization (patient mistake)."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'
        if appt.doctor_accepted:
            return None, 'Cannot reject an already accepted appointment'

        appt.doctor_rejected = True
        appt.doctor_rejected_reason = reason
        db.session.commit()
        logger.info(f"[ATTENDANCE] Appointment {appointment_id} rejected by doctor: {reason}")
        return appt, None

    @staticmethod
    def doctor_cancel_appointment(appointment_id, doctor_user_id, reason=''):
        """Doctor cancels due to unavailability."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'

        appt.doctor_cancelled = True
        appt.doctor_cancelled_reason = reason
        db.session.commit()
        logger.info(f"[ATTENDANCE] Appointment {appointment_id} cancelled by doctor: {reason}")
        return appt, None

    # ------------------------------------------------------------------ #
    # Metric Overrides
    # ------------------------------------------------------------------ #
    @staticmethod
    def create_override(doctor_id, data):
        """Submit a metric correction suggestion."""
        tid = current_tenant_id_strict()
        # Check for existing pending override for same metric + period
        existing = MetricOverride.query.filter(
            MetricOverride.tenant_id == tid,
            MetricOverride.doctor_id == doctor_id,
            MetricOverride.metric_type == data['metric_type'],
            MetricOverride.period_start == data['period_start'],
            MetricOverride.period_end == data['period_end'],
            MetricOverride.status == MetricOverrideStatus.PENDING,
        ).first()

        if existing:
            # Replace existing pending override
            existing.original_value = data['original_value']
            existing.suggested_value = data['suggested_value']
            existing.reason = data['reason']
            existing.attachments = data.get('attachments')
            existing.consultation_type = data.get('consultation_type')
            db.session.commit()
            return existing, None

        override = MetricOverride(
            tenant_id=tid,
            doctor_id=doctor_id,
            metric_type=data['metric_type'],
            period_start=data['period_start'],
            period_end=data['period_end'],
            consultation_type=data.get('consultation_type'),
            original_value=data['original_value'],
            suggested_value=data['suggested_value'],
            reason=data['reason'],
            attachments=data.get('attachments'),
        )
        db.session.add(override)
        db.session.commit()
        return override, None

    @staticmethod
    def get_overrides(doctor_id, status=None):
        """List metric overrides for a doctor."""
        q = MetricOverride.query.filter(
            MetricOverride.tenant_id == current_tenant_id_strict(),
            MetricOverride.doctor_id == doctor_id,
        )
        if status:
            try:
                q = q.filter(MetricOverride.status == MetricOverrideStatus(status))
            except ValueError:
                pass
        return [o.to_dict() for o in q.order_by(MetricOverride.created_at.desc()).all()]

    @staticmethod
    def review_override(override_id, status, admin_comment, reviewer_id):
        """Admin approve or reject a metric override."""
        override = MetricOverride.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=override_id,
        ).first()
        if not override:
            return None, 'Override not found'
        if override.status != MetricOverrideStatus.PENDING:
            return None, 'Override already reviewed'

        try:
            override.status = MetricOverrideStatus(status)
        except ValueError:
            return None, f'Invalid status: {status}'

        override.admin_comment = admin_comment
        override.reviewed_by_id = reviewer_id
        override.reviewed_at = datetime.now(timezone.utc)
        db.session.commit()
        return override, None

    # ------------------------------------------------------------------ #
    # Execution Stage Metrics
    # ------------------------------------------------------------------ #
    @classmethod
    def get_execution_metrics(cls, doctor_id, period='day', reference_date=None, consultation_type=None):
        """Aggregate execution-stage metrics: attended, missed by doctor/patient/technical."""
        start_date, end_date = cls._date_range(period, reference_date)

        base = Appointment.query.filter(
            Appointment.tenant_id == current_tenant_id_strict(),
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.is_deleted == False,
        )
        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
                base = base.filter(Appointment.consultation_type == ct_enum)
            except (ValueError, KeyError):
                pass

        total = base.count()
        attended = base.filter(Appointment.doctor_joined == True, Appointment.patient_joined == True).count()
        missed_total = base.filter(
            (Appointment.missed_by_doctor == True) |
            (Appointment.missed_by_patient == True) |
            (Appointment.missed_technical == True)
        ).count()
        missed_by_doctor = base.filter(Appointment.missed_by_doctor == True).count()
        missed_by_patient = base.filter(Appointment.missed_by_patient == True).count()
        missed_technical = base.filter(Appointment.missed_technical == True).count()

        # Overrides
        overrides = MetricOverride.query.filter(
            MetricOverride.tenant_id == current_tenant_id_strict(),
            MetricOverride.doctor_id == doctor_id,
            MetricOverride.status == MetricOverrideStatus.APPROVED,
            MetricOverride.period_start == start_date,
            MetricOverride.period_end == end_date,
        )
        if consultation_type:
            overrides = overrides.filter(
                (MetricOverride.consultation_type == consultation_type) |
                (MetricOverride.consultation_type == None)
            )
        override_map = {o.metric_type: o.suggested_value for o in overrides.all()}

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'consultation_type': consultation_type,
            'total': total,
            'attended': override_map.get('exec_attended', attended),
            'missed_total': override_map.get('exec_missed_total', missed_total),
            'missed_by_doctor': override_map.get('exec_missed_by_doctor', missed_by_doctor),
            'missed_by_patient': override_map.get('exec_missed_by_patient', missed_by_patient),
            'missed_technical': override_map.get('exec_missed_technical', missed_technical),
            '_raw': {
                'attended': attended,
                'missed_total': missed_total,
                'missed_by_doctor': missed_by_doctor,
                'missed_by_patient': missed_by_patient,
                'missed_technical': missed_technical,
            },
            'has_overrides': len(override_map) > 0,
        }

    # ------------------------------------------------------------------ #
    # Live / Call Stage Metrics
    # ------------------------------------------------------------------ #
    @classmethod
    def get_livecall_metrics(cls, doctor_id, period='day', reference_date=None, consultation_type=None):
        """Aggregate live/call stage metrics: video/audio/chat usage by doctor."""
        start_date, end_date = cls._date_range(period, reference_date)

        base = Appointment.query.filter(
            Appointment.tenant_id == current_tenant_id_strict(),
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.is_deleted == False,
            Appointment.doctor_joined == True,  # Only count attended appointments
        )
        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
                base = base.filter(Appointment.consultation_type == ct_enum)
            except (ValueError, KeyError):
                pass

        total_attended = base.count()
        video_used = base.filter(Appointment.doctor_used_video == True).count()
        audio_used = base.filter(Appointment.doctor_used_audio == True).count()
        chat_used = base.filter(Appointment.doctor_used_chat == True).count()
        video_and_audio = base.filter(
            Appointment.doctor_used_video == True,
            Appointment.doctor_used_audio == True,
        ).count()

        overrides = MetricOverride.query.filter(
            MetricOverride.tenant_id == current_tenant_id_strict(),
            MetricOverride.doctor_id == doctor_id,
            MetricOverride.status == MetricOverrideStatus.APPROVED,
            MetricOverride.period_start == start_date,
            MetricOverride.period_end == end_date,
        )
        if consultation_type:
            overrides = overrides.filter(
                (MetricOverride.consultation_type == consultation_type) |
                (MetricOverride.consultation_type == None)
            )
        override_map = {o.metric_type: o.suggested_value for o in overrides.all()}

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'consultation_type': consultation_type,
            'total_attended': total_attended,
            'video_used': override_map.get('live_video_used', video_used),
            'audio_used': override_map.get('live_audio_used', audio_used),
            'chat_used': override_map.get('live_chat_used', chat_used),
            'video_and_audio': override_map.get('live_video_and_audio', video_and_audio),
            '_raw': {
                'video_used': video_used,
                'audio_used': audio_used,
                'chat_used': chat_used,
                'video_and_audio': video_and_audio,
            },
            'has_overrides': len(override_map) > 0,
        }

    # ------------------------------------------------------------------ #
    # Execution Stage Actions
    # ------------------------------------------------------------------ #
    @staticmethod
    def mark_doctor_joined(appointment_id, doctor_user_id):
        """Mark doctor as joined/present for appointment."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'
        appt.doctor_joined = True
        appt.doctor_joined_at = datetime.now(timezone.utc)
        db.session.commit()
        return appt, None

    @staticmethod
    def mark_patient_joined(appointment_id, patient_user_id):
        """Mark patient as joined/present for appointment."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.patient.user_id != patient_user_id:
            return None, 'Access denied'
        appt.patient_joined = True
        appt.patient_joined_at = datetime.now(timezone.utc)
        db.session.commit()
        return appt, None

    @staticmethod
    def mark_missed(appointment_id, missed_by, user_id):
        """Mark appointment as missed by doctor/patient/technical."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'

        if missed_by == 'doctor':
            appt.missed_by_doctor = True
        elif missed_by == 'patient':
            appt.missed_by_patient = True
        elif missed_by == 'technical':
            appt.missed_technical = True
        else:
            return None, 'Invalid missed_by value'

        db.session.commit()
        return appt, None

    # ------------------------------------------------------------------ #
    # Live/Call Stage Actions
    # ------------------------------------------------------------------ #
    @staticmethod
    def track_media_usage(appointment_id, doctor_user_id, media_type):
        """Track doctor's media usage during call (video/audio/chat)."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'

        if media_type == 'video':
            appt.doctor_used_video = True
        elif media_type == 'audio':
            appt.doctor_used_audio = True
        elif media_type == 'chat':
            appt.doctor_used_chat = True
        else:
            return None, f'Invalid media_type: {media_type}'

        db.session.commit()
        return appt, None

    # ------------------------------------------------------------------ #
    # Attendance Page Config
    # ------------------------------------------------------------------ #
    @staticmethod
    def get_config(doctor_id=None):
        """
        Get attendance page config.
        Returns doctor-specific config if exists, else global default (doctor_id=None).
        Both rows are tenant-scoped (TenantMixin) — ``doctor_id=None`` means
        "this tenant's global default", not "platform-wide default".
        """
        tid = current_tenant_id_strict()
        if doctor_id:
            # Try doctor-specific configs first
            doctor_configs = AttendancePageConfig.query.filter_by(
                tenant_id=tid, doctor_id=doctor_id,
            ).all()
            if doctor_configs:
                return [c.to_dict() for c in doctor_configs]

        # Fall back to this tenant's global defaults
        global_configs = AttendancePageConfig.query.filter_by(
            tenant_id=tid, doctor_id=None,
        ).all()
        return [c.to_dict() for c in global_configs]

    @staticmethod
    def update_config(section_key, config_data, doctor_id=None, user_id=None):
        """Update attendance page config (admin only)."""
        tid = current_tenant_id_strict()
        existing = AttendancePageConfig.query.filter_by(
            tenant_id=tid,
            doctor_id=doctor_id,
            section_key=section_key,
        ).first()

        if existing:
            existing.config = config_data
            existing.updated_at = datetime.now(timezone.utc)
        else:
            existing = AttendancePageConfig(
                tenant_id=tid,
                doctor_id=doctor_id,
                section_key=section_key,
                config=config_data,
                created_by_id=user_id,
            )
            db.session.add(existing)

        db.session.commit()
        return existing, None

    # ------------------------------------------------------------------ #
    # No-Response Metrics
    # ------------------------------------------------------------------ #
    @classmethod
    def get_no_response_metrics(cls, doctor_id, period='day', reference_date=None, consultation_type=None):
        """
        Aggregate no-response counts per attendance stage.

        - acceptance_no_response: doctor received appointment but never accepted/rejected/cancelled
        - execution_no_response: appointment was missed because doctor didn't join (missed_by_doctor)
        - livecall_no_response: doctor joined but was flagged as unresponsive during call
          (approximated by missed_by_doctor=True AND doctor_joined=True)
        """
        start_date, end_date = cls._date_range(period, reference_date)

        base = Appointment.query.filter(
            Appointment.tenant_id == current_tenant_id_strict(),
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_date >= start_date,
            Appointment.appointment_date <= end_date,
            Appointment.is_deleted == False,
        )

        if consultation_type:
            try:
                ct_enum = ConsultationType(consultation_type)
                base = base.filter(Appointment.consultation_type == ct_enum)
            except (ValueError, KeyError):
                pass

        # Acceptance stage: appointment received but doctor never responded
        acceptance_no_response = base.filter(
            Appointment.doctor_accepted == False,
            Appointment.doctor_rejected == False,
            Appointment.doctor_cancelled == False,
        ).count()

        # Execution stage: doctor didn't show up (missed by doctor)
        execution_no_response = base.filter(
            Appointment.missed_by_doctor == True,
        ).count()

        # Live call stage: doctor was present but patient was unresponsive/call failed
        # Using missed_by_doctor during a joined session as proxy for live unresponsiveness
        livecall_no_response = base.filter(
            Appointment.doctor_joined == True,
            Appointment.missed_by_doctor == True,
        ).count()

        # Overrides
        overrides = MetricOverride.query.filter(
            MetricOverride.tenant_id == current_tenant_id_strict(),
            MetricOverride.doctor_id == doctor_id,
            MetricOverride.status == MetricOverrideStatus.APPROVED,
            MetricOverride.period_start == start_date,
            MetricOverride.period_end == end_date,
        )
        if consultation_type:
            overrides = overrides.filter(
                (MetricOverride.consultation_type == consultation_type) |
                (MetricOverride.consultation_type == None)
            )
        override_map = {o.metric_type: o.suggested_value for o in overrides.all()}

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'consultation_type': consultation_type,
            'acceptance_no_response': override_map.get('no_resp_acceptance', acceptance_no_response),
            'execution_no_response': override_map.get('no_resp_execution', execution_no_response),
            'livecall_no_response': override_map.get('no_resp_livecall', livecall_no_response),
            '_raw': {
                'acceptance_no_response': acceptance_no_response,
                'execution_no_response': execution_no_response,
                'livecall_no_response': livecall_no_response,
            },
            'has_overrides': len(override_map) > 0,
        }

    # ------------------------------------------------------------------ #
    # Asset Library Usage
    # ------------------------------------------------------------------ #
    @staticmethod
    def log_asset_library_usage(appointment_id, doctor_user_id, asset_type, asset_url, asset_name=None):
        """Log a single asset library usage event during a consultation."""
        appt = Appointment.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=appointment_id, is_deleted=False,
        ).first()
        if not appt:
            return None, 'Appointment not found'
        if appt.doctor.user_id != doctor_user_id:
            return None, 'Access denied'

        usage = AssetLibraryUsage(
            tenant_id=appt.tenant_id,
            doctor_id=appt.doctor_id,
            appointment_id=appointment_id,
            asset_type=asset_type,
            asset_url=asset_url,
            asset_name=asset_name,
            consultation_type=appt.consultation_type.value if appt.consultation_type else None,
            used_at=datetime.now(timezone.utc),
        )
        db.session.add(usage)
        db.session.commit()
        return usage, None

    @classmethod
    def get_asset_library_usage_metrics(cls, doctor_id, period='day', reference_date=None, consultation_type=None):
        """
        Aggregate asset library usage metrics for a doctor.
        Returns total usages and a breakdown by asset_type.
        """
        start_date, end_date = cls._date_range(period, reference_date)

        tid = current_tenant_id_strict()
        base = AssetLibraryUsage.query.filter(
            AssetLibraryUsage.tenant_id == tid,
            AssetLibraryUsage.doctor_id == doctor_id,
            func.date(AssetLibraryUsage.used_at) >= start_date,
            func.date(AssetLibraryUsage.used_at) <= end_date,
        )

        if consultation_type:
            base = base.filter(AssetLibraryUsage.consultation_type == consultation_type)

        total_usages = base.count()

        # Breakdown by asset_type
        breakdown_rows = (
            db.session.query(AssetLibraryUsage.asset_type, func.count(AssetLibraryUsage.id))
            .filter(
                AssetLibraryUsage.tenant_id == tid,
                AssetLibraryUsage.doctor_id == doctor_id,
                func.date(AssetLibraryUsage.used_at) >= start_date,
                func.date(AssetLibraryUsage.used_at) <= end_date,
            )
        )
        if consultation_type:
            breakdown_rows = breakdown_rows.filter(
                AssetLibraryUsage.consultation_type == consultation_type
            )
        breakdown_rows = breakdown_rows.group_by(AssetLibraryUsage.asset_type).all()
        breakdown = {asset_type: count for asset_type, count in breakdown_rows}

        # Recent usages list (last 20)
        recent = base.order_by(AssetLibraryUsage.used_at.desc()).limit(20).all()

        return {
            'period': period,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'consultation_type': consultation_type,
            'total_usages': total_usages,
            'breakdown_by_type': breakdown,
            'recent_usages': [
                {
                    'id': str(u.id),
                    'appointment_id': str(u.appointment_id),
                    'asset_type': u.asset_type,
                    'asset_name': u.asset_name,
                    'asset_url': u.asset_url,
                    'consultation_type': u.consultation_type,
                    'used_at': u.used_at.isoformat() if u.used_at else None,
                }
                for u in recent
            ],
        }
