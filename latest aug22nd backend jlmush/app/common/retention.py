"""Retention-expiry purge — completing DPDP erasure once the law lets go.

When an account is deleted we keep the clinical/financial records ONLY
because retention statutes require it (NMC/MCI Code of Ethics reg. 1.3;
Companies Act 2013 s.128(5); CGST Act s.36; Income-tax rules). DPDP Act
2023's storage-limitation principle (s.8(7)) says that once that legal
basis lapses, the erasure must complete. This module is that completion.

Scope (v1) — deliberately narrow and conservative:

  * Only PATIENT accounts that went through ``delete_account`` (i.e. have
    an ``AccountDeletionRecord`` not yet stamped ``purged_at``). Records
    of live accounts are retained under the ongoing service relationship
    and are never touched.
  * Clinical purge: the patient's appointments, prescriptions and health
    records are irreversibly soft-deleted, the profile's residual
    personal fields (emergency contacts, alternative phone/email,
    PAN/Aadhaar, address, insurance, caste/religion/citizenship,
    female-health details, organisation block) are nulled, and the
    statutory identity seal is destroyed — after this the person is
    genuinely unidentifiable.
  * Deleted DOCTOR accounts are NOT purged here: a doctor's appointments
    belong to their PATIENTS' records and run on the patients' clocks.
    The doctor's identity seal must outlive every patient record that
    names them.
  * Financial rows (payments / payouts / bills) are NOT touched: their
    Companies Act / GST clocks are anchored to financial years, they
    carry gateway identifiers rather than contact PII, and destruction
    of books is an archival decision to take deliberately, not in a
    sweep.
  * The deletion register itself is permanent — purge STAMPS it
    (``purged_at`` + ``purge_note``), never removes it.

Clock: latest clinical activity (appointment date / prescription /
health record, falling back to the deletion date) + RETENTION_CLINICAL_YEARS
(default 8 — comfortably past the NMC 3-year minimum and aligned with the
8-year financial ceiling). If the sealed identity carries a DOB and the
person was a minor at their last record, the clock cannot end before
majority (18) + 3 further years, per the limitation-period convention
for minors' medico-legal claims.
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

from app.extensions import db

logger = logging.getLogger(__name__)


def _years(env_name, default):
    try:
        return int(os.environ.get(env_name, default))
    except (TypeError, ValueError):
        return default


def clinical_retention_years():
    return _years('RETENTION_CLINICAL_YEARS', 8)


MINOR_MAJORITY_AGE = 18
MINOR_EXTRA_YEARS = 3


def _add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # Feb 29 → Feb 28
        return d.replace(year=d.year + years, day=28)


def _clinical_deadline(record, patient, *, years: int) -> date:
    """The first day this patient's clinical set may be purged."""
    from app.models import Appointment, HealthRecord
    from app.models.prescription import Prescription

    anchors = [record.performed_at.date()]
    last_appt = (
        db.session.query(db.func.max(Appointment.appointment_date))
        .filter(Appointment.patient_id == patient.id)
        .scalar()
    )
    if last_appt:
        anchors.append(last_appt)
    for model in (Prescription, HealthRecord):
        last = (
            db.session.query(db.func.max(model.created_at))
            .filter(model.patient_id == patient.id)
            .scalar()
        )
        if last:
            anchors.append(last.date())

    deadline = _add_years(max(anchors), years)

    # Minor extension: a record made while the person was under majority
    # must survive until majority + limitation years.
    dob_iso = (record.identity_snapshot or {}).get('dob')
    if dob_iso:
        try:
            dob = date.fromisoformat(dob_iso)
            minor_deadline = _add_years(
                dob, MINOR_MAJORITY_AGE + MINOR_EXTRA_YEARS)
            if minor_deadline > deadline and max(anchors) < _add_years(
                    dob, MINOR_MAJORITY_AGE):
                deadline = minor_deadline
        except ValueError:
            pass
    return deadline


_PATIENT_PII_FIELDS = (
    'emergency_contact_name', 'emergency_contact_phone',
    'emergency_contact_relation', 'alternative_phone', 'alternative_email',
    'pan_number', 'aadhar_number', 'address_details',
    'insurance_provider', 'insurance_policy_number',
    'caste', 'religion', 'citizenship',
    'female_health_details', 'organization_details',
)


