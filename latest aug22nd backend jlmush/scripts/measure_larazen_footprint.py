"""Measure the apex tenant's real footprint, to size its plan honestly.

The apex has always been exempt (``is_default`` bypass), so nothing about
what it actually consumes was ever recorded. This reports the real numbers
so ``scripts/split_apex_tenant.py`` can build a plan with concrete limits
instead of ``-1`` sentinels.

Read-only. Run:
  docker exec -w /app -e PYTHONPATH=/app jlmush-backend \
      python scripts/measure_larazen_footprint.py
"""
import json

from app import create_app
from app.extensions import db
from app.models import Tenant, User
from app.models._enums import UserRole
from app.api.pricing.service import PlanService, ALLOWED_FEATURE_PATHS


def main():
    app = create_app()
    with app.app_context():
        t = Tenant.query.filter_by(is_platform=True).first()
        if t is None:
            raise SystemExit('No is_platform tenant found.')
        tid = t.id
        out = {'tenant': {'id': str(tid), 'slug': t.slug, 'name': t.name}}

        # ── Seats ────────────────────────────────────────────────────
        out['seats'] = PlanService.current_counts(tid)

        # Full role breakdown, including roles the seat model ignores.
        rows = (
            db.session.query(User.role, db.func.count(User.id))
            .filter(User.tenant_id == tid, User.is_deleted.is_(False))
            .group_by(User.role).all()
        )
        out['users_by_role'] = {r.value: int(n) for r, n in rows}

        # ── Provider entities (the per-vertical quotas) ───────────────
        from app.models import Doctor, Clinic, Hospital
        ent = {}
        for key, model in (
            ('doctors', Doctor), ('clinics', Clinic), ('hospitals', Hospital),
        ):
            q = model.query.filter_by(tenant_id=tid)
            if hasattr(model, 'is_deleted'):
                q = q.filter(model.is_deleted.is_(False))
            ent[key] = q.count()
        out['provider_entities'] = ent

        # ── Marketplace footprint (drives the membership feature paths) ──
        from app.models.membership import MembershipPlan, VerticalPlanType
        vpts = VerticalPlanType.query.filter_by(tenant_id=tid).all()
        out['verticals'] = [v.code for v in vpts]
        mp_rows = (
            db.session.query(VerticalPlanType.code, db.func.count(MembershipPlan.id))
            .join(MembershipPlan, MembershipPlan.vertical_plan_type_id == VerticalPlanType.id)
            .filter(MembershipPlan.tenant_id == tid,
                    MembershipPlan.is_deleted.is_(False))
            .group_by(VerticalPlanType.code).all()
        )
        out['membership_plans_by_vertical'] = {c: int(n) for c, n in mp_rows}

        from app.models.tenant_provider_plan import TenantProviderPlan
        out['tenant_provider_plans'] = (
            TenantProviderPlan.query
            .filter_by(tenant_id=tid).filter(TenantProviderPlan.is_deleted.is_(False))
            .count()
        )

        # ── Usage counters (drives usage_limits) ─────────────────────
        from app.models.plan import TenantUsageCounter
        uc = (
            db.session.query(TenantUsageCounter.metric,
                             db.func.max(TenantUsageCounter.count))
            .filter(TenantUsageCounter.tenant_id == tid)
            .group_by(TenantUsageCounter.metric).all()
        )
        out['peak_usage_by_metric'] = {m: int(n) for m, n in uc}

        # ── What the current plan1 already grants ────────────────────
        try:
            resolved = PlanService.resolve(tid)
            granted = sorted(
                p for p in ALLOWED_FEATURE_PATHS
                if _walk(resolved.features, p)
            )
            out['current_plan'] = {
                'code': resolved.plan_code,
                'limits': dict(resolved.limits or {}),
                'granted_feature_count': len(granted),
                'total_feature_paths': len(ALLOWED_FEATURE_PATHS),
                'NOT_granted': sorted(set(ALLOWED_FEATURE_PATHS) - set(granted)),
            }
        except Exception as e:  # noqa: BLE001
            out['current_plan'] = {'error': f'{type(e).__name__}: {e}'}

        print(json.dumps(out, indent=2, sort_keys=False))


def _walk(tree, path):
    from app.api.pricing.service import _walk_to_leaf
    return _walk_to_leaf(tree, path)


if __name__ == '__main__':
    main()
