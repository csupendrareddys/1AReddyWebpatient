"""
Provider-staff RBAC service — roles, their grants, and the staff who hold them.

Everything here is tenant-scoped by an explicit ``tenant_id`` argument rather
than by ambient context, matching ``OperationsService``: the caller has already
resolved the tenant at the route, and passing it keeps these functions callable
from scripts and tests without a request.
"""
import logging

from sqlalchemy.orm import joinedload

from app.api.admin.provider_rbac import module_catalog
from app.common.staff_credentials import ensure_staff_user, revoke_staff_login
from app.extensions import db
from app.models import (
    Clinic, DataRange, Doctor, Hospital, ProviderRole, ProviderRolePermission,
    ProviderStaff, ProviderStaffRole, ProviderStaffStatus, StaffProviderType,
    User, GRANT_COLUMNS,
)
from app.models._base import utcnow

logger = logging.getLogger(__name__)

# Which model and id column anchor each vertical. One place, so adding a
# vertical later means one entry rather than a hunt through branches.
PROVIDER_MODELS = {
    StaffProviderType.DOCTOR: (Doctor, 'doctor_id'),
    StaffProviderType.CLINIC: (Clinic, 'clinic_id'),
    StaffProviderType.HOSPITAL: (Hospital, 'hospital_id'),
}

# A role nobody owns is the tenant-wide tier. Written once as an expression
# because every query that separates the two tiers needs exactly this test,
# and spelling it out three columns at a time invites one of them being missed.
SHARED_ROLE = db.and_(
    ProviderRole.owner_doctor_id.is_(None),
    ProviderRole.owner_clinic_id.is_(None),
    ProviderRole.owner_hospital_id.is_(None),
)


def parse_provider_type(value):
    """'clinic' -> StaffProviderType.CLINIC, or None if it isn't a vertical
    that has staff. Returning None rather than raising lets routes answer 404
    for ``patient`` instead of 500."""
    try:
        return StaffProviderType(value)
    except ValueError:
        return None


def owner_column(provider_type):
    """The ``ProviderRole`` column that anchors owned roles in one vertical.

    Read off the model's own map so a fourth vertical can't be added there and
    silently missed here.
    """
    return getattr(ProviderRole, ProviderRole._OWNER_ATTR[provider_type])


def provider_names(provider_type, provider_ids):
    """{provider_id: display name} for one vertical, in a single query.

    One query rather than an attribute walk per row: both the staff roster and
    the admin's role list render a whole vertical, so ``row.clinic.name`` would
    be a lookup per line. A doctor has no ``name`` column — the name lives on
    their User — hence the join rather than a plain id->name select.
    """
    ids = {i for i in provider_ids if i}
    if not ids:
        return {}
    if provider_type is StaffProviderType.DOCTOR:
        rows = (
            db.session.query(Doctor.id, User.first_name, User.last_name)
            .outerjoin(User, Doctor.user_id == User.id)
            .filter(Doctor.id.in_(ids)).all()
        )
        return {
            str(pid): ' '.join(p for p in (first, last) if p).strip() or None
            for pid, first, last in rows
        }
    model, _ = PROVIDER_MODELS[provider_type]
    return {
        str(pid): name
        for pid, name in db.session.query(model.id, model.name)
        .filter(model.id.in_(ids)).all()
    }


def catalog_payload(provider_type):
    """The tree the matrix renders, plus the column and data-range vocabulary.

    Shared by the admin and the provider surface so the two screens can't drift
    into disagreeing about which verbs or ranges exist, and so adding a verb
    stays a single backend change.
    """
    return {
        'provider_type': provider_type.value,
        'modules': module_catalog.tree_for(provider_type.value),
        'leaf_count': module_catalog.leaf_count(provider_type.value),
        'actions': list(GRANT_COLUMNS),
        'data_ranges': [
            {'value': dr.name, 'label': dr.label, 'days': dr.days}
            for dr in DataRange
        ],
    }


# ============================================================================
# ROLES
# ============================================================================