def purge_expired(*, apply=False, only_tenant_id=None, years=None,
                  now=None) -> dict:
    """One reconciliation pass. Dry-run unless ``apply=True``.

    ``years`` overrides the clinical retention window — for rehearsals
    and tests only; production runs take the configured default.
    """
    from app.common.tenant_context import with_tenant_context
    from app.models import (
        AccountDeletionRecord, Appointment, HealthRecord, Patient, User,
    )
    from app.models.prescription import Prescription

    years = clinical_retention_years() if years is None else years
    today = (now or datetime.now(timezone.utc)).date()
    stats = {'checked': 0, 'due': 0, 'purged_users': 0,
             'appointments': 0, 'prescriptions': 0, 'health_records': 0,
             'pending': 0, 'skipped_non_patient': 0}

    query = AccountDeletionRecord.query.filter(
        AccountDeletionRecord.purged_at.is_(None))
    if only_tenant_id:
        query = query.filter_by(tenant_id=only_tenant_id)

    for record in query.all():
        stats['checked'] += 1
        if record.role != 'patient':
            # Doctors/staff/admins: see module docstring — their identity
            # seals outlive the patient records that reference them.
            stats['skipped_non_patient'] += 1
            continue

        with with_tenant_context(record.tenant_id):
            user = db.session.get(User, record.user_id) if record.user_id else None
            patient = (
                Patient.query.filter_by(user_id=user.id).first()
                if user is not None else None
            )
            if patient is None:
                # Nothing clinical ever existed — complete trivially.
                stats['due'] += 1
                if apply:
                    record.purged_at = datetime.now(timezone.utc)
                    record.purge_note = 'no clinical records existed'
                    stats['purged_users'] += 1
                continue

            deadline = _clinical_deadline(record, patient, years=years)
            if today < deadline:
                stats['pending'] += 1
                logger.info('[RETENTION] user=%s not due until %s',
                            record.user_id, deadline)
                continue

            stats['due'] += 1
            n_appt = Appointment.query.filter(
                Appointment.patient_id == patient.id,
                Appointment.is_deleted == False,  # noqa: E712
            ).count()
            n_rx = Prescription.query.filter(
                Prescription.patient_id == patient.id,
                Prescription.is_deleted == False,  # noqa: E712
            ).count()
            n_hr = HealthRecord.query.filter(
                HealthRecord.patient_id == patient.id,
                HealthRecord.is_deleted == False,  # noqa: E712
            ).count()
            stats['appointments'] += n_appt
            stats['prescriptions'] += n_rx
            stats['health_records'] += n_hr

            if not apply:
                logger.info('[RETENTION] DRY-RUN would purge user=%s '
                            '(appts=%s rx=%s hr=%s)',
                            record.user_id, n_appt, n_rx, n_hr)
                continue

            purge_ts = datetime.now(timezone.utc)
            for model in (Appointment, Prescription, HealthRecord):
                model.query.filter(
                    model.patient_id == patient.id,
                    model.is_deleted == False,  # noqa: E712
                ).update({'is_deleted': True}, synchronize_session=False)
            for field in _PATIENT_PII_FIELDS:
                if hasattr(patient, field):
                    setattr(patient, field, None)
            # Destroy the statutory identity seal — the retention window
            # that justified keeping it has lapsed.
            patient.record_identity = {
                'purged': True, 'purged_at': purge_ts.isoformat(),
            }
            record.purged_at = purge_ts
            record.purge_note = (
                f'clinical purge: appointments={n_appt} '
                f'prescriptions={n_rx} health_records={n_hr}; '
                f'profile PII nulled; identity seal destroyed '
                f'(window={years}y)'
            )
            stats['purged_users'] += 1
            logger.info('[RETENTION] ✓ purged user=%s (%s)',
                        record.user_id, record.purge_note)

    if apply:
        db.session.commit()
    return stats


# --------------------------------------------------------------------------- #
# Scheduler entrypoint (APScheduler job — see app/__init__._start_scheduler)
# --------------------------------------------------------------------------- #

def run_scheduled_purge(app):
    """Monthly retention-expiry purge, APPLIED. The scheduled run must
    actually complete erasure — dry-run is for the operator script. Every
    action taken is stamped onto the deletion register, so the sweep's
    work stays fully auditable."""
    with app.app_context():
        try:
            stats = purge_expired(apply=True)
            logger.info('[SCHED] retention purge applied: %s', stats)
        except Exception:  # noqa: BLE001 — must not kill the scheduler
            logger.exception('[SCHED] retention purge failed')
