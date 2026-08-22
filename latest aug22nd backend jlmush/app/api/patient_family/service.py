"""Patient Family roles service — author roles, set their permission matrix, and
resolve a linked member's effective grants. Mirrors ProviderPermissionService
but leaner (two verbs). Role authoring + assignment are OWNER-only; enforced at
the route layer (anti self-escalation), exactly like provider staff.
"""
import logging

from app.extensions import db
from app.models import PatientRole, PatientRolePermission
from app.api.patient_family.module_catalog import is_valid_module

logger = logging.getLogger(__name__)


class PatientRoleService:

    @staticmethod
    def list_for_owner(tenant_id, owner_patient_id):
        """Roles this patient can assign: the tenant-shared/system roles plus
        their own private ones."""
        return (PatientRole.query
                .filter(PatientRole.tenant_id == tenant_id,
                        PatientRole.is_deleted.is_(False),
                        PatientRole.is_active.is_(True),
                        db.or_(PatientRole.owner_patient_id.is_(None),
                               PatientRole.owner_patient_id == owner_patient_id))
                .order_by(PatientRole.is_system.desc(), PatientRole.name.asc())
                .all())

    @staticmethod
    def get_owned(tenant_id, owner_patient_id, role_id):
        """A role this owner may edit — only their OWN private roles (never the
        shared/system tier)."""
        return PatientRole.query.filter_by(
            tenant_id=tenant_id, id=role_id,
            owner_patient_id=owner_patient_id, is_deleted=False,
        ).first()

    @staticmethod
    def create(tenant_id, owner_patient_id, name, description=None):
        name = (name or '').strip()
        if not name:
            raise ValueError('A role name is required.')
        role = PatientRole(
            tenant_id=tenant_id, owner_patient_id=owner_patient_id,
            name=name, description=(description or '').strip() or None,
            is_system=False, is_active=True,
        )
        db.session.add(role)
        db.session.commit()
        return role

    @staticmethod
    def replace_matrix(role, permissions_data):
        """Whole-matrix replace: validate every module against the catalog, drop
        all-false rows (absence = no grant). ``permissions_data`` is a list of
        ``{module, can_view, can_manage}``."""
        clean = []
        for row in (permissions_data or []):
            key = row.get('module')
            if not is_valid_module(key):
                raise ValueError(f'Unknown module "{key}".')
            view = bool(row.get('can_view'))
            manage = bool(row.get('can_manage'))
            if not view and not manage:
                continue
            # manage implies view.
            clean.append((key, view or manage, manage))

        role.permissions.delete()  # lazy='dynamic'
        for key, view, manage in clean:
            db.session.add(PatientRolePermission(
                tenant_id=role.tenant_id, role_id=role.id,
                module_key=key, can_view=view, can_manage=manage,
            ))
        db.session.commit()
        return role

    @staticmethod
    def effective_for_member(member):
        """The grants a linked member holds via their assigned role, as
        ``{module_key: {'can_view': bool, 'can_manage': bool}}``. Empty when the
        member has no role (the caller then falls back to the legacy JSON)."""
        if not getattr(member, 'role_id', None):
            return {}
        perms = PatientRolePermission.query.filter_by(
            tenant_id=member.tenant_id, role_id=member.role_id).all()
        return {
            p.module_key: {'can_view': p.can_view, 'can_manage': p.can_manage}
            for p in perms
        }
