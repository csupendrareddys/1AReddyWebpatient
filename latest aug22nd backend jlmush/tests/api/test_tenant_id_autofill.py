"""Regression tests for the multi-tenant safety net.

Covers the class of bug that triggered the SaaS audit:
``TenantMixin``-bearing models that get constructed without an
explicit ``tenant_id`` kwarg used to NotNullViolation on commit.
The fix is a layered defence:

  1. ``before_flush`` event hook in ``app/models/_base.py`` that
     stamps ``tenant_id`` from ``flask.g.tenant_id`` when the row
     was added with ``tenant_id=None`` AND a Flask app context is
     active. Covers the common "operator manages own tenant"
     paths.

  2. Explicit ``tenant_id=parent.tenant_id`` at the small set of
     cross-tenant operator sites (approval actions where
     PLATFORM_OWNER's session tenant ≠ the request's tenant).

  3. ``with_background_tenant_context`` for code that runs outside
     a request (APScheduler jobs, scripts) — the hook is a no-op
     without an app context, so background jobs must opt in.

Pinning these behaviours in tests so a future change can't
silently regress to the NotNullViolation that broke the platform-
owner approval flow.
"""
from __future__ import annotations

import uuid

import pytest
from flask import g

from app.extensions import db
from app.models import (
    ApprovalRequest, ApprovalAction, ApprovalActionType,
    ApprovalEntityType, ApprovalRequestStatus,
    Tenant, TenantStatus, User, UserRole,
)
from app.models._base import set_tenant_context
from app.common.tenant_context import with_background_tenant_context


@pytest.fixture
def second_tenant(app, db_session):
    """A second tenant alongside ``fresh_tenant`` so cross-tenant
    behaviour can be exercised. Real PLATFORM_OWNER ops touch rows
    in tenants the operator is not currently scoped to."""
    slug = f't2_{uuid.uuid4().hex[:8]}'
    t = Tenant(
        name=f'Tenant Two {slug}',
        slug=slug,
        status=TenantStatus.ACTIVE,
        is_default=False,
    )
    db.session.add(t)
    db.session.commit()
    return t


def _make_test_user(tenant_id):
    """Minimal User row in ``tenant_id`` to satisfy the FK on
    ``approval_requests.requested_by_id``. Returns the user id."""
    set_tenant_context(db.session, tenant_id)
    user = User(
        role=UserRole.DOCTOR,
        first_name='Test',
        last_name='User',
        email_verified=True,
        phone_verified=True,
        tenant_id=tenant_id,
    )
    user.email = f'test_{uuid.uuid4().hex[:8]}@test.com'
    user.phone_number = f'9{uuid.uuid4().int % 1000000000:09d}'
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.commit()
    return user.id


class TestBeforeFlushAutoFill:
    """Ensure the ORM-level ``before_flush`` hook stamps tenant_id."""

    def test_construction_without_tenant_id_in_request_context(
        self, app, db_session, fresh_tenant,
    ):
        """In a request context with ``g.tenant_id`` set, a
        TenantMixin row constructed WITHOUT ``tenant_id`` gets
        auto-stamped from ``g.tenant_id`` at flush time."""
        with app.test_request_context():
            g.tenant_id = str(fresh_tenant.id)
            set_tenant_context(db.session, fresh_tenant.id)

            req = ApprovalRequest(
                requested_by_id=_make_test_user(fresh_tenant.id),
                entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
                entity_id=uuid.uuid4(),
                changes={'_meta': {'category': 'global'}},
                reason='test',
                required_level=1,
            )
            db.session.add(req)
            db.session.flush()

            assert req.tenant_id is not None, (
                'before_flush hook should have stamped tenant_id from g.tenant_id'
            )
            assert str(req.tenant_id) == str(fresh_tenant.id)

    def test_explicit_tenant_id_is_never_overwritten(
        self, app, db_session, fresh_tenant, second_tenant,
    ):
        """The hook must NEVER overwrite an explicit assignment.
        Cross-tenant operator flows depend on this — when
        PLATFORM_OWNER approves a request from the apex, the
        ApprovalAction's tenant_id is explicitly pinned to the
        request's tenant, NOT the operator's session tenant."""
        with app.test_request_context():
            # Operator's session tenant is ``fresh_tenant`` (apex).
            g.tenant_id = str(fresh_tenant.id)
            set_tenant_context(db.session, fresh_tenant.id)

            req = ApprovalRequest(
                tenant_id=second_tenant.id,  # explicit — the request lives in tenant 2
                requested_by_id=_make_test_user(fresh_tenant.id),
                entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
                entity_id=uuid.uuid4(),
                changes={},
                reason='cross-tenant',
                required_level=1,
            )
            db.session.add(req)
            db.session.flush()

            assert str(req.tenant_id) == str(second_tenant.id), (
                "Hook should not overwrite an explicit tenant_id even when "
                "g.tenant_id is set to a different tenant"
            )

    def test_no_op_outside_request_context(self, app, db_session, fresh_tenant):
        """Outside a Flask app context the hook silently skips —
        callers (scripts, migrations) are responsible for setting
        tenant_id themselves. Verify a missing tenant_id stays
        missing so the NOT NULL constraint surfaces loudly."""
        # Push a NESTED transaction so we can roll back the
        # IntegrityError without poisoning the session.
        with app.app_context():
            # Inside app context BUT no g.tenant_id set — hook
            # should still skip rather than guessing.
            with pytest.raises(Exception):
                req = ApprovalRequest(
                    requested_by_id=_make_test_user(fresh_tenant.id),
                    entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
                    entity_id=uuid.uuid4(),
                    changes={},
                    reason='no tenant context',
                    required_level=1,
                )
                db.session.add(req)
                db.session.commit()


