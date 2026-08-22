"""Service layer for marketplace ``MembershipSubscription`` writes.

Three operations Round 2 needs:

  * ``create_pending_for_doctor`` — called from the doctor signup
    service after the ``Doctor`` row is created. Persists a
    ``MembershipSubscription`` in ``PENDING`` state. Idempotent at the
    callsite via a domain exception (no second-PENDING-row scenarios).
  * ``activate_trial`` — called from the doctor-approval handler
    (``Backend/app/api/admin/routes.py:update_doctor_verification``)
    when a PENDING doctor flips to VERIFIED. Sets status to TRIAL and
    starts the trial clock at approval time so the provider doesn't
    burn days waiting for credential review.
  * ``get_active_for_user`` — single-row lookup used by the
    ``/api/membership/me`` read endpoint. Returns the user's current
    membership in PENDING / TRIAL / ACTIVE state, or None.

Domain errors:
  * ``MembershipPlanNotFound`` — no such plan code.
  * ``MembershipPlanInactive`` — plan exists but status != active.
  * ``MembershipPlanWrongVertical`` — plan's vertical doesn't match
    the provider type the caller is signing up.
  * ``MembershipAlreadyExists`` — provider profile already has a
    PENDING / TRIAL / ACTIVE row (covered by the partial unique index
    for TRIAL/ACTIVE; the service additionally rejects duplicate
    PENDING so the caller gets a clean 409 instead of a UNIQUE
    violation surfacing as a generic 500 later).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.models import (
    MembershipPlan,
    MembershipPlanStatus,
    MembershipSubscription,
    MembershipSubscriptionStatus,
    MembershipVertical,
    BillingCycle,
)


# --------------------------------------------------------------------------- #
# Domain errors
# --------------------------------------------------------------------------- #

class MembershipPlanNotFound(LookupError):
    """No ``MembershipPlan`` with the given code (or it's soft-deleted)."""


class MembershipPlanInactive(ValueError):
    """Plan exists but isn't ``status='active'`` — can't subscribe to a
    draft / archived plan."""


class MembershipPlanWrongVertical(ValueError):
    """Plan exists and is active, but its vertical doesn't match the
    provider type we're trying to subscribe (e.g. doctor signup with a
    clinic-tier plan code)."""


class MembershipAlreadyExists(ValueError):
    """Provider profile already has a live membership row. Application-
    layer guard — surfaces as 409 in the route layer."""


class MembershipSubscriptionNotFound(LookupError):
    """No ``MembershipSubscription`` with that id in the caller's tenant.
    Deliberately indistinguishable from "exists but belongs to another
    tenant" so the roster can't be used to probe for foreign ids."""


class MembershipSubscriptionCancelled(ValueError):
    """Refusing to change the plan on a cancelled membership — there's no
    live subscription to move."""


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #

def _now():
    """Single shim — easy to monkeypatch in tests."""
    return datetime.now(timezone.utc)


class MembershipSubscriptionService:

    # --- creation ----------------------------------------------------

    @staticmethod
    def create_pending_for_provider(
        *,
        vertical: MembershipVertical,
        provider_id,
        user_id,
        plan_code: str,
    ) -> MembershipSubscription:
        """Create a PENDING marketplace membership for any provider type.

        The polymorphic core that Round 2 (doctor) + Round 3+4 (clinic
        / hospital) shims call into. Each vertical's signup pipeline
        passes its own ``provider_id`` (Doctor.id / Clinic.id /
        Hospital.id) plus the chosen ``plan_code``. The plan's own
        ``vertical`` is validated against the caller's expectation —
        so e.g. a doctor signing up with a clinic-tier plan code
        gets rejected by ``_resolve_active_plan`` before the row is
        written.

        Raises:
            MembershipPlanNotFound, MembershipPlanInactive,
            MembershipPlanWrongVertical, MembershipAlreadyExists.

        Returns the newly-committed ``MembershipSubscription``.
        """
        plan = MembershipSubscriptionService._resolve_active_plan(
            plan_code, expected_vertical=vertical,
        )

        # Reject duplicates BEFORE writing — the partial unique index
        # only covers TRIAL/ACTIVE, so two PENDING rows would commit
        # silently and confuse downstream activation logic.
        existing = (
            MembershipSubscription.query
            .filter_by(
                provider_type=vertical,
                provider_id=provider_id,
                is_deleted=False,
            )
            .filter(
                MembershipSubscription.status.in_([
                    MembershipSubscriptionStatus.PENDING,
                    MembershipSubscriptionStatus.TRIAL,
                    MembershipSubscriptionStatus.ACTIVE,
                ])
            )
            .first()
        )
        if existing:
            raise MembershipAlreadyExists(
                f'{vertical.value.title()} {provider_id} already has an '
                f'active membership ({existing.status.value}).'
            )

        sub = MembershipSubscription(
            user_id=user_id,
            provider_type=vertical,
            provider_id=provider_id,
            membership_plan_id=plan.id,
            billing_cycle=BillingCycle.MONTHLY,
            status=MembershipSubscriptionStatus.PENDING,
            # Lifecycle timestamps stay NULL during PENDING —
            # ``activate_trial`` fills them in on approval.
            trial_ends_at=None,
            current_period_start=None,
            current_period_end=None,
        )
        db.session.add(sub)
        db.session.commit()
        return sub

    @staticmethod
    def create_pending_for_doctor(
        *, doctor_id, user_id, plan_code: str,
    ) -> MembershipSubscription:
        """Round 2 shim — delegates to ``create_pending_for_provider``
        with ``vertical=DOCTOR``. Kept so the Round 2 callsite in
        ``app/auth/service.py:signup_doctor`` stays unchanged."""
        return MembershipSubscriptionService.create_pending_for_provider(
            vertical=MembershipVertical.DOCTOR,
            provider_id=doctor_id,
            user_id=user_id,
            plan_code=plan_code,
        )

    @staticmethod
    def create_pending_for_clinic(
        *, clinic_id, user_id, plan_code: str,
    ) -> MembershipSubscription:
        """Round 3+4 — clinic marketplace signup."""
        return MembershipSubscriptionService.create_pending_for_provider(
            vertical=MembershipVertical.CLINIC,
            provider_id=clinic_id,
            user_id=user_id,
            plan_code=plan_code,
        )

    @staticmethod
    def create_pending_for_hospital(
        *, hospital_id, user_id, plan_code: str,
    ) -> MembershipSubscription:
        """Round 3+4 — hospital marketplace signup."""
        return MembershipSubscriptionService.create_pending_for_provider(
            vertical=MembershipVertical.HOSPITAL,
            provider_id=hospital_id,
            user_id=user_id,
            plan_code=plan_code,
        )

    @staticmethod
    def create_pending_for_patient(
        *, patient_id, user_id, plan_code: str,
    ) -> MembershipSubscription:
        """A patient picks a marketplace (receiver) plan at registration."""
        return MembershipSubscriptionService.create_pending_for_provider(
            vertical=MembershipVertical.PATIENT,
            provider_id=patient_id,
            user_id=user_id,
            plan_code=plan_code,
        )

    # --- approval / activation --------------------------------------

    @staticmethod
    def activate_trial(subscription: MembershipSubscription) -> None:
        """Flip a PENDING subscription to TRIAL and start the trial clock.

        No-op (safe to call again) when the subscription is already
        past PENDING — the doctor-approval flow is allowed to fire
        the verification email more than once, so we shouldn't
        re-stamp ``trial_ends_at`` on a re-approval.
        """
        if subscription.status != MembershipSubscriptionStatus.PENDING:
            return

        now = _now()
        plan = subscription.plan  # eager-loaded via relationship
        trial_days = int(plan.trial_days or 0)
        trial_end = (
            now + timedelta(days=trial_days)
            if trial_days > 0 else now
        )

        # ``trial_days=0`` plans go straight to ACTIVE. Free-forever
        # tiers (``price_inr_monthly=0``) are also valid for ACTIVE
        # from day one — they don't need a clock.
        if trial_days > 0:
            subscription.status = MembershipSubscriptionStatus.TRIAL
            subscription.trial_ends_at = trial_end
        else:
            subscription.status = MembershipSubscriptionStatus.ACTIVE
            subscription.trial_ends_at = None

        subscription.current_period_start = now
        subscription.current_period_end = trial_end
        # Grant this plan's health credits for the (trial) period.
        try:
            from app.api.membership import credit_service
            credit_service.grant_for_subscription(subscription)
        except Exception:  # noqa: BLE001 — credit grant must never block activation
            import logging
            logging.getLogger(__name__).exception(
                '[CREDIT] grant on activate_trial failed')
        db.session.commit()

    # --- reads -------------------------------------------------------

    @staticmethod
    def get_active_for_user(user_id) -> MembershipSubscription | None:
        """Return the user's current PENDING / TRIAL / ACTIVE membership.

        At most one such row exists per user (enforced by the partial
        unique index on (provider_type, provider_id) WHERE status IN
        ('TRIAL','ACTIVE') plus the application guard in
        ``create_pending_for_doctor`` that blocks duplicate PENDING).
        """
        return (
            MembershipSubscription.query
            .filter_by(user_id=user_id, is_deleted=False)
            .filter(
                MembershipSubscription.status.in_([
                    MembershipSubscriptionStatus.PENDING,
                    MembershipSubscriptionStatus.TRIAL,
                    MembershipSubscriptionStatus.ACTIVE,
                ])
            )
            .first()
        )

    @staticmethod
    def get_current_or_lapsed_for_user(user_id) -> "MembershipSubscription | None":
        """The user's current membership INCLUDING a lapsed one — PAST_DUE /
        SUSPENDED, or an ACTIVE row whose paid period already ended. This is what
        the holding page + reactivation flow need: a member whose trial was
        ended or whose period expired must still be able to see and pay for their
        tier. Prefers the most recent non-cancelled row.
        """
        return (
            MembershipSubscription.query
            .filter_by(user_id=user_id, is_deleted=False)
            .filter(
                MembershipSubscription.status != MembershipSubscriptionStatus.CANCELLED
            )
            .order_by(MembershipSubscription.created_at.desc())
            .first()
        )

    @staticmethod
    def resolve_vertical_plan_type(tenant_id, id_or_code):
        """Look up one of the tenant's ``vertical_plan_types`` rows by id or
        by ``code``. Returns ``None`` when there's no match.

        Accepting both keeps the API usable from the UI (which holds ids)
        and from hand-written calls / scripts (which know codes like
        ``doctor``), without the caller having to guess which one the
        endpoint wants.
        """
        from app.models.membership import VerticalPlanType

        base = VerticalPlanType.query.filter_by(tenant_id=tenant_id)
        try:
            return base.filter(
                VerticalPlanType.id == uuid.UUID(str(id_or_code)),
            ).first()
        except (ValueError, AttributeError, TypeError):
            # Not a UUID — treat it as a code.
            return base.filter(
                VerticalPlanType.code == str(id_or_code),
            ).first()

    @staticmethod
    def resolve_subscription_vertical(sub, tenant_id):
        """The vertical a subscription belongs to, as a ``VerticalPlanType``
        (or None).

        Prefer the plan's own vertical. When that's missing — a legacy plan, or
        one whose vertical was deleted while re-creating it — recover it from
        the FIXED ``provider_type`` by matching a vertical whose ``code`` equals
        the provider type. So an orphaned subscription (e.g. susmitha's
        null-vertical "basic Pack") still resolves to the current doctor
        vertical, as long as that vertical keeps the ``doctor`` code.
        """
        from app.models.membership import VerticalPlanType
        plan = sub.plan
        if plan and plan.vertical_plan_type_id:
            return plan.vertical_plan_type
        return VerticalPlanType.query.filter(
            VerticalPlanType.tenant_id == tenant_id,
            db.func.lower(VerticalPlanType.code) == sub.provider_type.value.lower(),
        ).first()

    @staticmethod
    def list_for_tenant(
        tenant_id, *, vertical_plan_type=None, status=None,
    ) -> list[MembershipSubscription]:
        """Every membership subscription in one tenant, newest first.

        ``vertical_plan_type`` filters on the plan's
        ``vertical_plan_type_id`` — NOT on ``MembershipSubscription
        .provider_type``. ``provider_type`` is a fixed enum
        (doctor/clinic/hospital/patient) while ``vertical_plan_types``
        is a tenant-authored table, so filtering on the enum would make
        a subscription to a custom vertical's plan unreachable from the
        admin roster. The plan is the only place the two meet, hence
        the join.

        Accepts either a ``vertical_plan_types`` id or its ``code`` so
        callers can pass whichever they hold.

        Tenant scope is applied explicitly on top of RLS — in dev the
        app connects as a Postgres superuser that bypasses RLS, and the
        redundant filter keeps tenants isolated locally too (same
        reasoning as ``membership_plan.routes``).
        """
        query = (
            MembershipSubscription.query
            .join(
                MembershipPlan,
                MembershipSubscription.membership_plan_id == MembershipPlan.id,
            )
            .filter(
                MembershipSubscription.tenant_id == tenant_id,
                MembershipSubscription.is_deleted.is_(False),
                MembershipPlan.tenant_id == tenant_id,
            )
        )

        if vertical_plan_type:
            vpt = MembershipSubscriptionService.resolve_vertical_plan_type(
                tenant_id, vertical_plan_type,
            )
            if vpt is None:
                # Unknown vertical for this tenant — an empty roster is the
                # honest answer, not every subscription unfiltered.
                return []
            conds = [MembershipPlan.vertical_plan_type_id == vpt.id]
            # Also surface ORPHANED subscriptions — a plan whose vertical was
            # deleted (null) — whose fixed provider_type matches this vertical's
            # code, so they still appear under their real vertical tab instead
            # of vanishing from every one.
            try:
                pt = MembershipVertical(vpt.code.lower())
                conds.append(db.and_(
                    MembershipPlan.vertical_plan_type_id.is_(None),
                    MembershipSubscription.provider_type == pt,
                ))
            except (ValueError, AttributeError):
                pass  # custom vertical with no matching provider_type enum
            query = query.filter(db.or_(*conds))

        if status is not None:
            query = query.filter(MembershipSubscription.status == status)

        return query.order_by(MembershipSubscription.created_at.desc()).all()

    # --- plan changes ------------------------------------------------

    @staticmethod
    def change_plan(
        tenant_id, subscription_id, new_plan_id, *, actor_user_id=None,
    ) -> MembershipSubscription:
        """Move an existing subscription onto a different membership tier.

        Invariants, all enforced here rather than at the route layer so
        any future caller inherits them:

          * The subscription belongs to ``tenant_id``.
          * The target plan belongs to the SAME tenant.
          * The target plan sits under the SAME ``vertical_plan_type``
            as the current one — a doctor tier can't become a patient
            tier, because ``provider_type`` and the provider profile the
            row points at wouldn't match the new plan's vertical.
          * The target plan is ``active`` (no moving anyone onto a draft
            or archived tier).

        Lifecycle fields (status, trial clock, period window) are left
        untouched: this is a tier swap on a running subscription, not a
        re-subscribe. A provider mid-trial keeps their remaining days.
        """
        sub = (
            MembershipSubscription.query
            .filter_by(
                id=subscription_id, tenant_id=tenant_id, is_deleted=False,
            )
            .first()
        )
        if not sub:
            raise MembershipSubscriptionNotFound(
                f'Membership subscription "{subscription_id}" not found.'
            )
        if sub.status == MembershipSubscriptionStatus.CANCELLED:
            raise MembershipSubscriptionCancelled(
                'This membership is cancelled — it has no plan to change. '
                'Re-subscribe the provider instead.'
            )

        new_plan = (
            MembershipPlan.query
            .filter_by(id=new_plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not new_plan:
            raise MembershipPlanNotFound(
                f'Membership plan "{new_plan_id}" not found in this tenant.'
            )
        if new_plan.status != MembershipPlanStatus.ACTIVE:
            raise MembershipPlanInactive(
                f'Membership plan "{new_plan.code}" is '
                f'{new_plan.status.value}, not active. Pick a different plan.'
            )

        # Vertical guard — a subscriber can only move WITHIN their own vertical.
        # Moving a doctor onto a hospital tier is a provider migration, not a
        # plan change (their profile is still a doctor), so it's refused.
        #
        # TWO verticals are acceptable, and the second one is the point:
        #
        #   * the CURRENT PLAN's — ordinary moves up and down a ladder; and
        #   * the one matching ``provider_type``, the fixed discriminator that
        #     names which table ``provider_id`` points at.
        #
        # For a correctly-assigned row these are the same and nothing changes.
        # They diverge only on a row that is ALREADY on the wrong vertical, and
        # there the current plan is precisely the wrong thing to trust: reading
        # the vertical off it told a doctor sitting on a hospital tier that he
        # could only move to other hospital tiers, cementing the mistake with no
        # way back through the product. Admitting ``provider_type`` lets a
        # mis-assigned subscriber be moved home, which is what the guard was
        # trying to protect in the first place.
        allowed = []
        target_vpt = MembershipSubscriptionService.resolve_subscription_vertical(
            sub, tenant_id)
        if target_vpt is not None:
            allowed.append(target_vpt)
        # Resolved by CODE, not by the enum, because a tenant authors its own
        # vertical rows; a tenant that renamed or deleted the base four simply
        # contributes nothing here and the current-plan rule stands alone.
        profile_vpt = MembershipSubscriptionService.resolve_vertical_plan_type(
            tenant_id, sub.provider_type.value.lower())
        if profile_vpt is not None and profile_vpt.id not in [v.id for v in allowed]:
            allowed.append(profile_vpt)

        if allowed and new_plan.vertical_plan_type_id is not None:
            if str(new_plan.vertical_plan_type_id) not in [str(v.id) for v in allowed]:
                names = ' or '.join(v.name for v in allowed)
                raise MembershipPlanWrongVertical(
                    f'Plan "{new_plan.code}" belongs to a different vertical than '
                    f'this {sub.provider_type.value} subscriber ({names}). '
                    f'Pick a {names} plan.'
                )
        elif not allowed and new_plan.vertical_plan_type is not None:
            # Neither source resolved — fall back to matching the new plan's
            # vertical code against the provider type directly.
            new_vcode = (new_plan.vertical_plan_type.code or '').lower()
            if new_vcode and new_vcode != sub.provider_type.value.lower():
                raise MembershipPlanWrongVertical(
                    f'Plan "{new_plan.code}" is a {new_vcode} tier, but this '
                    f'subscriber is a {sub.provider_type.value}. Pick a '
                    f'{sub.provider_type.value} plan.'
                )

        if sub.membership_plan_id != new_plan.id:
            sub.membership_plan_id = new_plan.id
            if actor_user_id is not None:
                sub.updated_by_id = actor_user_id
            db.session.commit()
        return sub

    # --- plan-based provider assignment + paid activation ------------

    @staticmethod
    def resolve_for_doctor(tenant_id, doctor_id):
        """The doctor's live (non-cancelled) membership subscription, if any.

        Prefers a TRIAL/ACTIVE/PENDING/PAST_DUE row over a cancelled one so an
        admin re-assigning a plan reuses the running subscription instead of
        stacking a second.
        """
        return (
            MembershipSubscription.query
            .filter_by(
                tenant_id=tenant_id,
                provider_type=MembershipVertical.DOCTOR,
                provider_id=doctor_id,
                is_deleted=False,
            )
            .filter(MembershipSubscription.status
                    != MembershipSubscriptionStatus.CANCELLED)
            .order_by(MembershipSubscription.created_at.desc())
            .first()
        )

    @staticmethod
    def assign_plan_for_doctor(
        tenant_id, doctor_id, new_plan_id, *, actor_user_id=None,
    ) -> MembershipSubscription:
        """Admin: put a plan-based doctor onto a membership tier.

        If the doctor already holds a subscription, this swaps the tier (via
        ``change_plan``). If not — the common case, since converting a doctor
        to plan-based doesn't itself create a subscription — a fresh one is
        created and its trial started, so the doctor lands on the tier and can
        pay to activate immediately (they may also pay during the trial).
        """
        from app.models import Doctor, DoctorBillingType
        from app.api.common.payment import billing_service as bsvc

        new_plan = (
            MembershipPlan.query
            .filter_by(id=new_plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not new_plan:
            raise MembershipPlanNotFound(
                f'Membership plan "{new_plan_id}" not found in this tenant.')
        if new_plan.status != MembershipPlanStatus.ACTIVE:
            raise MembershipPlanInactive(
                f'Membership plan "{new_plan.code}" is {new_plan.status.value}, '
                'not active. Pick a different plan.')

        # Billing types are mutually exclusive: only a PLAN-based doctor can be
        # put on a membership tier. An employee / consultant must be converted
        # to plan-based first (their salary/retainer engagement would otherwise
        # co-exist with a membership tier).
        gate_doctor = Doctor.query.filter_by(
            id=doctor_id, tenant_id=tenant_id).first()
        if not gate_doctor:
            raise MembershipSubscriptionNotFound(
                f'Doctor "{doctor_id}" not found in this tenant.')
        bt = bsvc.current_billing_type(gate_doctor)
        if bt != DoctorBillingType.PLAN:
            raise MembershipPlanWrongVertical(
                f'This doctor is {bt.value}-based, not plan-based. Convert them '
                'to plan-based (in the doctor\'s billing settings) before '
                'assigning a membership tier.')

        # Vertical guard for a NEW subscription — a doctor can only be put on a
        # DOCTOR-vertical tier. Assigning a hospital/clinic tier to a doctor is a
        # provider migration, not a plan assignment (the profile is still a
        # doctor), so it's refused. (change_plan enforces the same for existing
        # subscribers; this closes the gap on the first-time assign path.)
        new_vpt = new_plan.vertical_plan_type
        new_vcode = (new_vpt.code or '').lower() if new_vpt else None
        if new_vcode and new_vcode != MembershipVertical.DOCTOR.value.lower():
            raise MembershipPlanWrongVertical(
                f'Plan "{new_plan.code}" is a {new_vcode} tier — it cannot be '
                'assigned to a doctor. Pick a doctor plan.')

        existing = MembershipSubscriptionService.resolve_for_doctor(
            tenant_id, doctor_id)
        if existing:
            return MembershipSubscriptionService.change_plan(
                tenant_id, existing.id, new_plan.id,
                actor_user_id=actor_user_id)

        doctor = Doctor.query.filter_by(
            id=doctor_id, tenant_id=tenant_id).first()
        if not doctor:
            raise MembershipSubscriptionNotFound(
                f'Doctor "{doctor_id}" not found in this tenant.')

        sub = MembershipSubscriptionService.create_pending_for_provider(
            vertical=MembershipVertical.DOCTOR,
            provider_id=doctor_id,
            user_id=doctor.user_id,
            plan_code=new_plan.code,
        )
        # Start the trial clock so the doctor lands on the tier immediately
        # (a trial_days=0 plan goes straight to ACTIVE inside activate_trial).
        MembershipSubscriptionService.activate_trial(sub)
        return sub

    @staticmethod
    def resolve_for_provider(tenant_id, vertical, entity_id):
        """The entity's live (non-cancelled) membership subscription, if any —
        the vertical-agnostic version of :meth:`resolve_for_doctor`."""
        return (
            MembershipSubscription.query
            .filter_by(
                tenant_id=tenant_id,
                provider_type=vertical,
                provider_id=entity_id,
                is_deleted=False,
            )
            .filter(MembershipSubscription.status
                    != MembershipSubscriptionStatus.CANCELLED)
            .order_by(MembershipSubscription.created_at.desc())
            .first()
        )

    @staticmethod
    def _resolve_entity_user(tenant_id, vertical, entity_id):
        """``(entity, user_id)`` for a vertical's assignable entity.

        The user the membership + credit wallet attach to differs by vertical:
        a doctor / patient carry ``user_id`` directly; a clinic / hospital carry
        their facility ``admin_user_id``. Returns ``(None, None)`` when the
        entity isn't found in this tenant.
        """
        from app.models import Doctor, Clinic, Hospital, Patient
        if vertical == MembershipVertical.DOCTOR:
            e = Doctor.query.filter_by(id=entity_id, tenant_id=tenant_id).first()
            return e, (getattr(e, 'user_id', None) if e else None)
        if vertical == MembershipVertical.CLINIC:
            e = Clinic.query.filter_by(id=entity_id, tenant_id=tenant_id).first()
            return e, (getattr(e, 'admin_user_id', None) if e else None)
        if vertical == MembershipVertical.HOSPITAL:
            e = Hospital.query.filter_by(id=entity_id, tenant_id=tenant_id).first()
            return e, (getattr(e, 'admin_user_id', None) if e else None)
        if vertical == MembershipVertical.PATIENT:
            # The PK column is ``patient_id`` but the ORM attribute is ``id``.
            e = Patient.query.filter_by(
                id=entity_id, tenant_id=tenant_id).first()
            return e, (getattr(e, 'user_id', None) if e else None)
        return None, None

    @staticmethod
    def assign_plan_for_provider(
        tenant_id, vertical, entity_id, new_plan_id, *, actor_user_id=None,
    ) -> MembershipSubscription:
        """Admin: put ANY vertical's entity (doctor / clinic / hospital /
        patient) onto a membership tier. Swaps the tier when a subscription
        exists, else creates one and starts its trial. Generalises
        :meth:`assign_plan_for_doctor` — the doctor billing-type guard still
        applies to the DOCTOR vertical only.
        """
        new_plan = (
            MembershipPlan.query
            .filter_by(id=new_plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not new_plan:
            raise MembershipPlanNotFound(
                f'Membership plan "{new_plan_id}" not found in this tenant.')
        if new_plan.status != MembershipPlanStatus.ACTIVE:
            raise MembershipPlanInactive(
                f'Membership plan "{new_plan.code}" is {new_plan.status.value}, '
                'not active. Pick a different plan.')

        # The plan's vertical must match the entity's.
        new_vpt = new_plan.vertical_plan_type
        new_vcode = (new_vpt.code or '').lower() if new_vpt else None
        if new_vcode and new_vcode != vertical.value.lower():
            raise MembershipPlanWrongVertical(
                f'Plan "{new_plan.code}" is a {new_vcode} tier — it cannot be '
                f'assigned to a {vertical.value}. Pick a {vertical.value} plan.')

        entity, user_id = MembershipSubscriptionService._resolve_entity_user(
            tenant_id, vertical, entity_id)
        if not entity:
            raise MembershipSubscriptionNotFound(
                f'{vertical.value.title()} "{entity_id}" not found in this tenant.')
        if not user_id:
            raise MembershipSubscriptionNotFound(
                f'This {vertical.value} has no linked user account to attach a '
                'membership to.')

        # Doctors: only a PLAN-based one can go on a membership tier.
        if vertical == MembershipVertical.DOCTOR:
            from app.models import DoctorBillingType
            from app.api.common.payment import billing_service as bsvc
            bt = bsvc.current_billing_type(entity)
            if bt != DoctorBillingType.PLAN:
                raise MembershipPlanWrongVertical(
                    f'This doctor is {bt.value}-based, not plan-based. Convert '
                    'them to plan-based before assigning a membership tier.')

        existing = MembershipSubscriptionService.resolve_for_provider(
            tenant_id, vertical, entity_id)
        if existing:
            return MembershipSubscriptionService.change_plan(
                tenant_id, existing.id, new_plan.id,
                actor_user_id=actor_user_id)

        sub = MembershipSubscriptionService.create_pending_for_provider(
            vertical=vertical, provider_id=entity_id, user_id=user_id,
            plan_code=new_plan.code,
        )
        MembershipSubscriptionService.activate_trial(sub)
        return sub

    @staticmethod
    def quote_change(tenant_id, subscription_id, new_plan_id, period, now=None):
        """Price a self-service activate / renew / upgrade for the doctor.

        Returns ``(subscription, new_plan, quote_dict)``. Raises the usual
        not-found / inactive errors, or ``proration.PlanChangeError`` when the
        move isn't payable (unavailable period, or a mid-cycle downgrade).
        """
        from app.api.membership import proration

        now = now or _now()
        sub = (
            MembershipSubscription.query
            .filter_by(id=subscription_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not sub:
            raise MembershipSubscriptionNotFound(
                f'Membership subscription "{subscription_id}" not found.')
        if sub.status == MembershipSubscriptionStatus.CANCELLED:
            raise MembershipSubscriptionCancelled(
                'This membership is cancelled — re-subscribe first.')

        new_plan = (
            MembershipPlan.query
            .filter_by(id=new_plan_id, tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not new_plan:
            raise MembershipPlanNotFound(
                f'Membership plan "{new_plan_id}" not found in this tenant.')
        if new_plan.status != MembershipPlanStatus.ACTIVE:
            raise MembershipPlanInactive(
                f'Membership plan "{new_plan.code}" is {new_plan.status.value}, '
                'not active.')

        quote = proration.quote_change(sub, new_plan, period, now)
        return sub, new_plan, quote

    @staticmethod
    def apply_paid_activation(
        tenant_id, subscription_id, new_plan_id, period, *,
        now=None, actor_user_id=None,
    ) -> MembershipSubscription:
        """Commit a paid activation/renewal/upgrade after payment succeeds.

        Re-prices server-side (never trusts a client amount), swaps the tier,
        records the paid period, flips the subscription to ACTIVE and opens the
        new period window. Idempotent-safe to the extent the caller guards on
        the Payment already being verified.
        """
        from app.api.membership import proration

        now = now or _now()
        sub, new_plan, quote = MembershipSubscriptionService.quote_change(
            tenant_id, subscription_id, new_plan_id, period, now)

        sub.membership_plan_id = new_plan.id
        sub.plan_period = period
        sub.status = MembershipSubscriptionStatus.ACTIVE
        sub.trial_ends_at = None  # a paid activation consumes any trial
        sub.current_period_start = quote['new_period_start']
        sub.current_period_end = quote['new_period_end']
        if actor_user_id is not None:
            sub.updated_by_id = actor_user_id
        # Reset the health-credit wallet with this period's grant (no rollover).
        try:
            from app.api.membership import credit_service
            credit_service.grant_for_subscription(sub)
        except Exception:  # noqa: BLE001 — never block a paid activation
            import logging
            logging.getLogger(__name__).exception(
                '[CREDIT] grant on paid activation failed')
        db.session.commit()
        return sub

    # --- internals ---------------------------------------------------

    @staticmethod
    def _resolve_active_plan(
        plan_code: str, *, expected_vertical: MembershipVertical,
    ) -> MembershipPlan:
        plan = (
            MembershipPlan.query
            .filter_by(code=plan_code, is_deleted=False)
            .first()
        )
        if not plan:
            raise MembershipPlanNotFound(
                f'Membership plan "{plan_code}" not found.'
            )
        if plan.status != MembershipPlanStatus.ACTIVE:
            raise MembershipPlanInactive(
                f'Membership plan "{plan_code}" is {plan.status.value}, '
                'not active. Pick a different plan.'
            )
        # The vertical guard went dead when ``vertical`` became the
        # ``vertical_plan_type`` FK — ``expected_vertical`` was accepted
        # and ignored, so a signup URL tampered to another vertical's
        # plan code sailed through. Compare against the FK's code (the
        # tenant-defined vertical vocabulary).
        if expected_vertical is not None:
            vpt_code = (plan.vertical_plan_type.code.lower()
                        if plan.vertical_plan_type else None)
            expected = getattr(expected_vertical, 'value', expected_vertical)
            if vpt_code != str(expected).lower():
                raise MembershipPlanWrongVertical(
                    f'Membership plan "{plan_code}" is for '
                    f'{vpt_code or "an unassigned vertical"}, not {expected}.'
                )
        return plan
