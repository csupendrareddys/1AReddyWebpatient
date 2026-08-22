"""Seed the global plan-type reference data.

``vertical_plan_types`` powers the public marketplace ``/join`` picker
(``GET /api/public/vertical-plan-types``) and ``saas_plan_types`` powers
the SaaS-subscription verticals. Both are global (not tenant-scoped) and
are normally authored by the Platform Owner through the admin CRUD; this
script re-creates the standard set on a freshly-rebuilt local DB.

Idempotent: each row is guarded by a ``code`` lookup, so re-running is safe.

USAGE
-----
    docker compose exec backend python scripts/seed_plan_types.py
"""
import os
import sys

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from app import create_app
from app.extensions import db
from app.models.membership import VerticalPlanType
from app.models.plan import SAASPlanType

# (code, name, description, icon_key, is_receiver, sort_order)
VERTICALS = [
    ('doctor',   'Doctor',   'Solo practitioners and consultants',        'stethoscope', False, 10),
    ('clinic',   'Clinic',   'Multi-doctor clinics and polyclinics',      'clinic',      False, 20),
    ('hospital', 'Hospital', 'Hospitals and multi-speciality centres',    'hospital',    False, 30),
    ('patient',  'Patient',  'Individuals and corporates seeking care',   'person',      True,  40),
]

# SaaS plan types mirror the provider verticals (buy your own subdomain).
SAAS_TYPES = [
    ('doctor',   'Doctor',   'Run your own practice on a subdomain',      'stethoscope', False),
    ('clinic',   'Clinic',   'Run your clinic on a subdomain',            'clinic',      False),
    ('hospital', 'Hospital', 'Run your hospital on a subdomain',          'hospital',    False),
]


def main():
    app = create_app()
    with app.app_context():
        # ``vertical_plan_types`` is tenant-scoped — every tenant needs its
        # own set, since these rows drive that tenant's /join persona tabs
        # and are the FK target of its membership plans. Seed per tenant,
        # idempotent on (tenant_id, code).
        from app.models import Tenant
        tenants = Tenant.query.filter_by(is_deleted=False).all()
        created_v = skipped_v = 0
        for tenant in tenants:
            for code, name, desc, icon, is_recv, order in VERTICALS:
                if VerticalPlanType.query.filter_by(
                    tenant_id=tenant.id, code=code,
                ).first():
                    skipped_v += 1
                    continue
                db.session.add(VerticalPlanType(
                    tenant_id=tenant.id,
                    code=code, name=name, description=desc, icon_key=icon,
                    is_receiver=is_recv, sort_order=order,
                ))
                created_v += 1

        created_s = skipped_s = 0
        for code, name, desc, icon, is_recv in SAAS_TYPES:
            if SAASPlanType.query.filter_by(code=code).first():
                skipped_s += 1
                continue
            db.session.add(SAASPlanType(
                code=code, name=name, description=desc, icon_key=icon,
                is_receiver=is_recv,
            ))
            created_s += 1

        db.session.commit()
        print(f'[OK] vertical_plan_types: created={created_v} skipped={skipped_v}')
        print(f'[OK] saas_plan_types    : created={created_s} skipped={skipped_s}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