class TestApprovalActionTenantPinning:
    """ApprovalAction inserts must pin tenant_id from the parent
    ApprovalRequest, not from g.tenant_id. This is the specific
    bug class that triggered the audit — verifying it stays fixed.
    """

    def _make_request(self, tenant_id):
        req = ApprovalRequest(
            tenant_id=tenant_id,
            requested_by_id=_make_test_user(tenant_id),
            entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
            entity_id=uuid.uuid4(),
            changes={'_meta': {'category': 'global'}},
            reason='test',
            required_level=1,
        )
        db.session.add(req)
        db.session.flush()
        return req

    def test_approve_level_pins_action_to_request_tenant(
        self, app, db_session, fresh_tenant, second_tenant,
    ):
        """When operator is in tenant A but approves a request that
        lives in tenant B, the new ApprovalAction MUST attach to
        tenant B (the request's tenant), not tenant A (operator's
        session). Otherwise the action lives in the wrong tenant
        and breaks RLS-filtered history reads."""
        with app.test_request_context():
            # Set operator's session tenant to fresh_tenant.
            g.tenant_id = str(fresh_tenant.id)
            set_tenant_context(db.session, fresh_tenant.id)

            # But the request lives in second_tenant — explicit
            # tenant_id when constructing.
            req = self._make_request(second_tenant.id)

            # Use a real admin user in fresh_tenant (the operator's
            # session tenant); FK on approval_actions.admin_id needs
            # to resolve to an actual users row.
            admin_id = _make_test_user(fresh_tenant.id)
            success, _ = req.approve_level(admin_id=admin_id, comments='ok')
            assert success

            action = ApprovalAction.query.filter_by(request_id=req.id).first()
            assert action is not None
            assert str(action.tenant_id) == str(second_tenant.id), (
                'ApprovalAction must carry the request tenant, not the operator session tenant'
            )


class TestBackgroundTenantContext:
    """``with_background_tenant_context`` makes the auto-fill hook
    work for code that runs outside a Flask request."""

    def test_hook_fires_inside_background_context(
        self, app, db_session, fresh_tenant,
    ):
        """Construct a TenantMixin row WITHOUT tenant_id from
        inside ``with_background_tenant_context`` — the hook
        should stamp the row using the helper-provided tenant_id."""
        with with_background_tenant_context(app, fresh_tenant.id):
            req = ApprovalRequest(
                requested_by_id=_make_test_user(fresh_tenant.id),
                entity_type=ApprovalEntityType.DOCTOR_AVAILABILITY,
                entity_id=uuid.uuid4(),
                changes={},
                reason='from background',
                required_level=1,
            )
            db.session.add(req)
            db.session.flush()

            assert str(req.tenant_id) == str(fresh_tenant.id)
