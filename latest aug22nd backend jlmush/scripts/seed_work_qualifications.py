"""Seed work-qualification categories + assign them (multi) to demo doctors.

Phase 2 of the public-booking work: the booking widget now groups/filters
by WORK QUALIFICATION (``ProfileWorkQualification``) instead of education
specialization. This creates a few work-qualification ``Category`` rows and
tags the 5 demo doctors — some with two, to exercise the multi case.

Idempotent. Run AFTER scripts/seed_public_booking_demo.py.

    docker compose exec backend python scripts/seed_work_qualifications.py
"""
import os
import sys

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from flask import g

from app import create_app
from app.extensions import db
from app.models._base import set_tenant_context
from app.models import Tenant, User, Doctor, Category, UserRole
from app.models.profile_shared import ProfileOwner, ProfileWorkQualification
from app.models.catalog import CATEGORY_TYPE_WORK_QUALIFICATION

WORK_QUALS = ['Consultant', 'Surgeon', 'General Physician', 'Senior Resident']

# doctor index (0-based) -> list of work-qual names (first = primary)
ASSIGN = {
    0: ['Consultant', 'Surgeon'],       # Doctor01 — multi
    1: ['General Physician'],            # Doctor02
    2: ['Consultant'],                   # Doctor03
    3: ['Senior Resident', 'Consultant'],# Doctor04 — multi
    4: ['Surgeon'],                      # Doctor05
}


def main():
    app = create_app()
    with app.app_context():
        platform = Tenant.query.filter_by(is_default=True, is_deleted=False).first()
        if not platform:
            print('[ERR] no default tenant')
            return 1
        g.tenant_id = platform.id
        set_tenant_context(db.session, platform.id)
        tid = platform.id

        # 1. work-qualification categories
        cats = {}
        for name in WORK_QUALS:
            cat = Category.query.filter_by(
                tenant_id=tid, name=name,
                category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
            ).first()
            if not cat:
                cat = Category(
                    tenant_id=tid, name=name,
                    category_type=CATEGORY_TYPE_WORK_QUALIFICATION,
                    is_active=True,
                )
                db.session.add(cat)
                db.session.flush()
                print(f'  + Work qualification: {name}')
            cats[name] = cat

        # 2. assign to the 5 demo doctors
        doctors = (
            Doctor.query.join(User, Doctor.user_id == User.id)
            .filter(
                Doctor.tenant_id == tid, Doctor.is_deleted.is_(False),
                User.is_deleted.is_(False), User.role == UserRole.DOCTOR,
            )
            .order_by(Doctor.created_at.asc())
            .limit(5)
            .all()
        )
        for i, doc in enumerate(doctors):
            owner = ProfileOwner.query.filter_by(
                tenant_id=tid, owner_type='doctor', doctor_id=doc.id,
            ).first()
            if not owner:
                owner = ProfileOwner(tenant_id=tid, owner_type='doctor', doctor_id=doc.id)
                db.session.add(owner)
                db.session.flush()

            names = ASSIGN.get(i, [])
            added = []
            for j, name in enumerate(names):
                cat = cats[name]
                existing = ProfileWorkQualification.query.filter_by(
                    tenant_id=tid, profile_owner_id=owner.id, category_id=cat.id,
                ).first()
                if existing:
                    continue
                db.session.add(ProfileWorkQualification(
                    tenant_id=tid, profile_owner_id=owner.id, doctor_id=doc.id,
                    category_id=cat.id, is_primary=(j == 0),
                ))
                added.append(name)
            uname = doc.user.first_name if doc.user else '?'
            print(f'  + {uname}: work_quals={names} (added {added})')

        db.session.commit()
        print('[OK] work qualifications seeded.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
