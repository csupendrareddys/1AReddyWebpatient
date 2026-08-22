"""Seed demo doctors so the public booking widget renders.

Idempotent: re-running this script does not duplicate rows. Designed for
dev / staging / preview environments where you want the public landing
page's booking section to actually show consultation-type cards backed
by real `Category` + `Doctor` rows.

Seeds (under the platform tenant — ``is_default=True``):

  * 4 ``Category`` rows (Cardiology, Neurology, Dermatology, General
    Medicine) with ``category_type='specialization'``.
  * 5 platform doctors. Each has a ``User`` row + a ``Doctor`` profile
    with a ``consultation_fee`` set + a primary specialization linking
    to one of the four categories.
  * Per-doctor TimeSlot rows for the next 14 days (3 slots/day, 30
    minutes each, alternating VIDEO + AUDIO consultation types).

Usage::

    docker run … --entrypoint python <image> scripts/seed_demo_doctors.py

Or locally with the venv active::

    python scripts/seed_demo_doctors.py

Deletion: this script never deletes; if you need to wipe the demo data
do it manually via psql (rows are easy to spot — the demo emails follow
the ``demo-doctor-N@platform.larazen.in`` pattern).
"""
import logging
import os
import sys
from datetime import date, datetime, time, timedelta
from decimal import Decimal

# When run as ``python scripts/seed_demo_doctors.py`` the script's own
# directory is on sys.path but the parent (which contains ``app/``) is
# not. Same shim every other ``scripts/*`` file uses.
_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from werkzeug.security import generate_password_hash

logging.basicConfig(level=logging.INFO, format='%(asctime)s [seed] %(message)s')
log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Seed data — kept declarative so it's easy to scan / extend.
# --------------------------------------------------------------------------- #

DEMO_CATEGORIES = [
    {'name': 'Cardiology',         'description': 'Heart and cardiovascular care.'},
    {'name': 'Neurology',          'description': 'Brain, spine and nervous system.'},
    {'name': 'Dermatology',        'description': 'Skin, hair and nail conditions.'},
    {'name': 'General Medicine',   'description': 'Everyday health concerns and check-ups.'},
]

# Each demo doctor: User name + the category name they primarily practice.
# Phone numbers + emails follow a predictable pattern so the seeder can
# look them up on re-run and skip duplicates.
DEMO_DOCTORS = [
    {
        'first_name': 'Asha',     'last_name': 'Reddy',
        'specialization': 'Cardiology',     'experience_years': 12,
        'consultation_fee': 800,
    },
    {
        'first_name': 'Vikram',   'last_name': 'Iyer',
        'specialization': 'Neurology',      'experience_years': 18,
        'consultation_fee': 1200,
    },
    {
        'first_name': 'Priya',    'last_name': 'Menon',
        'specialization': 'Dermatology',    'experience_years': 7,
        'consultation_fee': 600,
    },
    {
        'first_name': 'Rohan',    'last_name': 'Khan',
        'specialization': 'General Medicine', 'experience_years': 5,
        'consultation_fee': 400,
    },
    {
        'first_name': 'Meera',    'last_name': 'Nair',
        'specialization': 'Cardiology',     'experience_years': 9,
        'consultation_fee': 750,
    },
]


def _demo_phone(idx):
    """Predictable phone for the Nth demo doctor."""
    return f'97000{99000 + idx:05d}'  # 9700099000 .. 9700099005


def _demo_email(idx):
    return f'demo-doctor-{idx}@platform.larazen.in'


# --------------------------------------------------------------------------- #
# Seed runner
# --------------------------------------------------------------------------- #

