"""Seed the public-booking demo so the landing "Book a slot" widget renders.

Why the widget is hidden by default: ``LandingBookingSection`` hides itself
when ``/api/public/booking/specializations`` returns ``[]``, which happens
when no tenant doctor has a *primary* specialization pointing at a
``Category``. The bundled ``seed_demo_doctors.py`` is unrunnable — it imports
``DoctorQualificationSpecialization`` which was pruned — so this replaces it
using the CURRENT models the booking service actually reads:
``ProfileOwner`` + ``ProfileEducationSpecialization`` + ``TimeSlot``/``TimeSlotType``.

Seeds under the platform / default tenant (``is_default=True`` — the apex on
localhost). Idempotent: re-running does not duplicate rows.

  * 4 Category rows (category_type='specialization').
  * Reuses the first 5 real DOCTOR-role platform doctors — sets a
    ``consultation_fee``, a ProfileOwner, and a primary specialization.
  * 14 days × 3 slots/day per doctor, each bookable as VIDEO **and** AUDIO.

USAGE
-----
    docker compose exec backend python scripts/seed_public_booking_demo.py
"""
import os
import sys
from datetime import date, time, timedelta

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from flask import g

from app import create_app
from app.extensions import db
from app.models._base import set_tenant_context
from app.models import (
    Tenant, User, Doctor, Category, ConsultationType, UserRole,
    TimeSlot, TimeSlotType,
)
from app.models.profile_shared import ProfileOwner, ProfileEducationSpecialization

CATEGORIES = ['Cardiology', 'Neurology', 'Dermatology', 'General Medicine']
FEES = [800, 1200, 600, 400, 750]
# Three 30-min slots per day.
SLOT_STARTS = [time(9, 0), time(9, 30), time(10, 0)]
DAYS_AHEAD = 14


def main():
    app = create_app()
    with app.app_context():
        platform = Tenant.query.filter_by(is_default=True, is_deleted=False).first()
        if not platform:
            print('[ERR] no default tenant — run scripts/bootstrap_local.py first')
            return 1
        g.tenant_id = platform.id
        set_tenant_context(db.session, platform.id)
        tid = platform.id
        print(f'Seeding public-booking demo under tenant {platform.slug} ({tid})')

        # 1. Categories -----------------------------------------------------
        cats = []
        for name in CATEGORIES:
            cat = Category.query.filter_by(tenant_id=tid, name=name).first()
            if not cat:
                cat = Category(tenant_id=tid, name=name, category_type='specialization')
                db.session.add(cat)
                db.session.flush()
                print(f'  + Category: {name}')
            cats.append(cat)

        # 2. Pick 5 real DOCTOR-role platform doctors -----------------------
        doctors = (
            Doctor.query.join(User, Doctor.user_id == User.id)
            .filter(
                Doctor.tenant_id == tid,
                Doctor.is_deleted.is_(False),
                User.is_deleted.is_(False),
                User.role == UserRole.DOCTOR,
            )
            .order_by(Doctor.created_at.asc())
            .limit(5)
            .all()
        )
        if not doctors:
            print('[ERR] no DOCTOR-role doctors on the platform tenant — '
                  'run scripts/seed_platform_users.py first')
            return 1

        for i, doc in enumerate(doctors):
            cat = cats[i % len(cats)]

            # 2a. consultation_fee
            if doc.consultation_fee is None:
                doc.consultation_fee = FEES[i % len(FEES)]

            # 2b. ProfileOwner (owner_type='doctor')
            owner = ProfileOwner.query.filter_by(
                tenant_id=tid, owner_type='doctor', doctor_id=doc.id,
            ).first()
            if not owner:
                owner = ProfileOwner(
                    tenant_id=tid, owner_type='doctor', doctor_id=doc.id,
                )
                db.session.add(owner)
                db.session.flush()

            # 2c. primary specialization
            spec = ProfileEducationSpecialization.query.filter_by(
                tenant_id=tid, profile_owner_id=owner.id, category_id=cat.id,
            ).first()
            if not spec:
                spec = ProfileEducationSpecialization(
                    tenant_id=tid, profile_owner_id=owner.id, doctor_id=doc.id,
                    category_id=cat.id, is_primary=True,
                )
                db.session.add(spec)

            # 2d. slots (14 days × 3), each bookable VIDEO + AUDIO
            slots_added = 0
            for d in range(DAYS_AHEAD):
                slot_date = date.today() + timedelta(days=d)
                for start in SLOT_STARTS:
                    end = time((start.hour + (1 if start.minute == 30 else 0)) % 24,
                               (start.minute + 30) % 60)
                    existing = TimeSlot.query.filter_by(
                        tenant_id=tid, doctor_id=doc.id, date=slot_date,
                        start_time=start,
                    ).first()
                    if existing:
                        continue
                    slot = TimeSlot(
                        tenant_id=tid, doctor_id=doc.id, date=slot_date,
                        start_time=start, end_time=end, is_booked=False,
                    )
                    db.session.add(slot)
                    db.session.flush()
                    for ct in (ConsultationType.VIDEO, ConsultationType.AUDIO):
                        db.session.add(TimeSlotType(
                            tenant_id=tid, time_slot_id=slot.id, consultation_type=ct,
                        ))
                    slots_added += 1
            uname = doc.user.first_name if doc.user else '?'
            print(f'  + Doctor {uname}: fee={doc.consultation_fee} '
                  f'spec={cat.name} slots+={slots_added}')

        db.session.commit()
        print('[OK] public-booking demo seeded.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
