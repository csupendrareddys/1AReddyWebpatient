"""ResellerService — an apex tenant operating its own tenants.

Thin orchestration over the pieces that already exist: plan CRUD via
``PlanCatalogService`` (owner-scoped), child creation via
``PlatformTenantService.create_tenant`` (with ``parent_tenant_id`` +
a pre-resolved owner-namespace plan injected) and
``SuperAdminService.create_admin`` — the same machinery the vendor
console uses, so seat limits, landing seeds, DNS sync and the
"workspace is live" notify behave identically for a reseller's child.

Children are SLUG-ONLY in P2: they resolve under the platform's
``CLOUDFLARE_BASE_DOMAIN`` as a placeholder until P4 moves them onto
the apex tenant's own zone (apex-owned Cloudflare). ``domain`` is
deliberately not accepted here yet; the custom-domain quota is
enforced at DomainVerificationService.set_pending either way.
"""
import logging

from app.api.pricing.plan_catalog_service import PlanCatalogService
from app.api.pricing.service import ResellerPolicy
from app.extensions import db

logger = logging.getLogger(__name__)


class ChildPlanNotFound(Exception):
    pass


class ResellerService:

    @staticmethod
    def child_rows(apex_id):
        """Children with their subscription summary (platform tenants-list
        row shape, so the UI column treatment carries over)."""
        from app.models import Tenant, TenantSubscription
        from app.common.tenant_context import with_tenant_context

        children = (
            Tenant.query
            .filter_by(parent_tenant_id=apex_id, is_deleted=False)
            .order_by(Tenant.created_at.asc())
            .all()
        )
        rows = []
        for child in children:
            row = child.to_dict()
            with with_tenant_context(str(child.id)):
                sub = (
                    TenantSubscription.query
                    .filter_by(tenant_id=child.id, is_deleted=False)
                    .first()
                )
                row['subscription'] = None
                if sub is not None:
                    row['subscription'] = {
                        'plan_code': sub.plan.code if sub.plan else None,
                        'plan_name': sub.plan.name if sub.plan else None,
                        'status': sub.status.value,
                        'billing_cycle': sub.billing_cycle.value,
                        'trial_ends_at': (sub.trial_ends_at.isoformat()
                                          if sub.trial_ends_at else None),
                        'current_period_end': (
                            sub.current_period_end.isoformat()
                            if sub.current_period_end else None),
                    }
            rows.append(row)
        return rows

    @staticmethod
    def quota_summary(apex_id):
        return {
            'is_apex': True,
            'quotas': {
                'subdomains': {
                    'used': ResellerPolicy.child_counts(apex_id)['subdomains'],
                    'allowed': ResellerPolicy.child_quotas(apex_id)['subdomains'],
                },
                'custom_domains': {
                    'used': ResellerPolicy.child_counts(apex_id)['custom_domains'],
                    'allowed': ResellerPolicy.child_quotas(apex_id)['custom_domains'],
                },
            },
            'plans_authored': len(
                PlanCatalogService.list_plans(owner_tenant_id=apex_id)),
        }

    CAP_FIELDS = (
        ('max_total_users', 'total'),
        ('max_super_admins', 'super_admin'),
        ('max_sub_admins', 'sub_admin'),
        ('max_providers', 'provider'),
        ('max_provider_doctors', 'doctor'),
        ('max_provider_clinics', 'clinic'),
        ('max_provider_hospitals', 'hospital'),
    )

    @staticmethod
    def apex_child_caps(apex_id):
        """The apex plan's raw ``child_plan_caps`` (snapshot-first —
        catalog edits never change what a subscriber bought)."""
        from app.models import TenantSubscription
        sub = TenantSubscription.query.filter_by(
            tenant_id=apex_id, is_deleted=False).first()
        snap = sub.plan_snapshot if (
            sub is not None and isinstance(sub.plan_snapshot, dict)) else {}
        caps = snap.get('child_plan_caps')
        if caps is None and sub is not None and sub.plan is not None:
            caps = sub.plan.child_plan_caps
        return caps or {}

    @staticmethod
    def track_ceilings(caps, tracks):
        """Per-cap-key ceilings for a child occupying ``tracks``.

        Two shapes are accepted:
        * legacy flat ``{total, super_admin, sub_admin, provider}`` —
          the same ceiling applies to every track;
        * two-track ``{subdomain: {...}, custom_domain: {...}}`` where
          each track carries the four seat keys plus the three entity
          keys (doctor/clinic/hospital).

        The ceiling is the MAX over the occupied tracks; a key absent
        from any occupied track means UNCAPPED for that key (every
        tenant has a subdomain, and attaching a custom domain later may
        only ever RAISE a ceiling — never invalidate a running child).
        Returns ``{cap_key: int}`` with uncapped keys omitted.
        """
        if not isinstance(caps, dict) or not caps:
            return {}
        two_track = ('subdomain' in caps) or ('custom_domain' in caps)
        out = {}
        for _, key in ResellerService.CAP_FIELDS:
            vals = []
            uncapped = False
            for track in tracks:
                d = caps.get(track) if two_track else caps
                v = d.get(key) if isinstance(d, dict) else None
                if v is None:
                    uncapped = True
                    break
                try:
                    vals.append(int(v))
                except (TypeError, ValueError):
                    uncapped = True
                    break
            if uncapped or not vals:
                continue
            out[key] = max(vals)
        return out

    @staticmethod
    def plan_track_violations(apex_id, plan, tracks):
        """Field errors when ``plan``'s effective values exceed the
        ceilings for a child occupying ``tracks``. Used at child
        creation (the authoring clamp validates against the loosest
        track; a specific child must fit ITS OWN track)."""
        ceilings = ResellerService.track_ceilings(
            ResellerService.apex_child_caps(apex_id), tracks)
        errors = {}
        for field_name, key in ResellerService.CAP_FIELDS:
            cap = ceilings.get(key)
            if cap is None:
                continue
            raw = getattr(plan, field_name, None)
            if raw is None:
                continue
            try:
                val = int(raw)
            except (TypeError, ValueError):
                continue
            if val == -1 or val > cap:
                shown = 'unlimited' if val == -1 else val
                errors[field_name] = (
                    f'This plan grants {shown}, but your plan allows at '
                    f'most {cap} per {"/".join(tracks)} tenant.')
        return errors

    @staticmethod
    def create_child_tenant(apex_id, payload, *, created_by_user):
        """Create a child tenant + its first SUPER_ADMIN on one of the
        apex's OWN plans. Caller has already checked apex-ness; this
        checks quota + plan ownership and sets parentage server-side.

        Raises: ChildPlanNotFound, ChildQuotaExceeded, ValueError
        (slug conflicts from _free_or_reject / admin duplicates),
        FieldValidationError, PlanLimitExceeded (admin seat).
        """
        from app.api.platform.service import PlatformTenantService
        from app.api.admin.super_admin.service import SuperAdminService
        from app.models._enums import PlanKind, PlanStatus

        # Plan must be OWNED by this apex, normal-kind, ACTIVE (a draft
        # plan isn't sellable — same rule as public signup).
        plan = PlanCatalogService.get_plan(
            payload['plan_code'], owner_tenant_id=apex_id)
        if (plan is None or plan.kind != PlanKind.NORMAL
                or plan.status != PlanStatus.ACTIVE):
            raise ChildPlanNotFound()

        # Quota: slug-only children always consume a subdomain slot.
        ResellerPolicy.assert_child_slot(apex_id, 'subdomains')

        # Track fit: a fresh child occupies the SUBDOMAIN track (every
        # tenant gets a subdomain; a custom domain only raises ceilings
        # later). The authoring clamp allows plans up to the LOOSEST
        # track, so a plan sized for custom-domain children must not be
        # sold to a subdomain-only child.
        violations = ResellerService.plan_track_violations(
            apex_id, plan, ('subdomain',))
        if violations:
            from app.api.admin.super_admin.service import (
                FieldValidationError,
            )
            field, message = next(iter(violations.items()))
            raise FieldValidationError(field, message)

        tenant = PlatformTenantService.create_tenant({
            'name': payload['name'],
            'slug': payload['slug'],
            '_plan': plan,
            'billing_cycle': payload.get('billing_cycle', 'monthly'),
            'parent_tenant_id': apex_id,
            'auto_subdomain': True,
        })

        admin_payload = dict(payload['admin'])
        admin_payload['role'] = 'super_admin'
        user, admin = SuperAdminService.create_admin(
            admin_payload, created_by_user=created_by_user,
            tenant_id=tenant.id,
        )
        PlatformTenantService.notify_tenant_ready(tenant, user)
        return tenant, user, admin

    @staticmethod
    def update_child(apex_id, child_id, payload):
        """Whitelisted child edits: rename, suspend/reactivate, and a
        PLAN CHANGE (``plan_code`` — the chain's "assign to L2" step).
        Returns the updated tenant or None when the child isn't ours.

        A plan change re-points the child's subscription and rebuilds
        its snapshot (grandfathering restarts on the new plan). The new
        plan is clamped to the CHILD'S OWN tracks, so a custom-domain-
        sized plan can't be put on a subdomain-only child. Children are
        seller-billed, so no payment leg — effective immediately.

        Raises ChildPlanNotFound / FieldValidationError.
        """
        from app.api.platform.service import PlatformTenantService
        from app.models import Tenant

        child = Tenant.query.filter_by(
            id=child_id, parent_tenant_id=apex_id, is_deleted=False,
        ).first()
        if child is None:
            return None

        if (payload.get('plan_code') or '').strip():
            ResellerService._change_child_plan(
                apex_id, child, payload['plan_code'].strip(),
                billing_cycle=payload.get('billing_cycle'))

        allowed = {}
        if 'name' in payload and (payload['name'] or '').strip():
            allowed['name'] = payload['name'].strip()
        if payload.get('status') in ('active', 'inactive'):
            allowed['status'] = payload['status']
        if allowed:
            # Reuses the platform update path (DNS deprovision on
            # non-active, denylist, re-sync) — scoping was done above.
            PlatformTenantService.update_tenant(str(child.id), allowed)
            db.session.refresh(child)
        return child

    @staticmethod
    def _change_child_plan(apex_id, child, plan_code, billing_cycle=None):
        from app.api.pricing.plan_catalog_service import (
            PlanCatalogService, build_plan_snapshot,
        )
        from app.models import TenantSubscription
        from app.models._enums import BillingCycle, PlanKind, PlanStatus

        plan = PlanCatalogService.get_plan(
            plan_code, owner_tenant_id=apex_id)
        if (plan is None or plan.kind != PlanKind.NORMAL
                or plan.status != PlanStatus.ACTIVE):
            raise ChildPlanNotFound()

        tracks = ['subdomain']
        if getattr(child, 'domain', None):
            tracks.append('custom_domain')
        violations = ResellerService.plan_track_violations(
            apex_id, plan, tuple(tracks))
        if violations:
            from app.api.admin.super_admin.service import (
                FieldValidationError,
            )
            field, message = next(iter(violations.items()))
            raise FieldValidationError(field, message)

        sub = TenantSubscription.query.filter_by(
            tenant_id=child.id, is_deleted=False).first()
        if sub is None:
            raise ChildPlanNotFound()
        sub.plan_id = plan.id
        sub.plan_snapshot = build_plan_snapshot(plan)
        if billing_cycle in ('monthly', 'quarterly', 'semi_annual',
                             'annual', 'biennial', 'triennial'):
            sub.billing_cycle = BillingCycle(billing_cycle)
        db.session.commit()