def main() -> int:
    from app import create_app
    from app.extensions import db
    from flask import g
    from app.models import (
        Tenant, User, Doctor, Category,
        DoctorQualificationSpecialization,
        TimeSlot, TimeSlotType,
        UserRole, UserStatus, ConsultationType,
        AvailabilityApprovalStatus, PublishStatus,
    )

    app = create_app()
    with app.app_context():
        from app.models import TenantStatus
        platform = Tenant.query.filter_by(is_default=True, is_deleted=False).first()
        if not platform:
            # Fresh DB — bootstrap the platform tenant ourselves so the
            # seeder can stand on its own without requiring a separate
            # ``create_platform_owner.py`` step first. Idempotent on
            # re-run (the ``filter_by(is_default=True)`` guard above
            # picks up the existing row).
            platform = Tenant(
                name='Platform',
                slug='platform',
                is_default=True,
                status=TenantStatus.ACTIVE,
            )
            db.session.add(platform)
            db.session.commit()
            log.info('  + Bootstrapped platform tenant (slug=platform, is_default=True)')

        # Many service helpers + RLS read tenant from ``g.tenant_id`` /
        # ``app.current_tenant_id`` — set both before writing rows.
        g.tenant_id = platform.id
        from app.models._base import set_tenant_context
        set_tenant_context(db.session, platform.id)

        log.info('Seeding under platform tenant %s (slug=%s)', platform.id, platform.slug)

        # ── 1. Categories ──────────────────────────────────────────── #
        categories_by_name = {}
        for spec in DEMO_CATEGORIES:
            cat = Category.query.filter_by(
                tenant_id=platform.id, name=spec['name'],
            ).first()
            if not cat:
                cat = Category(
                    tenant_id=platform.id,
                    name=spec['name'],
                    description=spec['description'],
                    category_type='specialization',
                    is_active=True,
                )
                db.session.add(cat)
                db.session.flush()
                log.info('  + Category: %s', cat.name)
            else:
                log.info('  · Category exists: %s', cat.name)
            categories_by_name[cat.name] = cat
        db.session.commit()

        # ── 2. Doctors + Users + Specializations ───────────────────── #
        from app.common.encryption import hash_for_search

        for idx, spec in enumerate(DEMO_DOCTORS, start=1):
            phone = _demo_phone(idx)
            email = _demo_email(idx)
            phone_hash = hash_for_search(phone)

            # Lookup by phone hash — the unique key on the users table.
            user = User.query.filter_by(
                tenant_id=platform.id, _phone_hash=phone_hash, is_deleted=False,
            ).first()
            if not user:
                user = User(
                    tenant_id=platform.id,
                    role=UserRole.DOCTOR,
                    status=UserStatus.ACTIVE,
                    first_name=spec['first_name'],
                    last_name=spec['last_name'],
                    state='Karnataka',
                    password_hash=generate_password_hash('Demo@1234'),
                    email_verified=True,
                )
                user.email = email           # encryption + hash via property
                user.phone_number = phone
                db.session.add(user)
                db.session.flush()
                log.info('  + User: %s %s (phone=%s)',
                         user.first_name, user.last_name, phone)
            else:
                log.info('  · User exists: %s %s', user.first_name, user.last_name)

            # Doctor profile — keyed by user_id.
            doctor = Doctor.query.filter_by(
                tenant_id=platform.id, user_id=user.id,
            ).first()
            if not doctor:
                doctor = Doctor(
                    tenant_id=platform.id,
                    user_id=user.id,
                    aadhar_number=f'demo-aadhar-{idx:04d}',
                    aadhar_attachment='seed/placeholder.pdf',
                    registration_number=f'DEMO-REG-{idx:04d}',
                    registration_certificate='seed/placeholder.pdf',
                    consultation_fee=Decimal(spec['consultation_fee']),
                    experience_years=spec['experience_years'],
                    availability_approval_status=AvailabilityApprovalStatus.APPROVED,
                    publish_status=PublishStatus.ACTIVE,
                    is_live=True,
                )
                db.session.add(doctor)
                db.session.flush()
                log.info('    + Doctor profile (fee=₹%s, experience=%s yrs)',
                         spec['consultation_fee'], spec['experience_years'])
            else:
                log.info('    · Doctor profile exists')

            # Primary specialization — keyed by (doctor_id, category_id).
            cat = categories_by_name[spec['specialization']]
            link = DoctorQualificationSpecialization.query.filter_by(
                tenant_id=platform.id, doctor_id=doctor.id, category_id=cat.id,
            ).first()
            if not link:
                link = DoctorQualificationSpecialization(
                    tenant_id=platform.id,
                    doctor_id=doctor.id,
                    category_id=cat.id,
                    is_primary=True,
                )
                db.session.add(link)
                log.info('    + Specialization: %s (primary)', cat.name)

            db.session.commit()

            # ── 3. TimeSlots for the next 14 days ──────────────────── #
            # 3 slots/day at 10:00 / 11:00 / 14:00, 30 min each. Alternate
            # VIDEO and AUDIO so the public catalog has both consultation
            # types represented.
            today = date.today()
            slot_starts = [time(10, 0), time(11, 0), time(14, 0)]
            for d_offset in range(14):
                slot_date = today + timedelta(days=d_offset)
                for s_idx, start in enumerate(slot_starts):
                    end_dt = datetime.combine(slot_date, start) + timedelta(minutes=30)
                    end = end_dt.time()

                    existing = TimeSlot.query.filter_by(
                        tenant_id=platform.id, doctor_id=doctor.id,
                        date=slot_date, start_time=start,
                    ).first()
                    if existing:
                        continue

                    slot = TimeSlot(
                        tenant_id=platform.id,
                        doctor_id=doctor.id,
                        date=slot_date,
                        start_time=start,
                        end_time=end,
                        is_booked=False,
                    )
                    db.session.add(slot)
                    db.session.flush()

                    # Two consultation types per slot — VIDEO always, plus
                    # AUDIO on every other slot. Keeps the public listing
                    # interesting without spending excessive seed time.
                    types_for_slot = [ConsultationType.VIDEO]
                    if s_idx % 2 == 0:
                        types_for_slot.append(ConsultationType.AUDIO)
                    for ct in types_for_slot:
                        db.session.add(TimeSlotType(
                            tenant_id=platform.id,
                            time_slot_id=slot.id,
                            consultation_type=ct,
                        ))
            db.session.commit()
            log.info('    + Timeslots seeded for next 14 days')

        log.info('Seed complete — %s doctors across %s categories.',
                 len(DEMO_DOCTORS), len(DEMO_CATEGORIES))
    return 0


if __name__ == '__main__':
    sys.exit(main())