class ProviderRoleService:

    # The roles each vertical starts with. Seeded lazily on first read rather
    # than in a migration: a tenant that never opens this screen shouldn't
    # accumulate rows, and a migration that writes per-tenant data has to be
    # re-run for every tenant created afterwards.
    #
    # They are created with NO permissions. Guessing what a "Front Desk" may
    # touch and shipping it as a default would hand out access nobody chose —
    # the point of the screen is that a human decides.
    DEFAULT_ROLES = {
        StaffProviderType.DOCTOR: [
            ('Practice Manager', "Runs the doctor's calendar and patient list"),
            ('Assistant', 'Day-to-day support with limited access'),
            ('Billing Staff', 'Bills and payouts only'),
        ],
        StaffProviderType.CLINIC: [
            ('Clinic Manager', 'Runs the clinic on the owner’s behalf'),
            ('Front Desk', 'Reception — appointments and patient check-in'),
            ('Billing Staff', 'Invoices and payments only'),
        ],
        StaffProviderType.HOSPITAL: [
            ('Hospital Administrator', 'Runs the hospital on the owner’s behalf'),
            ('Department Head', 'Owns one department’s doctors and schedule'),
            ('Front Desk', 'Reception — appointments and patient check-in'),
            ('Billing Staff', 'Invoices and payments only'),
        ],
    }

    @staticmethod
    def _base_query(tenant_id, provider_type):
        return ProviderRole.query.filter(
            ProviderRole.tenant_id == tenant_id,
            ProviderRole.provider_type == provider_type,
            ProviderRole.is_deleted == False,   # noqa: E712
        )

    @staticmethod
    def ensure_defaults(tenant_id, provider_type, created_by_id=None):
        """Seed this tenant's SHARED roles for a vertical if it has none.

        Counts only the shared tier: a clinic that authored a private role
        before any admin opened the screen would otherwise look like "this
        vertical already has roles" and suppress the seeding for everyone.

        Only fires on a genuinely empty tier, so an admin who deliberately
        deletes a seeded role doesn't find it back on the next page load.
        """
        existing = (
            ProviderRoleService._base_query(tenant_id, provider_type)
            .filter(SHARED_ROLE).count()
        )
        if existing:
            return 0
        for name, description in ProviderRoleService.DEFAULT_ROLES.get(provider_type, []):
            db.session.add(ProviderRole(
                tenant_id=tenant_id, provider_type=provider_type,
                name=name, description=description,
                is_system=True, created_by_id=created_by_id,
            ))
        db.session.commit()
        logger.info('Seeded provider roles for tenant=%s vertical=%s',
                    tenant_id, provider_type.value)
        return len(ProviderRoleService.DEFAULT_ROLES.get(provider_type, []))

    @staticmethod
    def list_roles(tenant_id, provider_type, include_counts=True,
                   owner_id=None, include_shared=True):
        """The roles in a vertical, from the caller's vantage point.

        ``owner_id=None`` is the admin's view: every role in the vertical,
        shared and practice-authored alike, each tagged with whose it is so the
        admin can tell a tenant-wide "Front Desk" from one clinic's own.

        A provider passes their own id and sees the shared tier plus their own.
        Another practice's roles are not filtered out for tidiness — they are
        not theirs to see, which is the whole reason the owner column exists.
        """
        q = ProviderRoleService._base_query(tenant_id, provider_type)
        if owner_id is not None:
            mine = owner_column(provider_type) == owner_id
            q = q.filter(db.or_(SHARED_ROLE, mine) if include_shared else mine)
        roles = q.order_by(
            # Shared first: it's the tier every practice has in common, and
            # both surfaces read top-down expecting the common ones first.
            db.case((SHARED_ROLE, 0), else_=1),
            ProviderRole.is_system.desc(), ProviderRole.name.asc(),
        ).all()

        names = provider_names(provider_type, {r.owner_id for r in roles})
        return [
            dict(r.to_dict(include_counts=include_counts),
                 owner_name=names.get(str(r.owner_id)) if r.owner_id else None)
            for r in roles
        ]

    @staticmethod
    def name_taken(tenant_id, provider_type, name, owner_id=None, exclude_id=None):
        """Would this name be ambiguous in the caller's own list?

        Scoped to the tier the new role lands in, matching the unique index: a
        tenant-wide "Front Desk" and one clinic's own "Front Desk" are legal as
        separate rows, so the admin only collides with the shared tier. A
        provider collides with both, because both appear in their picker and
        two identical names there are indistinguishable.
        """
        q = ProviderRoleService._base_query(tenant_id, provider_type).filter(
            db.func.lower(ProviderRole.name) == name.strip().lower(),
        )
        if owner_id is None:
            q = q.filter(SHARED_ROLE)
        else:
            q = q.filter(db.or_(SHARED_ROLE, owner_column(provider_type) == owner_id))
        if exclude_id:
            q = q.filter(ProviderRole.id != exclude_id)
        return db.session.query(q.exists()).scalar()

    @staticmethod
    def can_edit(role, owner_id):
        """May this caller change the role?

        ``owner_id=None`` is the admin, who curates both tiers. A practice may
        only touch what it authored: editing a shared role would re-scope every
        other practice's staff in the vertical, which is exactly the accident
        the owner column was added to prevent.
        """
        if owner_id is None:
            return True
        return role.owner_id is not None and str(role.owner_id) == str(owner_id)

    @staticmethod
    def get_role(tenant_id, role_id):
        return (
            ProviderRole.query
            .options(joinedload(ProviderRole.permissions))
            .filter(
                ProviderRole.id == role_id,
                ProviderRole.tenant_id == tenant_id,
                ProviderRole.is_deleted == False,   # noqa: E712
            ).first()
        )

    @staticmethod
    def create_role(tenant_id, provider_type, data, created_by_id=None, owner_id=None):
        """``owner_id=None`` creates a shared, tenant-wide role — the admin's
        tier. A provider passes their own id and gets a role only they can see
        and change."""
        role = ProviderRole(
            tenant_id=tenant_id,
            provider_type=provider_type,
            name=data['name'].strip(),
            description=(data.get('description') or '').strip() or None,
            is_active=data.get('is_active', True),
            is_system=False,
            created_by_id=created_by_id,
        )
        # Through the setter so the two owner columns this vertical doesn't use
        # stay null and the at-most-one-owner CHECK holds.
        role.set_owner(owner_id)
        db.session.add(role)
        db.session.commit()
        return role

    @staticmethod
    def update_role(role, data, updated_by_id=None):
        if 'name' in data:
            role.name = data['name'].strip()
        if 'description' in data:
            role.description = (data.get('description') or '').strip() or None
        if 'is_active' in data:
            role.is_active = bool(data['is_active'])
        role.updated_by_id = updated_by_id
        db.session.commit()
        return role

    @staticmethod
    def delete_role(role):
        """Soft-delete, and stand down the assignments with it.

        Leaving ``provider_staff_roles`` rows active would keep a deleted role
        in a staff member's effective grants — the union query joins on the
        assignment, not on the role's liveness.
        """
        if role.is_system:
            return False, 'Seeded roles cannot be deleted. Deactivate it instead.'
        role.is_deleted = True
        role.deleted_at = utcnow()
        role.is_active = False
        for assignment in role.staff_assignments.filter_by(is_active=True).all():
            assignment.is_active = False
            assignment.deactivated_at = utcnow()
        db.session.commit()
        return True, None


