"""Seed three provider staff members WITH LOGINS on the default tenant.

Why this exists
---------------
``ProviderStaff`` rows can be created from Operations and from a provider's own
My Link, but neither surface is a convenient way to get a *signed-in* staff
member on a dev database: you need a staff row, a login on it, a role assigned,
and that role has to actually grant something — otherwise the staff dashboard
authenticates fine and then renders nothing, which is indistinguishable from a
broken permission read.

So this seeds the whole chain, one staff member per vertical:

    City Care Clinic LLP   Asha Menon   front desk      Front Desk
    <first hospital>       Vikram Rao   administrator   Hospital Administrator
    Dr Doctor20            Neha Iyer    assistant       Assistant

Roles are the tenant-wide ones the admin curates (``ensure_defaults`` seeds
them empty on purpose — nobody should ship a guess about what a receptionist
may touch). This script fills in a handful of grants on them so the dashboard
has rows; it only ever writes the module keys named below, so an admin's own
grants on other modules survive a re-run.

Idempotent: staff are matched by login email, grants by (role, module), role
assignments by (staff, role). Re-running updates in place.

Usage (inside the backend container):

    docker compose exec backend python scripts/seed_provider_staff_demo.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import g  # noqa: E402

from app import create_app  # noqa: E402
from app.api.admin.provider_rbac import module_catalog  # noqa: E402
from app.api.admin.provider_rbac.service import (  # noqa: E402
    ProviderRoleService, ProviderStaffService,
)
from app.common.staff_credentials import ensure_staff_user  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    Clinic, DataRange, Doctor, Hospital, ProviderRole, ProviderRolePermission,
    ProviderStaff, StaffProviderType, Tenant, User,
)
from app.models._base import set_tenant_context  # noqa: E402

PASSWORD = 'Staff@1234'

# Preferred practice per vertical, by name. Each falls back to the oldest row of
# that vertical so the script still works on a database seeded differently.
CLINIC_NAME = 'City Care Clinic LLP'
DOCTOR_FIRST_NAME = 'Doctor20'

VIEW = {'can_view': True}
VIEW_EDIT = {'can_view': True, 'can_edit': True, 'can_update': True}
MANAGE = {'can_view': True, 'can_create': True, 'can_edit': True,
          'can_update': True}

# What each seeded role may reach. Keys are validated against the catalog
# before anything is written — a path that stopped being a leaf should fail
# the run loudly rather than land as a grant nothing will ever match.
STAFF = [
    {
        'provider_type': StaffProviderType.CLINIC,
        'role': 'Front Desk',
        'staff': {
            'first_name': 'Asha', 'last_name': 'Menon',
            'designation': 'Front Desk Executive',
            'employee_code': 'CC-FD-01',
            'email': 'asha.frontdesk@seed.test',
        },
        # Reception: see who's on the roster, see the dashboard. Nothing that
        # writes — the point of the fixture is a genuinely narrow role.
        'grants': {
            'overview.dashboard': VIEW,
            'doctors_network.manage_doctors.roster': VIEW,
        },
    },
    {
        'provider_type': StaffProviderType.HOSPITAL,
        'role': 'Hospital Administrator',
        'staff': {
            'first_name': 'Vikram', 'last_name': 'Rao',
            'designation': 'Hospital Administrator',
            'employee_code': 'HOSP-ADM-01',
            'email': 'vikram.admin@seed.test',
        },
        # Runs the place on the owner's behalf, so this one is broad enough to
        # show a populated sidebar rather than a single link.
        'grants': {
            'overview.dashboard': VIEW,
            'doctors_network.manage_doctors.roster': MANAGE,
            'doctors_network.manage_doctors.invitations': MANAGE,
            'doctors_network.network_requests': VIEW_EDIT,
            'billing.bills.invoices': VIEW,
            'staff.staff_directory': MANAGE,
            'entity_profile.entity_details.registration_licence': VIEW,
        },
    },
    {
        'provider_type': StaffProviderType.DOCTOR,
        'role': 'Assistant',
        'staff': {
            'first_name': 'Neha', 'last_name': 'Iyer',
            'designation': 'Doctor Assistant',
            'employee_code': 'DR20-ASST-01',
            'email': 'neha.assistant@seed.test',
        },
        # Manages the calendar: read and reschedule appointments, plus the
        # dashboard they land on.
        'grants': {
            'practice.dashboard': VIEW,
            'appointments.my_appointments.consultations': VIEW_EDIT,
        },
    },
]


def _require(value, what):
    if value is None:
        raise SystemExit(f'seed aborted — no {what} on this database')
    return value


def _resolve_provider(tenant_id, provider_type):
    """The practice each staff member is anchored to."""
    if provider_type is StaffProviderType.CLINIC:
        base = Clinic.query.filter_by(tenant_id=tenant_id, is_deleted=False)
        return _require(
            base.filter(Clinic.name == CLINIC_NAME).first()
            or base.order_by(Clinic.created_at).first(),
            'clinic',
        )
    if provider_type is StaffProviderType.HOSPITAL:
        return _require(
            Hospital.query.filter_by(tenant_id=tenant_id, is_deleted=False)
            .order_by(Hospital.created_at).first(),
            'hospital',
        )
    base = (
        Doctor.query.join(User, User.id == Doctor.user_id)
        .filter(Doctor.tenant_id == tenant_id, Doctor.is_deleted == False)  # noqa: E712
    )
    return _require(
        base.filter(User.first_name == DOCTOR_FIRST_NAME).first()
        or base.order_by(Doctor.created_at).first(),
        'doctor',
    )


def _provider_label(provider):
    """Display name — a doctor's lives on their User, a facility's on the row."""
    name = getattr(provider, 'name', None)
    if name:
        return name
    user = getattr(provider, 'user', None)
    return ' '.join(p for p in (user.first_name, user.last_name) if p) if user else '?'


def _resolve_role(tenant_id, provider_type, name):
    """The tenant-wide role of that name, seeding the vertical's defaults first.

    ``ensure_defaults`` is a no-op once the vertical has any role at all, so a
    tenant where an admin deleted the one we want still has to fail loudly —
    silently creating it here would put a role in the picker that no admin
    authored.
    """
    ProviderRoleService.ensure_defaults(tenant_id, provider_type)
    return _require(
        ProviderRole.query.filter(
            ProviderRole.tenant_id == tenant_id,
            ProviderRole.provider_type == provider_type,
            ProviderRole.name == name,
            ProviderRole.owner_doctor_id.is_(None),
            ProviderRole.owner_clinic_id.is_(None),
            ProviderRole.owner_hospital_id.is_(None),
            ProviderRole.is_deleted == False,  # noqa: E712
        ).first(),
        f'tenant-wide {provider_type.value} role "{name}"',
    )


def _apply_grants(role, grants):
    """Upsert one row per granted module. Modules not named here are left as
    the admin set them."""
    leaves = module_catalog.leaf_keys(role.provider_type.value)
    unknown = sorted(set(grants) - leaves)
    if unknown:
        raise SystemExit(
            f'seed aborted — not leaves of the {role.provider_type.value} '
            f'catalog: {", ".join(unknown)}'
        )
    for module_key, verbs in grants.items():
        perm = ProviderRolePermission.query.filter_by(
            role_id=role.id, module_key=module_key,
        ).first()
        if perm is None:
            perm = ProviderRolePermission(
                tenant_id=role.tenant_id, role_id=role.id, module_key=module_key,
            )
            db.session.add(perm)
        for verb, value in verbs.items():
            setattr(perm, verb, value)
        perm.data_range = DataRange.ALL
    db.session.commit()


def _upsert_staff(tenant_id, provider_type, provider, spec):
    """The staff row, keyed on the login email so a re-run updates rather than
    adds a second Asha."""
    email = spec['email']
    staff = ProviderStaff.query.filter_by(
        tenant_id=tenant_id, email=email, is_deleted=False,
    ).first()
    if staff is None:
        staff = ProviderStaffService.create_staff(
            tenant_id, provider_type, provider.id, dict(spec),
        )
    else:
        for field, value in spec.items():
            setattr(staff, field, value)
        # Re-anchor through the setter in case the fallback picked a different
        # practice than the previous run did.
        staff.set_provider(provider_type, provider.id)
        db.session.flush()
    return staff


def seed(tenant):
    for entry in STAFF:
        provider_type = entry['provider_type']
        provider = _resolve_provider(tenant.id, provider_type)
        role = _resolve_role(tenant.id, provider_type, entry['role'])
        _apply_grants(role, entry['grants'])

        staff = _upsert_staff(tenant.id, provider_type, provider, entry['staff'])
        # No phone: staff_credentials mints a deterministic placeholder from the
        # staff id, which is what keeps the NOT NULL unique phone hash satisfied
        # without inventing a number that could collide with a real one.
        user, error = ensure_staff_user(
            staff, email=entry['staff']['email'], password=PASSWORD,
        )
        if error:
            raise SystemExit(f'seed aborted — {entry["staff"]["email"]}: {error}')
        _, error = ProviderStaffService.set_roles(staff, [role.id])
        if error:
            raise SystemExit(f'seed aborted — {entry["staff"]["email"]}: {error}')

        print(f'{staff.full_name:14} {provider_type.value:9} '
              f'{_provider_label(provider)}')
        print(f'  login  {user.email} / {PASSWORD}')
        print(f'  role   {role.name} — {len(entry["grants"])} module(s) granted')


if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        tenant = Tenant.query.filter_by(is_default=True).first()
        if tenant is None:
            raise SystemExit('no default tenant')
        g.tenant_id = tenant.id
        set_tenant_context(db.session, tenant.id)
        seed(tenant)
