"""Patient Family roles + permissions (Phase 2).

A patient (the OWNER of some data) can author roles and grant one to a linked
adult family member, scoping what that member may view / do "on behalf of" them.
Mirrors the provider staff+roles shape (app/models/provider_staff.py) but leaner:

  * ``PatientRole``           — a named role. Two-tier: ``owner_patient_id`` NULL
                                is a tenant-shared / system role; set is one
                                patient's private role.
  * ``PatientRolePermission`` — one row per (role, dotted ``module_key``) with two
                                grant verbs (view / manage). Only leaves stored;
                                absence = no grant.

The role a member HOLDS is attached to the existing ``HouseGroupMember`` row
(``role_id``) — each reciprocal member row already encodes one direction of the
link, so the role on it is "what this linked person may do on the owner's data".
"""
import uuid

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, utcnow


class PatientRole(TenantMixin, db.Model):
    """A named family role authored by a patient (or a tenant-shared system role)."""
    __tablename__ = 'patient_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='patient_role_id')
    # NULL = tenant-wide shared / system role; set = one patient's private role.
    owner_patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(300), nullable=True)
    is_system = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    permissions = db.relationship(
        'PatientRolePermission', backref='role', lazy='dynamic',
        cascade='all, delete-orphan',
    )

    __table_args__ = (
        # A name is unique within its owner tier — NULLs treated as equal so two
        # shared roles can't share a name either (Postgres 15 nulls-not-distinct).
        db.Index(
            'uq_patient_role_name',
            'tenant_id', 'owner_patient_id', 'name',
            unique=True, postgresql_nulls_not_distinct=True,
            postgresql_where=text('is_deleted = false'),
        ),
    )

    @property
    def is_shared(self):
        return self.owner_patient_id is None

    def to_dict(self, include_permissions=False):
        out = {
            'id': str(self.id),
            'owner_patient_id': str(self.owner_patient_id) if self.owner_patient_id else None,
            'name': self.name,
            'description': self.description,
            'is_system': self.is_system,
            'is_shared': self.is_shared,
            'is_active': self.is_active,
        }
        if include_permissions:
            out['permissions'] = [p.to_dict() for p in self.permissions]
        return out


class PatientFamilyPolicy(TenantMixin, db.Model):
    """Per-plan quotas for a patient's family (Phase 3).

    A member/minor never buys their own plan — they are covered by the OWNER's
    membership plan, which decides how many the owner may create. One row per
    plan (``uq(tenant_id, plan_id)``), kept in its own side table (mirrors
    ``CreditPolicy``) so an admin can retune caps live without re-versioning the
    plan. Sentinels: ``-1`` unlimited, ``0`` deny. Enforced at CREATE time only
    (re-checking on subscription attach would double-count).
    """
    __tablename__ = 'patient_family_policies'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='patient_family_policy_id')
    plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_plans.id', ondelete='CASCADE',
                      name='fk_patient_family_policies_plan_id'),
        nullable=False, index=True,
    )
    # How many the owner may have. -1 = unlimited, 0 = none.
    max_minor_subaccounts = db.Column(db.Integer, nullable=False, default=0,
                                      server_default='0')
    max_family_links = db.Column(db.Integer, nullable=False, default=0,
                                 server_default='0')
    max_patient_roles = db.Column(db.Integer, nullable=False, default=0,
                                  server_default='0')
    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default='true')

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'plan_id', name='uq_patient_family_policy_plan'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'plan_id': str(self.plan_id),
            'max_minor_subaccounts': self.max_minor_subaccounts,
            'max_family_links': self.max_family_links,
            'max_patient_roles': self.max_patient_roles,
            'is_active': self.is_active,
        }


class PatientRolePermission(TenantMixin, db.Model):
    """One grant over one module leaf for a PatientRole. Absence = no grant."""
    __tablename__ = 'patient_role_permissions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='patient_permission_id')
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_roles.patient_role_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    module_key = db.Column(db.String(120), nullable=False)
    can_view = db.Column(db.Boolean, default=False, nullable=False)
    can_manage = db.Column(db.Boolean, default=False, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint('role_id', 'module_key', name='uq_patient_role_perm'),
    )

    def to_dict(self):
        return {
            'module': self.module_key,
            'can_view': self.can_view,
            'can_manage': self.can_manage,
        }