# ============================================================================
# PERMISSIONS
# ============================================================================

class ProviderPermissionService:

    @staticmethod
    def get_matrix(role):
        """The stored grants for a role, keyed by module path.

        The tree itself is NOT returned here — the client fetches the catalog
        once per vertical and reuses it across roles, rather than re-sending a
        150-node tree with every role switch.
        """
        return {
            'role': role.to_dict(),
            'permissions': [
                dict(p.to_dict(),
                     label=module_catalog.label_for(role.provider_type.value, p.module_key))
                for p in role.permissions
            ],
        }

    @staticmethod
    def replace_matrix(role, permissions_data, updated_by_id=None):
        """Replace a role's grants wholesale with what the matrix submitted.

        Replace rather than merge, because the screen submits the whole tree:
        a module the operator UNTICKED arrives as absent (or all-false), and a
        merge would leave the old grant in place. "Saved" has to mean the
        stored state matches the screen.

        Rejects unknown or non-leaf module keys instead of dropping them —
        silently ignoring a key would let a typo look like a successful save
        while granting nothing.
        """
        valid = module_catalog.leaf_keys(role.provider_type.value)
        unknown = [
            p.get('module') for p in permissions_data
            if p.get('module') not in valid
        ]
        if unknown:
            return None, f"Unknown module keys for {role.provider_type.value}: {', '.join(sorted(set(map(str, unknown))))}"

        existing = {p.module_key: p for p in role.permissions}
        seen = set()

        for entry in permissions_data:
            key = entry['module']
            granted = {col: bool(entry.get(col)) for col in GRANT_COLUMNS}
            # An all-false row is the ABSENCE of a permission, not a permission
            # to do nothing. Storing it would inflate the table and make
            # "granted_module_count" lie.
            if not any(granted.values()):
                continue
            seen.add(key)

            try:
                data_range = DataRange[entry.get('data_range') or 'ALL']
            except KeyError:
                return None, f"Invalid data_range '{entry.get('data_range')}' for module '{key}'"

            perm = existing.get(key)
            if perm is None:
                perm = ProviderRolePermission(
                    tenant_id=role.tenant_id, role_id=role.id, module_key=key,
                )
                db.session.add(perm)
            for col, value in granted.items():
                setattr(perm, col, value)
            perm.data_range = data_range

        for key, perm in existing.items():
            if key not in seen:
                db.session.delete(perm)

        role.updated_by_id = updated_by_id
        db.session.commit()
        return len(seen), None

    @staticmethod
    def effective_for_staff(staff):
        """A staff member's grants: the UNION over every active role they hold.

        Union, not intersection or last-wins — holding "Front Desk" and
        "Billing" is meant to add the two together, which is the whole reason
        the assignment is many-to-many.

        This is the function a future ``@staff_permission_required`` decorator
        will call. It is not wired to any gate yet, because staff cannot log in
        and there is no request to gate.
        """
        merged = {}
        for assignment in staff.role_assignments:
            if not assignment.is_active:
                continue
            role = assignment.role
            if not role or role.is_deleted or not role.is_active:
                continue
            for perm in role.permissions:
                current = merged.setdefault(
                    perm.module_key,
                    {'module': perm.module_key, 'data_range': perm.data_range},
                )
                for col in GRANT_COLUMNS:
                    current[col] = current.get(col, False) or getattr(perm, col)
                # Widest window wins — the same reasoning as the boolean union.
                if perm.data_range.value > current['data_range'].value:
                    current['data_range'] = perm.data_range

        provider_type = staff.provider_type.value
        return [
            dict(v, data_range=v['data_range'].name,
                 label=module_catalog.label_for(provider_type, k))
            for k, v in sorted(merged.items())
        ]


# ============================================================================
# STAFF
# ============================================================================

class ProviderStaffService:

    @staticmethod
    def provider_exists(tenant_id, provider_type, provider_id):
        model, _ = PROVIDER_MODELS[provider_type]
        return db.session.query(
            model.query.filter(
                model.id == provider_id,
                model.tenant_id == tenant_id,
                model.is_deleted == False,   # noqa: E712
            ).exists()
        ).scalar()

    @staticmethod
    def list_staff(tenant_id, provider_type=None, provider_id=None,
                   search='', role_id=None, page=1, per_page=20):
        q = (
            ProviderStaff.query
            .options(joinedload(ProviderStaff.role_assignments)
                     .joinedload(ProviderStaffRole.role))
            .filter(
                ProviderStaff.tenant_id == tenant_id,
                ProviderStaff.is_deleted == False,   # noqa: E712
            )
        )
        if provider_type:
            q = q.filter(ProviderStaff.provider_type == provider_type)
            if provider_id:
                _, attr = PROVIDER_MODELS[provider_type]
                q = q.filter(getattr(ProviderStaff, attr) == provider_id)
        if role_id:
            # "Who holds this role?" — asked before an admin edits or deletes
            # one, so the blast radius is visible first. Active assignments
            # only: a role someone used to hold isn't held.
            q = q.filter(ProviderStaff.role_assignments.any(db.and_(
                ProviderStaffRole.role_id == role_id,
                ProviderStaffRole.is_active == True,   # noqa: E712
            )))
        if search:
            like = f'%{search}%'
            q = q.filter(db.or_(
                ProviderStaff.first_name.ilike(like),
                ProviderStaff.last_name.ilike(like),
                ProviderStaff.email.ilike(like),
                ProviderStaff.designation.ilike(like),
                ProviderStaff.employee_code.ilike(like),
            ))
        pg = q.order_by(ProviderStaff.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False,
        )
        names = ProviderStaffService._provider_names(pg.items)
        return {
            'staff': [
                dict(s.to_dict(), provider_name=names.get(str(s.provider_id)))
                for s in pg.items
            ],
            'pagination': {
                'page': pg.page, 'per_page': pg.per_page,
                'total': pg.total, 'pages': pg.pages,
            },
        }

    @staticmethod
    def _provider_names(staff_rows):
        """{provider_id: display name} for a page of staff, one query per
        vertical present — a page can mix verticals, unlike a role list."""
        by_type = {}
        for staff in staff_rows:
            if staff.provider_id:
                by_type.setdefault(staff.provider_type, set()).add(staff.provider_id)

        names = {}
        for provider_type, ids in by_type.items():
            names.update(provider_names(provider_type, ids))
        return names

    @staticmethod
    def get_staff(tenant_id, staff_id):
        return ProviderStaff.query.filter(
            ProviderStaff.id == staff_id,
            ProviderStaff.tenant_id == tenant_id,
            ProviderStaff.is_deleted == False,   # noqa: E712
        ).first()

    @staticmethod
    def create_staff(tenant_id, provider_type, provider_id, data, created_by_id=None):
        staff = ProviderStaff(
            tenant_id=tenant_id,
            first_name=data['first_name'].strip(),
            last_name=(data.get('last_name') or '').strip() or None,
            email=(data.get('email') or '').strip() or None,
            phone_number=(data.get('phone_number') or '').strip() or None,
            designation=(data.get('designation') or '').strip() or None,
            employee_code=(data.get('employee_code') or '').strip() or None,
            notes=(data.get('notes') or '').strip() or None,
            created_by_id=created_by_id,
        )
        # Through the setter, so the two anchor columns this vertical doesn't
        # use are explicitly cleared and the CHECK constraint holds.
        staff.set_provider(provider_type, provider_id)
        db.session.add(staff)
        db.session.flush()

        for role_id in data.get('role_ids') or []:
            ProviderStaffService._attach_role(staff, role_id, created_by_id)
        db.session.commit()
        return staff

    @staticmethod
    def create_staff_with_login(tenant_id, provider_type, provider_id, data,
                                created_by_id=None):
        """``create_staff`` plus the roles and the optional login, as one unit.

        Returns ``(staff, error)``. The three are one action from the operator's
        side: a rejected password or an unassignable role must not leave a
        half-made staff row behind for someone to find and clean up, so a
        failure takes the new row with it.
        """
        _, message = ProviderStaffService._resolve_roles(
            tenant_id, provider_type, provider_id, data.get('role_ids') or [],
        )
        if message:
            return None, message

        staff = ProviderStaffService.create_staff(
            tenant_id, provider_type, provider_id, data, created_by_id,
        )
        message = ProviderStaffService.apply_login(staff, data)
        if message:
            db.session.delete(staff)
            db.session.commit()
            return None, message
        return staff, None

    @staticmethod
    def apply_login(staff, data):
        """Create, refresh or revoke this staff member's sign-in. Error or None.

        ``email`` is also the plain contact field, so an email on its own can't
        mean "give this person an account" — otherwise every staff row typed
        with a work address would silently become one. A login is minted only
        when a password arrives; once it exists, an email edit follows it.
        """
        if data.get('revoke_login'):
            revoke_staff_login(staff)
            db.session.commit()
            return None
        if not data.get('password') and not staff.user_id:
            return None

        _, message = ensure_staff_user(
            staff, email=data.get('email'), password=data.get('password'),
            phone_number=data.get('phone_number'),
        )
        if message:
            db.session.rollback()
            return message
        db.session.commit()
        return None

    @staticmethod
    def set_staff_provider(staff, provider_type, provider_id, updated_by_id=None):
        """Re-anchor a staff member to a different practice.

        Returns ``(staff, dropped_role_names)``. A role only means something
        where it was authored: crossing verticals leaves the held roles naming
        modules the new provider's tree doesn't have, and even within a vertical
        another practice's private role was written for their people, not these.
        Both are deactivated rather than deleted, so the record of who held what
        survives the move.
        """
        dropped = []
        for assignment in staff.role_assignments:
            role = assignment.role
            if not assignment.is_active or not role:
                continue
            stale = role.provider_type != provider_type or (
                role.owner_id is not None and str(role.owner_id) != str(provider_id)
            )
            if stale:
                assignment.is_active = False
                assignment.deactivated_at = utcnow()
                dropped.append(role.name)

        staff.set_provider(provider_type, provider_id)
        staff.updated_by_id = updated_by_id
        db.session.commit()
        return staff, dropped

    @staticmethod
    def update_staff(staff, data, updated_by_id=None):
        for field in ('first_name', 'last_name', 'email', 'phone_number',
                      'designation', 'employee_code', 'notes'):
            if field in data:
                value = (data.get(field) or '').strip()
                setattr(staff, field, value or (None if field != 'first_name' else staff.first_name))
        if 'status' in data:
            try:
                staff.status = ProviderStaffStatus(data['status'])
            except ValueError:
                return None, f"Invalid status '{data['status']}'"
        staff.updated_by_id = updated_by_id
        db.session.commit()
        return staff, None

    @staticmethod
    def delete_staff(staff):
        staff.is_deleted = True
        staff.deleted_at = utcnow()
        for assignment in staff.role_assignments:
            if assignment.is_active:
                assignment.is_active = False
                assignment.deactivated_at = utcnow()
        db.session.commit()

    @staticmethod
    def _attach_role(staff, role_id, assigned_by_id):
        """Reactivate an existing assignment rather than inserting a duplicate —
        the (staff, role) pair is unique, so re-assigning a previously removed
        role would otherwise raise instead of restoring it."""
        existing = next(
            (a for a in staff.role_assignments if str(a.role_id) == str(role_id)), None,
        )
        if existing:
            existing.is_active = True
            existing.deactivated_at = None
            return existing
        assignment = ProviderStaffRole(
            tenant_id=staff.tenant_id, staff_id=staff.id, role_id=role_id,
            assigned_by_id=assigned_by_id,
        )
        db.session.add(assignment)
        staff.role_assignments.append(assignment)
        return assignment

    @staticmethod
    def _resolve_roles(tenant_id, provider_type, provider_id, role_ids):
        """The roles behind ``role_ids``, or the reason they can't be held.

        Two refusals, both about grants that would mean nothing. A role from
        another vertical names modules this staff member's provider doesn't
        have — access nobody can explain. A role owned by another practice was
        authored for their people over their data; only its owner and the
        shared tier are assignable here.
        """
        wanted = {str(r) for r in role_ids}
        if not wanted:
            return [], None

        roles = ProviderRole.query.filter(
            ProviderRole.id.in_(wanted),
            ProviderRole.tenant_id == tenant_id,
            ProviderRole.is_deleted == False,   # noqa: E712
        ).all()
        missing = wanted - {str(r.id) for r in roles}
        if missing:
            return None, f"Unknown role(s): {', '.join(sorted(missing))}"

        wrong = [r.name for r in roles if r.provider_type != provider_type]
        if wrong:
            return None, (
                f"Role(s) {', '.join(wrong)} belong to another provider type "
                f"and can't be given to {provider_type.value} staff"
            )
        foreign = [
            r.name for r in roles
            if r.owner_id is not None and str(r.owner_id) != str(provider_id)
        ]
        if foreign:
            return None, (
                f"Role(s) {', '.join(foreign)} belong to another practice and "
                f"can't be assigned here"
            )
        return roles, None

    @staticmethod
    def set_roles(staff, role_ids, assigned_by_id=None):
        """Make the held roles exactly ``role_ids``."""
        _, message = ProviderStaffService._resolve_roles(
            staff.tenant_id, staff.provider_type, staff.provider_id, role_ids,
        )
        if message:
            return None, message

        wanted = {str(r) for r in role_ids}
        for assignment in staff.role_assignments:
            if str(assignment.role_id) not in wanted and assignment.is_active:
                assignment.is_active = False
                assignment.deactivated_at = utcnow()
        for role_id in wanted:
            ProviderStaffService._attach_role(staff, role_id, assigned_by_id)
        db.session.commit()
        return staff, None
