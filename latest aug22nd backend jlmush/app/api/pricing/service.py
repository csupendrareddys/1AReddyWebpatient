"""Pricing service layer.

Owns:
    * The :data:`ALLOWED_FEATURE_PATHS` whitelist — source of truth for every
      dotted feature path that may appear anywhere (plan, add-on, override).
    * :class:`PlanService` — resolve a tenant's effective plan, check limits.
    * :class:`FeatureGate`, :class:`DomainPolicy`, :class:`PaymentResolver` —
      thin policy classes so callers never inspect feature-path prefixes.
    * Custom exceptions translated by routes into HTTP 402 / 403 responses.

Resolution order: ``Plan < Add-ons < Overrides``. Limits from add-ons are
additive; overrides replace (authoritative).
"""
from __future__ import annotations

import copy
import logging
import types
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from flask import g, has_request_context
from sqlalchemy import func

from app.extensions import db
from app.models._base import utcnow
from app.models._enums import (
    AddonSubscriptionStatus, OverLimitAction, PlanStatus,
    SubscriptionStatus, UserRole,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Feature-path whitelist — source of truth
# --------------------------------------------------------------------------- #

ALLOWED_FEATURE_PATHS = frozenset({
    # ── Core (Plan A baseline) ──────────────────────────────
    'patient.basic_info',
    'patient.vitals',
    'patient.documents',
    'patient.family',
    'patient.intake_forms',
    'patient.health_records',
    'doctor.profile',
    'doctor.calendar',
    'doctor.pricing',
    'doctor.prescriptions',
    'doctor.prescriptions_pdf',
    'doctor.follow_up',
    'doctor.attendance',
    'doctor.analytics',
    'admin.manage_users',
    'admin.page_configuration',
    'admin.landing_builder',
    'admin.field_approval',
    'admin.audit_logs',
    'admin.billing_config',
    # ── Admin invite add-ons ─────────────────────────────────
    # Round 9: tenant admin / doctor surfaces for creating
    # doctors, patients, hospitals, and clinics on the
    # tenant's roster (each with a /auth/activate token-based
    # onboarding link). Plan-gated so the platform owner can
    # bundle them per tier; the apex tenant gets all four for
    # free via the ``Tenant.is_platform = True`` bypass in
    # FeatureGate. ``admin.invite_patient`` is also consumed
    # by the doctor-side ``POST /doctor/patients/invite`` —
    # one feature path, two callers, same intent.
    'admin.invite_doctor',
    'admin.invite_patient',
    'admin.invite_hospital',
    'admin.invite_clinic',
    # ── Consultation modes ──────────────────────────────────
    'consultation.in_person',
    'consultation.video',
    'consultation.audio',
    'consultation.chat',
    'consultation.home_visit',
    'consultation.camp',
    # ── Marketplace offerings a provider may run ────────────
    # Access control for standalone services and team-delivered group
    # offerings — gate whether a plan lets a provider offer them.
    'service.offer',
    'group_offering.offer',
    # ── Organisation-wide (legacy ``clinic.*`` prefix kept as alias) ─
    # SaaS now serves clinics + hospitals + solo doctor practices, so
    # "clinic" is too narrow — new add-ons should use ``organization.*``.
    # ``PlanService.resolve`` mirrors truthy keys between the two
    # prefixes (see ``_apply_organization_clinic_alias``) so legacy plan
    # rows with ``clinic.*`` keep working and a tenant whose plan has
    # ``organization.marketplace`` also gets ``clinic.marketplace``
    # honored by any legacy FeatureGuard check still pointed at the
    # old path.
    'clinic.multi_location',
    'clinic.feedback',
    'clinic.marketplace',
    'clinic.doctor_payouts',
    'organization.multi_location',
    'organization.feedback',
    'organization.marketplace',
    'organization.doctor_payouts',
    # ── Marketplace participation (apex larazen.in) ─────────
    # Authored by the platform owner as SaaS add-ons; a tenant
    # attaches one and the marketplace surface unlocks inside their
    # tenant. Each path stands alone so the operator can bundle
    # whichever combination matches their pricing tier (Doctor
    # Starter / Growth / Pro, Clinic Basic / Growth / Pro, …).
    'marketplace.doctor.listing',
    'marketplace.clinic.listing',
    'marketplace.hospital.listing',
    'marketplace.priority_placement',
    'marketplace.white_label_profile',
    'marketplace.continuous_care_timeline',
    'marketplace.network_referrals',
    'marketplace.ai_clinical_summaries',
    'marketplace.lab_integration',
    'marketplace.pharmacy_integration',
    'marketplace.multi_branch',
    'marketplace.cross_branch_continuous_care',
    'marketplace.api_ecosystem',
    # ── Tenant-scoped provider catalog (in-tenant marketplace) ────
    # When a tenant attaches these add-ons, their super-admin gains
    # the ability to author plan tiers for providers REGISTERING
    # INSIDE THEIR OWN SUBDOMAIN (e.g. ``acme.larazen.in``). The
    # tenant's authored plans never appear on the apex larazen.in
    # marketplace — they're internal to that one tenant.
    #
    # If the add-on is absent: providers in that tenant register
    # directly without picking a plan (no tiers).
    # If the add-on is present but the tenant hasn't authored any
    # plans yet: same — direct registration.
    # If present AND ≥1 plan authored: plan selection is required
    # at provider signup inside the tenant.
    #
    # Per-vertical so the platform owner can sell, e.g., "you can
    # offer doctor plans but not hospital plans" packages.
    'tenant.can_create_doctor_plans',
    'tenant.can_create_clinic_plans',
    'tenant.can_create_hospital_plans',
    # Marketplace MEMBERSHIP plans (the "who pays us" catalog) —
    # per-vertical, mirroring the provider-plan add-ons above. A tenant
    # holding one of these can author membership tiers for that vertical
    # under /api/membership-plans. The apex/default tenant is auto-entitled
    # via FeatureGate's is_platform bypass.
    'tenant.can_create_membership_doctor_plans',
    'tenant.can_create_membership_clinic_plans',
    'tenant.can_create_membership_hospital_plans',
    # ── Communication ───────────────────────────────────────
    'communication.sms',
    'communication.email',
    'communication.custom_email',
    'communication.custom_sms',
    # Service Communication module — communication bundled INTO an admin
    # Service/Product (nutrition package, wellness plan, ...). A purchase gets
    # its own channel. Distinct from ``consultation.chat``, which gates the
    # appointment-based consultation flow and is untouched by this module.
    'communication.channel',
    'communication.scheduled_calls',
    'communication.documents',
    # ── Payments ────────────────────────────────────────────
    'payments.razorpay',
    'payments.tenant_keys',
    'payments.multi_currency',
    # ── Domain / hosting ────────────────────────────────────
    'domain.subdomain',
    'domain.custom_domain',
    # ── Internationalisation ────────────────────────────────
    'i18n.multi_language',
})


# --------------------------------------------------------------------------- #
# Vertical-scoped whitelist for the in-tenant provider-plan editor.
# --------------------------------------------------------------------------- #
# ``ALLOWED_FEATURE_PATHS`` above is the superset used by the platform-owner
# pricing UI (tenant SaaS subscriptions). Tenant SUPER_ADMINs authoring
# in-tenant DOCTOR / CLINIC / HOSPITAL plans must see a much narrower set:
# features that govern what a provider DOES inside the tenant, not what the
# tenant itself can do.
#
# Why: tenant-level capabilities (subdomain, custom_domain, landing builder,
# page configuration, can_create_*_plans, marketplace listings,
# payment-gateway config, SMS/email config, i18n) are properties of the
# tenant's SaaS subscription with larazen — they're decided when the tenant
# bought their SaaS plan. Re-exposing them on a hospital plan would suggest
# each hospital inside a tenant could spin up its own subdomain or author
# its own marketplace listing, which is wrong. A hospital inside a tenant
# is a collection of doctors working together; its plan should govern
# doctor management, consultation modes, patient records, and facility-level
# org features only.
#
# Consumed by ``/api/tenant-provider-plans/feature-paths?vertical=<v>``
# (route layer in ``app/api/tenant_provider_plan/routes.py``).

_DOCTOR_TENANT_PATHS = frozenset({
    # Doctor's own surface
    'doctor.profile', 'doctor.calendar', 'doctor.pricing',
    'doctor.prescriptions', 'doctor.prescriptions_pdf',
    'doctor.follow_up', 'doctor.attendance', 'doctor.analytics',
    # Consultation modes the doctor offers
    'consultation.in_person', 'consultation.video', 'consultation.audio',
    'consultation.chat', 'consultation.home_visit', 'consultation.camp',
    # Marketplace offerings the provider may run (access control for
    # standalone services + team-delivered group offerings)
    'service.offer', 'group_offering.offer',
    # Patient data the doctor manages on behalf of their patients
    'patient.basic_info', 'patient.vitals', 'patient.documents',
    'patient.family', 'patient.health_records', 'patient.intake_forms',
    # Doctor inviting a patient onto the tenant (the doctor-side route is
    # role-gated to DOCTOR; the path appears here so the tenant can decide
    # which doctor tier gets the capability)
    'admin.invite_patient',
})

_FACILITY_EXTRA_PATHS = frozenset({
    # On top of the doctor superset, facility admins (hospital / clinic)
    # can also invite their own doctors + manage org-level features:
    'admin.invite_doctor',
    # Facility-level organization features (multi_location, payouts,
    # feedback). Apex-marketplace listings (``organization.marketplace``
    # / ``clinic.marketplace``) are deliberately excluded — those are
    # apex-only concepts.
    'organization.multi_location', 'organization.doctor_payouts',
    'organization.feedback',
    'clinic.multi_location', 'clinic.doctor_payouts', 'clinic.feedback',
})

PROVIDER_FEATURE_PATHS_BY_VERTICAL = {
    'doctor': frozenset(_DOCTOR_TENANT_PATHS),
    'clinic': frozenset(_DOCTOR_TENANT_PATHS | _FACILITY_EXTRA_PATHS),
    'hospital': frozenset(_DOCTOR_TENANT_PATHS | _FACILITY_EXTRA_PATHS),
}


# Role keys permitted in addon.limits and subscription.overrides.limits.
# Three distinct axes share this namespace:
#   * team seats (total/super_admin/sub_admin/provider) — applied by
#     PlanService.resolve;
#   * provider entities (doctor/clinic/hospital) — consumed by
#     tenant_provider_plan's quota resolver;
#   * reseller capacity (child_subdomain/child_custom_domain) — consumed
#     by ResellerPolicy.child_quotas.
# The seat loop deliberately skips everything but the first group.
_LIMIT_ROLES = frozenset({'total', 'super_admin', 'sub_admin', 'provider',
                          'doctor', 'clinic', 'hospital',
                          'child_subdomain', 'child_custom_domain'})

# Closed enum for usage-cap metric keys. Adding a new metric = add it here,
# add a UsageGate decorator on the new endpoint, optionally seed plan caps.
KNOWN_USAGE_METRICS = frozenset({
    'video_minutes', 'audio_minutes',
    'video_calls', 'audio_calls',
    'chat_messages',
    'sms_sends', 'email_sends',
})

# Allowed window kinds on a usage-limit block. ``rolling`` is paired with
# ``rolling_days`` + ``rolling_limit`` (both required together).
KNOWN_USAGE_WINDOWS = frozenset({'monthly', 'daily', 'rolling'})

# Role enum -> limit-column key used when counting staff seats.
_ROLE_TO_LIMIT_KEY = {
    UserRole.SUPER_ADMIN: 'super_admin',
    UserRole.SUB_ADMIN: 'sub_admin',
    UserRole.DOCTOR: 'provider',
}


# --------------------------------------------------------------------------- #
# Exceptions — routes translate these into HTTP 402 / 403
# --------------------------------------------------------------------------- #

class PlanLimitExceeded(Exception):
    def __init__(self, limit: str, current: int, max_allowed: int):
        self.limit = limit
        self.current = current
        self.max_allowed = max_allowed
        super().__init__(
            f'Plan limit exceeded for {limit}: {current} / {max_allowed}'
        )


class FeatureDisabled(Exception):
    def __init__(self, feature_path: str):
        self.feature_path = feature_path
        super().__init__(f'Feature disabled: {feature_path}')


class DomainNotConfigurable(Exception):
    def __init__(self, kind: str):
        self.kind = kind
        super().__init__(f'Domain not configurable: {kind}')


class NoActiveSubscription(Exception):
    pass


class GatewayNotConfigured(Exception):
    """The tenant has no payment-gateway credentials of their own.

    Deliberately NOT recoverable with a platform-key fallback: tenant
    marketplace money must land in the tenant's account, never ours.
    ``rail`` is ``'collection'`` (Razorpay) or ``'payout'`` (Cashfree).
    """
    def __init__(self, rail: str = 'collection'):
        self.rail = rail
        super().__init__(
            f'Payment gateway ({rail}) is not configured for this tenant.'
        )


class NotApexTenant(Exception):
    """The tenant holds no live apex-kind subscription (see ResellerPolicy)."""


class ChildQuotaExceeded(Exception):
    """An apex tenant is out of child slots of ``limit`` kind."""
    def __init__(self, limit: str, used: int, allowed: int):
        self.limit = limit
        self.used = used
        self.allowed = allowed
        super().__init__(
            f'Child quota exceeded for {limit}: {used} / {allowed}')


class UsageLimitExceeded(Exception):
    """Raised by :class:`UsageGate` when a usage cap is hit."""
    def __init__(self, metric: str, window: str, current: int, max_allowed: int,
                 period_end):
        self.metric = metric
        self.window = window
        self.current = current
        self.max_allowed = max_allowed
        self.period_end = period_end
        super().__init__(
            f'Usage limit exceeded for {metric}/{window}: '
            f'{current} / {max_allowed} (period ends {period_end})'
        )


class AddonPrerequisiteMissing(Exception):
    """Raised when attaching an addon whose prerequisite isn't active."""
    def __init__(self, addon_code: str, missing: list[str]):
        self.addon_code = addon_code
        self.missing = missing
        super().__init__(
            f'Cannot attach {addon_code}: prerequisites not active: {missing}'
        )


# --------------------------------------------------------------------------- #
# Typed records
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class PaymentGatewayBinding:
    provider: str
    credentials_source: str  # 'tenant_config' | 'platform_env'
    credentials_ref: str | None = None
    # Live credentials, resolved at bind time. NEVER serialised — to_dict()
    # deliberately omits them, and repr hides them from tracebacks/logs.
    key_id: str | None = field(default=None, repr=False)
    key_secret: str | None = field(default=None, repr=False)
    webhook_secret: str | None = field(default=None, repr=False)

    def to_dict(self) -> dict:
        return {
            'provider': self.provider,
            'credentials_source': self.credentials_source,
            'credentials_ref': self.credentials_ref,
        }


@dataclass
class ResolvedPlan:
    plan_code: str
    limits: dict
    features: dict
    payment: dict
    over_limit_action: OverLimitAction
    grace_period_days: int
    subscription_status: SubscriptionStatus
    subscription_id: str
    active_addons: list = field(default_factory=list)
    feature_sources: dict = field(default_factory=dict)
    limit_sources: dict = field(default_factory=dict)
    # Per-metric, per-window resolved usage caps.
    # Shape: { "video_minutes": {"monthly": int, "daily": int?,
    #                            "rolling_days": int?, "rolling_limit": int?}, … }
    usage_limits: dict = field(default_factory=dict)
    # Audit trail for /me?debug=1 — same idea as feature_sources.
    usage_sources: dict = field(default_factory=dict)
    # Subscription period anchors — counters reset at current_period_end.
    current_period_start: object = None
    current_period_end: object = None

    def to_dict(self, *, include_debug: bool = False) -> dict:
        data = {
            'plan_code': self.plan_code,
            'limits': dict(self.limits),
            'features': _deep_unfreeze(self.features),
            'payment': dict(self.payment),
            'over_limit_action': self.over_limit_action.value,
            'grace_period_days': self.grace_period_days,
            'subscription_status': self.subscription_status.value,
            'subscription_id': self.subscription_id,
            'active_addons': list(self.active_addons),
            'usage_limits': _deep_unfreeze(self.usage_limits),
        }
        if self.current_period_start:
            data['current_period_start'] = self.current_period_start.isoformat() \
                if hasattr(self.current_period_start, 'isoformat') else self.current_period_start
        if self.current_period_end:
            data['current_period_end'] = self.current_period_end.isoformat() \
                if hasattr(self.current_period_end, 'isoformat') else self.current_period_end
        if include_debug:
            data['feature_sources'] = dict(self.feature_sources)
            data['limit_sources'] = {k: list(v) for k, v in self.limit_sources.items()}
            data['usage_sources'] = {k: list(v) for k, v in self.usage_sources.items()}
        return data


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _deep_unfreeze(obj: Any) -> Any:
    """Convert MappingProxyType / tuple back to dict / list for JSON output."""
    if isinstance(obj, types.MappingProxyType):
        return {k: _deep_unfreeze(v) for k, v in obj.items()}
    if isinstance(obj, dict):
        return {k: _deep_unfreeze(v) for k, v in obj.items()}
    if isinstance(obj, tuple):
        return [_deep_unfreeze(v) for v in obj]
    if isinstance(obj, list):
        return [_deep_unfreeze(v) for v in obj]
    return obj


def _deep_freeze(obj: Any) -> Any:
    if isinstance(obj, dict):
        return types.MappingProxyType({k: _deep_freeze(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return tuple(_deep_freeze(v) for v in obj)
    return obj


def _walk_features(tree: dict) -> list[tuple[str, Any]]:
    """Yield (dotted_path, leaf) for every leaf in a feature subtree.

    A leaf is either a bool or a dict with an explicit ``enabled`` key. Nested
    dicts *without* ``enabled`` are treated as category containers and recursed
    into.
    """
    out: list[tuple[str, Any]] = []

    def walk(node, prefix):
        if isinstance(node, bool):
            out.append((prefix, node))
            return
        if isinstance(node, dict):
            if 'enabled' in node:
                out.append((prefix, node))
                return
            for k, v in node.items():
                child_prefix = f'{prefix}.{k}' if prefix else k
                walk(v, child_prefix)
            return

    walk(tree, '')
    return out


def _apply_organization_clinic_alias(
    features: dict, sources: dict,
) -> None:
    """Mirror leaves between the legacy ``clinic.*`` prefix and the new
    ``organization.*`` prefix so a tenant's resolved feature tree honours
    either spelling.

    Two product-naming eras coexist: legacy plan / addon rows store
    ``{clinic: {marketplace: true, …}}``, while new ones author through
    the editor use ``{organization: {marketplace: true, …}}`` (because
    the SaaS product now serves clinics + hospitals + solo doctor
    practices, and "clinic" was too narrow). Rather than migrate the
    data, this function makes the resolver tolerant: after every other
    merge (plan + addons + overrides), copy each truthy leaf between
    the two prefixes so downstream ``FeatureGuard`` checks against
    either spelling unlock the feature.

    Mutates ``features`` and ``sources`` in place. Idempotent — running
    it twice produces the same result.
    """
    clinic = features.get('clinic') or {}
    org = features.get('organization') or {}
    if not isinstance(clinic, dict) or not isinstance(org, dict):
        return

    # Union of leaf keys across both prefixes. Skip ``enabled`` shape on
    # the container itself (would mean someone wrote ``clinic.enabled``
    # which isn't a known feature path).
    keys = set(clinic.keys()) | set(org.keys())
    keys.discard('enabled')

    for key in keys:
        clinic_val = clinic.get(key)
        org_val = org.get(key)
        # Determine the canonical "on" state — either side being truthy
        # wins. ``{enabled: true}`` dicts honour the inner flag; bool
        # leaves use themselves.
        def _is_on(v):
            if isinstance(v, bool):
                return v
            if isinstance(v, dict):
                return bool(v.get('enabled', False))
            return False
        on = _is_on(clinic_val) or _is_on(org_val)
        if not on:
            # If both sides are off (or absent), don't fabricate
            # entries. Keeps the dict tidy for debug consumers.
            continue
        # Choose a single value to write (prefer the side that's
        # actually configured so dict-shaped leaves retain their other
        # fields like ``control``). Fallback to ``True``.
        canonical = clinic_val if clinic_val is not None else org_val
        if canonical is None:
            canonical = True
        clinic[key] = copy.deepcopy(canonical)
        org[key] = copy.deepcopy(canonical)
        # Record alias in sources for debug output. Prefer the existing
        # source if one side already had it, otherwise mark it as the
        # alias-mirror.
        c_path = f'clinic.{key}'
        o_path = f'organization.{key}'
        existing = sources.get(c_path) or sources.get(o_path) or 'alias'
        sources.setdefault(c_path, existing)
        sources.setdefault(o_path, existing)

    features['clinic'] = clinic
    features['organization'] = org


def _merge_features(
    base: dict, overlay: dict, source_label: str, sources: dict,
) -> dict:
    """Deep-merge ``overlay`` onto ``base`` and record source for each touched leaf.

    Mutates ``base`` and ``sources`` in place; returns ``base`` for convenience.
    """
    for key, value in overlay.items():
        if isinstance(value, dict) and 'enabled' not in value \
                and isinstance(base.get(key), dict) \
                and 'enabled' not in base.get(key, {}):
            # Category container — recurse.
            base[key] = _merge_features(
                base.setdefault(key, {}), value, source_label, sources,
            )
        else:
            # Leaf — overwrite and record source.
            base[key] = copy.deepcopy(value)
    # Track leaf sources. We walk the overlay (not the merged) tree so
    # category-only paths aren't counted.
    for path, _leaf in _walk_features(overlay):
        sources[path] = source_label
    return base


def _cache_key_for(tenant_id) -> str:
    return f'_resolved_plan_{tenant_id}'


# --------------------------------------------------------------------------- #
# PlanService
# --------------------------------------------------------------------------- #

class PlanService:
    """Resolves a tenant's effective plan and enforces limits.

    Resolution is cached on :data:`flask.g` per request. Outside request
    context (tests, background jobs) each call re-queries — fine, low volume.
    """

    @staticmethod
    def resolve(tenant_id) -> ResolvedPlan:
        if has_request_context():
            cached = g.get(_cache_key_for(tenant_id))
            if cached is not None:
                return cached

        resolved = PlanService._resolve_uncached(tenant_id)

        if has_request_context():
            setattr(g, _cache_key_for(tenant_id), resolved)
        return resolved

    @staticmethod
    def _resolve_uncached(tenant_id) -> ResolvedPlan:
        from app.models import Plan, TenantSubscription, TenantAddon

        subscription = (
            TenantSubscription.query
            .filter_by(tenant_id=tenant_id, is_deleted=False)
            .first()
        )
        if not subscription:
            raise NoActiveSubscription(
                f'Tenant {tenant_id} has no active subscription.'
            )

        plan: Plan = subscription.plan

        # --- Plan base: the SUBSCRIPTION-TIME SNAPSHOT, not the live row ---
        # Grandfathering: what a tenant resolves to is what the plan said
        # when they subscribed (or were last explicitly re-synced). Catalog
        # edits therefore never silently rewrite existing subscribers.
        # Legacy rows without a snapshot (pre-migration, or backfill not
        # yet run) fall back to the live plan — the old behaviour.
        # Snapshot-first (grandfathering) — but only a real dict counts.
        # Anything else (JSONB null, a corrupt write, a test double)
        # falls back to the live plan instead of poisoning resolution.
        snap = subscription.plan_snapshot
        if not isinstance(snap, dict):
            snap = {}

        limits = dict(snap.get('limits') or {
            'total': plan.max_total_users,
            'super_admin': plan.max_super_admins,
            'sub_admin': plan.max_sub_admins,
            'provider': plan.max_providers,
        })
        limit_sources: dict[str, list[str]] = {k: ['plan'] for k in limits}

        features: dict = copy.deepcopy(
            snap['features'] if 'features' in snap else (plan.features or {}))
        feature_sources: dict[str, str] = {}
        for path, _leaf in _walk_features(features):
            feature_sources[path] = 'plan'

        # Usage caps: deep-copy so add-ons can mutate.
        usage_limits: dict = copy.deepcopy(
            snap['usage_limits'] if 'usage_limits' in snap
            else (plan.usage_limits or {}))
        usage_sources: dict[str, list[str]] = {
            metric: ['plan'] for metric in usage_limits.keys()
        }

        # --- Add-on layer ---
        active_addons_rows = (
            TenantAddon.query
            .filter_by(
                tenant_id=tenant_id,
                is_deleted=False,
                status=AddonSubscriptionStatus.ACTIVE,
            )
            .all()
        )
        active_addons_summary = []
        now_ts = utcnow()
        for ta in active_addons_rows:
            addon = ta.addon
            if addon is None or addon.is_deleted:
                continue
            # Resale stock belongs to the apex's inventory, not its
            # entitlements — it grants the holder nothing.
            # ``is True`` on purpose: a MagicMock attribute is
            # truthy, which made every add-on look like stock.
            if getattr(ta, 'is_stock', False) is True:
                continue
            # An add-on carries its own paid window; a lapsed one stops
            # applying even before the sweep flips its status. Only a
            # real datetime counts (same guard as plan_snapshot — test
            # doubles and corrupt values fall back to "still active").
            from datetime import datetime as _dt
            period_end = ta.current_period_end
            if isinstance(period_end, _dt):
                if period_end.tzinfo is None:
                    from datetime import timezone as _tz
                    period_end = period_end.replace(tzinfo=_tz.utc)
                if period_end < now_ts:
                    continue
            label = f'addon:{addon.code}'
            qty = max(int(getattr(ta, 'quantity', 1) or 1), 1)
            # units = what ONE purchase grants, snapshotted on the row at
            # purchase time. Grant multiplier = quantity x units.
            # (MagicMock-safe: anything but a positive int means 1.)
            units_raw = getattr(ta, 'units', 1)
            units = units_raw if isinstance(units_raw, int) and units_raw > 0 else 1
            qty = qty * units
            active_addons_summary.append({
                'code': addon.code,
                'features': addon.features or {},
                'limits': addon.limits,
                'quantity': qty,
                'units': units,
            })

            # Capacity delta.
            if addon.limits:
                for role, delta in addon.limits.items():
                    if role in limits and isinstance(delta, int):
                        limits[role] += delta * qty
                        limit_sources.setdefault(role, []).append(label)

            # Feature merge.
            if addon.features:
                _merge_features(features, addon.features, label, feature_sources)

            # Usage-cap delta — additive across windows. ``-1`` (unlimited)
            # remains ``-1`` once set; positive deltas only stack on
            # positive caps (don't promote 0 / -1 to a finite cap by accident).
            if addon.usage_deltas:
                for metric, windows in addon.usage_deltas.items():
                    if not isinstance(windows, dict):
                        continue
                    base = usage_limits.setdefault(metric, {})
                    for win, delta in windows.items():
                        if not isinstance(delta, int):
                            continue
                        cur = base.get(win, 0)
                        if cur == -1:
                            continue  # already unlimited
                        base[win] = cur + delta * qty
                    usage_sources.setdefault(metric, ['plan']).append(label)

        # --- Override layer (authoritative: replaces) ---
        overrides = subscription.overrides or {}
        ov_limits = overrides.get('limits') or {}
        for role, value in ov_limits.items():
            if role in limits and isinstance(value, int):
                limits[role] = value
                limit_sources[role] = ['override']

        ov_features = overrides.get('features') or {}
        if ov_features:
            _merge_features(features, ov_features, 'override', feature_sources)

        # Usage-cap overrides REPLACE (don't add) — same precedence as limits.
        ov_usage = overrides.get('usage_limits') or {}
        for metric, windows in ov_usage.items():
            if not isinstance(windows, dict):
                continue
            base = usage_limits.setdefault(metric, {})
            for win, value in windows.items():
                if isinstance(value, int):
                    base[win] = value
                elif win in ('rolling_days', 'rolling_limit') and isinstance(value, int):
                    base[win] = value
            usage_sources[metric] = ['override']

        payment = dict(snap.get('payment') or {
            'razorpay_supported': plan.razorpay_supported,
            'tenant_keys_allowed': plan.tenant_keys_allowed,
        })

        # Bridge ``clinic.*`` ↔ ``organization.*`` so legacy plan rows
        # and new ones unlock the same features under either prefix.
        # Runs AFTER every other merge so add-on / override-driven
        # leaves participate. Mutates ``features`` and ``feature_sources``
        # in place; safe to call exactly once.
        _apply_organization_clinic_alias(features, feature_sources)

        resolved = ResolvedPlan(
            plan_code=plan.code,
            limits=limits,
            features=_deep_freeze(features),
            payment=payment,
            over_limit_action=(OverLimitAction(snap['over_limit_action'])
                               if snap.get('over_limit_action')
                               else plan.over_limit_action),
            grace_period_days=(snap['grace_period_days']
                               if snap.get('grace_period_days') is not None
                               else plan.grace_period_days),
            subscription_status=subscription.status,
            subscription_id=str(subscription.id),
            active_addons=active_addons_summary,
            feature_sources=feature_sources,
            limit_sources=limit_sources,
            usage_limits=_deep_freeze(usage_limits),
            usage_sources=usage_sources,
            current_period_start=subscription.current_period_start,
            current_period_end=subscription.current_period_end,
        )
        return resolved

    # ------------------------------------------------------------------ #
    # Live seat counts
    # ------------------------------------------------------------------ #

    @staticmethod
    def current_counts(tenant_id) -> dict:
        """Live per-role seat counts from the ``users`` table (not snapshotted)."""
        from app.models import User

        counts = {'super_admin': 0, 'sub_admin': 0, 'provider': 0, 'total': 0}
        rows = (
            db.session.query(User.role, func.count(User.id))
            .filter(
                User.tenant_id == tenant_id,
                User.is_deleted == False,  # noqa: E712
                User.role.in_([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.DOCTOR]),
            )
            .group_by(User.role)
            .all()
        )
        for role, n in rows:
            key = _ROLE_TO_LIMIT_KEY.get(role)
            if key:
                counts[key] = int(n)
        counts['total'] = counts['super_admin'] + counts['sub_admin'] + counts['provider']
        return counts

    # ------------------------------------------------------------------ #
    # Enforcement
    # ------------------------------------------------------------------ #

    @staticmethod
    def require_within_limit(tenant_id, role: UserRole) -> None:
        """Raise :class:`PlanLimitExceeded` if creating another user of ``role``
        would push the tenant past its resolved limit.

        Called from staff-provisioning service methods AND from route
        decorators. Patient role is exempt (unlimited).
        """
        limit_key = _ROLE_TO_LIMIT_KEY.get(role)
        if limit_key is None:
            return  # PATIENT / PHARMACY etc. — not capped by Plan1.

        # VENDOR bypass. The SaaS vendor's own tenant
        # (``Tenant.is_platform = True``) sells the product and is not a
        # billing subscriber, so its staff roster is not capped by a plan.
        # Mirrors the same ``is_platform`` bypass in
        # ``FeatureGate.is_enabled`` and ``PlanService.resolve_gateway``.
        #
        # Deliberately NOT ``is_default``: the fallback tenant is an
        # ordinary paying customer and must hit the strict per-role /
        # total caps below like everyone else.
        try:
            from app.models import Tenant
            tenant = Tenant.query.get(tenant_id) if tenant_id else None
            if tenant and getattr(tenant, 'is_platform', False):
                return
        except Exception:  # noqa: BLE001
            # Lookup failure (malformed id, DB hiccup) — fall through to
            # the normal enforcement path rather than accidentally
            # uncapping a tenant on a transient error.
            pass

        resolved = PlanService.resolve(tenant_id)
        counts = PlanService.current_counts(tenant_id)

        # Per-role cap.
        if counts[limit_key] >= resolved.limits[limit_key]:
            raise PlanLimitExceeded(
                limit=limit_key,
                current=counts[limit_key],
                max_allowed=resolved.limits[limit_key],
            )
        # Total cap.
        if counts['total'] >= resolved.limits['total']:
            raise PlanLimitExceeded(
                limit='total',
                current=counts['total'],
                max_allowed=resolved.limits['total'],
            )

    # ------------------------------------------------------------------ #
    # Downgrade lifecycle
    # ------------------------------------------------------------------ #

    @staticmethod
    def recompute_over_limit(subscription, *, commit: bool = False) -> bool:
        """Set / clear ``over_limit_since`` and ``status`` based on live counts.

        Returns True if the subscription row was mutated.
        """
        from app.models import Plan

        plan: Plan = subscription.plan
        counts = PlanService.current_counts(subscription.tenant_id)
        # Resolve limits including add-ons + overrides attached to this tenant.
        resolved_limits = PlanService.resolve(subscription.tenant_id).limits

        over = any(
            counts[k] > resolved_limits[k] for k in ('total', 'super_admin', 'sub_admin', 'provider')
        )
        mutated = False
        now = utcnow()

        if over:
            if subscription.over_limit_since is None:
                subscription.over_limit_since = now
                mutated = True
            if plan.over_limit_action == OverLimitAction.GRACE_THEN_SUSPEND:
                target = subscription.over_limit_since + timedelta(days=plan.grace_period_days)
                if subscription.suspend_after != target:
                    subscription.suspend_after = target
                    mutated = True
            if subscription.status != SubscriptionStatus.OVER_LIMIT \
                    and subscription.status != SubscriptionStatus.SUSPENDED:
                if plan.over_limit_action == OverLimitAction.SUSPEND_IMMEDIATELY:
                    subscription.status = SubscriptionStatus.SUSPENDED
                else:
                    subscription.status = SubscriptionStatus.OVER_LIMIT
                mutated = True
        else:
            # Back within limits — clear the flags unless cancelled/suspended manually.
            if subscription.over_limit_since is not None:
                subscription.over_limit_since = None
                subscription.suspend_after = None
                mutated = True
            if subscription.status == SubscriptionStatus.OVER_LIMIT:
                subscription.status = SubscriptionStatus.ACTIVE
                mutated = True

        if mutated and commit:
            db.session.commit()
        return mutated

    @staticmethod
    def sweep_over_limit_subscriptions() -> dict:
        """Daily reconciliation. Flips OVER_LIMIT → SUSPENDED once grace expired."""
        from app.models import TenantSubscription
        from app.common.tenant_context import with_tenant_context

        now = utcnow()
        stats = {'reconciled': 0, 'suspended': 0, 'recovered': 0}

        # Bypass RLS by iterating through the platform-owner escape hatch.
        subs = TenantSubscription.query.filter_by(is_deleted=False).all()
        for sub in subs:
            with with_tenant_context(sub.tenant_id):
                before_status = sub.status
                mutated = PlanService.recompute_over_limit(sub)
                if sub.status == SubscriptionStatus.OVER_LIMIT \
                        and sub.suspend_after is not None \
                        and now > sub.suspend_after:
                    sub.status = SubscriptionStatus.SUSPENDED
                    mutated = True
                    stats['suspended'] += 1
                if mutated:
                    stats['reconciled'] += 1
                    if before_status == SubscriptionStatus.OVER_LIMIT \
                            and sub.status == SubscriptionStatus.ACTIVE:
                        stats['recovered'] += 1
        db.session.commit()
        return stats


# --------------------------------------------------------------------------- #
# FeatureGate
# --------------------------------------------------------------------------- #

class FeatureGate:

    @staticmethod
    def is_enabled(tenant_id, path: str) -> bool:
        if path not in ALLOWED_FEATURE_PATHS:
            logger.warning(
                'FeatureGate.is_enabled called with unknown path %r — defaulting to deny',
                path,
            )
            return False

        # VENDOR bypass. The SaaS vendor's own tenant
        # (``Tenant.is_platform = True``) runs the control plane, not the
        # product, so gating it on a plan it never bought is meaningless.
        # Same philosophy as PLATFORM_OWNER's role-level bypass in
        # ``@feature_required``.
        #
        # Deliberately NOT ``is_default``: every customer tenant is
        # plan-gated, including whichever one happens to be the
        # anonymous-request fallback.
        try:
            from app.models import Tenant
            tenant = Tenant.query.get(tenant_id) if tenant_id else None
            if tenant and getattr(tenant, 'is_platform', False):
                return True
        except Exception:  # noqa: BLE001
            # Lookup failure (tenant id malformed, DB hiccup, etc.) —
            # fall through to the normal plan-resolution path so we
            # don't accidentally unlock features on a transient error.
            pass

        resolved = PlanService.resolve(tenant_id)

        # Billing suspension is a hard off-switch: a SUSPENDED subscription
        # (unpaid past its grace window, or over-limit past grace) keeps no
        # features. The tenant's admin can still sign in and reach the
        # billing + gateway pages — those are role-gated, not
        # feature-gated — so paying their way back out stays possible.
        if resolved.subscription_status == SubscriptionStatus.SUSPENDED:
            return False

        # A seller-deactivated tenant (status INACTIVE) is dark the same
        # way: the whole workspace is down until the seller reactivates.
        # Same escape hatches as suspension — admin sign-in, billing and
        # support are role-gated, not feature-gated.
        try:
            from app.models import Tenant as _T
            _t = _T.query.get(tenant_id) if tenant_id else None
            _status = getattr(_t, 'status', None)
            if _t is not None and getattr(_status, 'value', _status) != 'active':
                return False
        except Exception:  # noqa: BLE001 — fail toward the plan answer
            pass

        return _walk_to_leaf(resolved.features, path)

    @staticmethod
    def require_feature(tenant_id, path: str) -> None:
        if not FeatureGate.is_enabled(tenant_id, path):
            raise FeatureDisabled(path)


def _walk_to_leaf(tree, path: str) -> bool:
    node = tree
    for part in path.split('.'):
        if not isinstance(node, (dict, types.MappingProxyType)):
            return False
        node = node.get(part)
        if node is None:
            return False
    if isinstance(node, bool):
        return node
    if isinstance(node, (dict, types.MappingProxyType)):
        value = node.get('enabled', False)
        return bool(value)
    return False


def _walk_to_leaf_meta(tree, path: str) -> dict:
    """Return the leaf dict for a path, or ``{}`` if the leaf is bool / missing."""
    node = tree
    for part in path.split('.'):
        if not isinstance(node, (dict, types.MappingProxyType)):
            return {}
        node = node.get(part)
        if node is None:
            return {}
    if isinstance(node, (dict, types.MappingProxyType)):
        return dict(node)
    return {}


# --------------------------------------------------------------------------- #
# DomainPolicy
# --------------------------------------------------------------------------- #

class MarketplacePolicy:
    """Does a tenant run a public (marketplace) provider funnel?

    This used to be ``Tenant.is_default``, back when the apex tenant was
    the only marketplace there was. That conflated two different things:
    "who is the SaaS vendor" and "who runs a marketplace". After the
    vendor/customer split the marketplace belongs to an ordinary paying
    customer tenant, and the vendor runs none at all — so the question is
    a plan entitlement, not a flag on the tenant row.

    Callers use it to pick between the two provider-signup paths:
      * marketplace  -> a ``MembershipPlan`` code from the /join funnel
        is required, and a ``MembershipSubscription`` is attached.
      * in-tenant    -> gated by the tenant's provider-entity quota and,
        when authored, a ``TenantProviderPlan`` picker.
    """

    VERTICALS = ('doctor', 'clinic', 'hospital')

    @staticmethod
    def runs_marketplace(tenant_id, vertical=None) -> bool:
        """True when ``tenant_id`` may run a marketplace for ``vertical``.

        ``vertical`` may be a plain string, a ``MembershipVertical``, or
        ``None`` to mean "any vertical". An unrecognised vertical is
        False rather than an error — callers are route handlers that
        already validated their own input.

        ``tenant_id is None`` returns True to preserve the pre-split
        behaviour of ``_is_apex_tenant``, which treated an unresolved
        tenant as the apex.
        """
        if tenant_id is None:
            return True

        if vertical is None:
            candidates = MarketplacePolicy.VERTICALS
        else:
            code = getattr(vertical, 'value', vertical)
            code = str(code).lower()
            if code not in MarketplacePolicy.VERTICALS:
                return False
            candidates = (code,)

        return any(
            FeatureGate.is_enabled(
                tenant_id, 'tenant.can_create_membership_%s_plans' % v,
            )
            for v in candidates
        )


class ResellerPolicy:
    """May a tenant RESELL the SaaS (author plans, create sub-tenants)?

    Same philosophy as :class:`MarketplacePolicy`: a plan entitlement,
    never a tenant flag. A tenant is an APEX reseller when its live
    subscription's plan has ``kind='apex'`` — which only the vendor
    authors — AND it is itself a top-level customer
    (``parent_tenant_id IS NULL``) that isn't the vendor row.

    A PAST_DUE/SUSPENDED apex loses the console (``is_apex`` False) but
    its children keep running on their own subscriptions — containment,
    not collective punishment.
    """

    RESELLABLE_STATUSES = (SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE)

    @staticmethod
    def _apex_cache_key(tenant_id) -> str:
        return f'_is_apex_{tenant_id}'

    @staticmethod
    def is_apex(tenant_id) -> bool:
        if tenant_id is None:
            return False
        if has_request_context():
            cached = g.get(ResellerPolicy._apex_cache_key(tenant_id))
            if cached is not None:
                return cached
        result = ResellerPolicy._is_apex_uncached(tenant_id)
        if has_request_context():
            setattr(g, ResellerPolicy._apex_cache_key(tenant_id), result)
        return result

    @staticmethod
    def _is_apex_uncached(tenant_id) -> bool:
        from app.models import Plan, Tenant, TenantSubscription
        from app.models._enums import PlanKind

        tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
        if (tenant is None or tenant.is_platform
                or tenant.parent_tenant_id is not None):
            return False
        sub = (
            TenantSubscription.query
            .filter(
                TenantSubscription.tenant_id == tenant_id,
                TenantSubscription.is_deleted.is_(False),
                TenantSubscription.status.in_(
                    ResellerPolicy.RESELLABLE_STATUSES),
            )
            .join(Plan, Plan.id == TenantSubscription.plan_id)
            .filter(Plan.kind == PlanKind.APEX)
            .first()
        )
        return sub is not None

    @staticmethod
    def child_quotas(tenant_id) -> dict:
        """``{'subdomains': int, 'custom_domains': int}`` from the live
        apex plan's columns; NULL reads as 0 (none allowed)."""
        from app.models import Plan, TenantSubscription
        from app.models._enums import PlanKind

        sub = (
            TenantSubscription.query
            .filter(
                TenantSubscription.tenant_id == tenant_id,
                TenantSubscription.is_deleted.is_(False),
                TenantSubscription.status.in_(
                    ResellerPolicy.RESELLABLE_STATUSES),
            )
            .join(Plan, Plan.id == TenantSubscription.plan_id)
            .filter(Plan.kind == PlanKind.APEX)
            .first()
        )
        plan = sub.plan if sub else None
        base_sub = (plan.max_child_subdomains or 0) if plan else 0
        base_dom = (plan.max_child_custom_domains or 0) if plan else 0
        # Extra tenancies bought as add-ons sit on top of what the plan
        # includes — the same "plan default, then buy more" shape seats
        # and entities already have.
        extra = ResellerPolicy._addon_tenancy_delta(tenant_id)
        return {
            'subdomains': base_sub + extra['subdomains'],
            'custom_domains': base_dom + extra['custom_domains'],
        }

    @staticmethod
    def _addon_tenancy_delta(tenant_id) -> dict:
        """Child-tenancy capacity bought as add-ons: the sum over ACTIVE,
        unexpired rows of ``limits[child_subdomain|child_custom_domain]``
        x units x quantity. A NULL period end (one_time purchase) never
        expires on its own."""
        from app.models import TenantAddon
        from app.models._base import utcnow
        from app.models._enums import AddonSubscriptionStatus

        out = {'subdomains': 0, 'custom_domains': 0}
        key_map = {'child_subdomain': 'subdomains',
                   'child_custom_domain': 'custom_domains'}
        now = utcnow()
        rows = (
            TenantAddon.query
            .filter_by(tenant_id=tenant_id, is_deleted=False,
                       status=AddonSubscriptionStatus.ACTIVE)
            .all()
        )
        for ta in rows:
            # ``is True`` on purpose: a MagicMock attribute is
            # truthy, which made every add-on look like stock.
            if getattr(ta, 'is_stock', False) is True:
                continue                      # inventory, not capacity
            end = ta.current_period_end
            if end is not None:
                if end.tzinfo is None:
                    from datetime import timezone as _tz
                    end = end.replace(tzinfo=_tz.utc)
                if end < now:
                    continue
            addon = ta.addon
            if addon is None or addon.is_deleted or not addon.limits:
                continue
            qty = max(int(ta.quantity or 1), 1)
            units = ta.units if isinstance(ta.units, int) and ta.units > 0 else 1
            for limit_key, out_key in key_map.items():
                delta = (addon.limits or {}).get(limit_key)
                if isinstance(delta, int) and delta > 0:
                    out[out_key] += delta * qty * units
        return out

    @staticmethod
    def child_counts(tenant_id, *, exclude_child_id=None) -> dict:
        """Used child slots. Derived from COLUMNS, not domain-suffix
        matching: ``auto_subdomain=True`` children consume a subdomain
        slot, ``domain IS NOT NULL`` children a custom-domain slot (a
        child with both consumes one of each). Survives the P4 move of
        children onto the apex's own DNS zone."""
        from app.models import Tenant

        q = Tenant.query.filter_by(parent_tenant_id=tenant_id,
                                   is_deleted=False)
        if exclude_child_id is not None:
            q = q.filter(Tenant.id != exclude_child_id)
        children = q.all()
        return {
            'subdomains': sum(1 for c in children if c.auto_subdomain),
            'custom_domains': sum(1 for c in children if c.domain),
        }

    @staticmethod
    def assert_child_slot(tenant_id, kind, *, exclude_child_id=None) -> None:
        """Raise :class:`ChildQuotaExceeded` when no ``kind`` slot
        ('subdomains' | 'custom_domains') is free."""
        allowed = ResellerPolicy.child_quotas(tenant_id)[kind]
        used = ResellerPolicy.child_counts(
            tenant_id, exclude_child_id=exclude_child_id)[kind]
        if used >= allowed:
            raise ChildQuotaExceeded(kind, used, allowed)


class DomainPolicy:

    @staticmethod
    def assert_subdomain_configurable(tenant_id) -> None:
        resolved = PlanService.resolve(tenant_id)
        meta = _walk_to_leaf_meta(resolved.features, 'domain.subdomain')
        if not meta.get('enabled', False) or not meta.get('configurable', False):
            raise DomainNotConfigurable('subdomain')

    @staticmethod
    def assert_custom_domain_allowed(tenant_id) -> None:
        resolved = PlanService.resolve(tenant_id)
        meta = _walk_to_leaf_meta(resolved.features, 'domain.custom_domain')
        if not meta.get('enabled', False):
            raise DomainNotConfigurable('custom_domain')


# --------------------------------------------------------------------------- #
# PaymentResolver
# --------------------------------------------------------------------------- #

class PaymentResolver:
    """Two rails, never crossed:

    * :meth:`resolve_gateway` — the TENANT rail. Marketplace collections
      (appointments, orders, memberships, public bookings) run on the
      tenant's own Razorpay account from :class:`TenantPaymentConfig`.
      There is NO platform-key fallback — an unconfigured tenant simply
      cannot collect, because tenant money must never land in our account.
    * :meth:`vendor_gateway` — the VENDOR rail. SaaS subscription billing
      (tenant paying US) runs on the platform's env-var keys and never
      reads tenant configs.
    """

    @staticmethod
    def resolve_gateway(tenant_id) -> PaymentGatewayBinding:
        """The tenant's own Razorpay binding.

        Raises :class:`FeatureDisabled` when the plan withholds Razorpay,
        :class:`NoActiveSubscription` when the tenant has no subscription,
        and :class:`GatewayNotConfigured` when the tenant hasn't entered
        their keys yet.
        """
        from app.models import TenantPaymentConfig

        resolved = PlanService.resolve(tenant_id)
        if not resolved.payment.get('razorpay_supported', False):
            raise FeatureDisabled('payments.razorpay')

        config = TenantPaymentConfig.for_tenant(tenant_id)
        if config is None or not config.collection_ready:
            raise GatewayNotConfigured('collection')

        return PaymentGatewayBinding(
            provider='razorpay',
            credentials_source='tenant_config',
            credentials_ref=str(config.id),
            key_id=config.razorpay_key_id,
            key_secret=config.razorpay_key_secret,
            webhook_secret=config.razorpay_webhook_secret,
        )

    @staticmethod
    def vendor_gateway() -> PaymentGatewayBinding:
        """The platform's own Razorpay account — SaaS subscription billing
        ONLY. Reads env vars, never :class:`TenantPaymentConfig`."""
        import os

        key_id = os.environ.get('RAZORPAY_KEY_ID', '')
        key_secret = os.environ.get('RAZORPAY_KEY_SECRET', '')
        if not key_id or not key_secret:
            raise RuntimeError(
                'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET must be set for '
                'subscription billing.'
            )
        return PaymentGatewayBinding(
            provider='razorpay',
            credentials_source='platform_env',
            credentials_ref=None,
            key_id=key_id,
            key_secret=key_secret,
            webhook_secret=os.environ.get('RAZORPAY_WEBHOOK_SECRET', '') or None,
        )


# --------------------------------------------------------------------------- #
# UsageGate — atomic counter + per-window threshold check
# --------------------------------------------------------------------------- #

def _bucket_for(window: str, *, now, sub_period_start, rolling_days):
    """Return ``(period_start, period_end)`` for the bucket the timestamp ``now``
    falls into, given a ``window`` kind.

    ``monthly`` → first-of-month UTC -> first-of-next-month
    ``daily``   → UTC midnight -> next UTC midnight
    ``rolling`` → subscription anchor + N*rolling_days, where N rolls forward.
    """
    from datetime import datetime, timedelta, timezone
    if window == 'daily':
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return start, end
    if window == 'monthly':
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # next month: bump month, clamp day, handle Dec→Jan
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
        return start, end
    if window == 'rolling':
        if not rolling_days or rolling_days <= 0:
            raise ValueError('rolling window requires positive rolling_days')
        anchor = sub_period_start
        if anchor is None:
            anchor = now
        # Find which N-day bucket from the anchor we're in.
        delta_days = (now - anchor).days
        n = max(0, delta_days // rolling_days)
        start = anchor + timedelta(days=n * rolling_days)
        end = start + timedelta(days=rolling_days)
        return start, end
    raise ValueError(f'unknown window: {window}')


class UsageGate:
    """Atomic monthly/daily/rolling usage-cap enforcement.

    Public API:
        UsageGate.check_and_increment(tenant_id, metric, delta=1)

    Behaviour:
        * Reads ``ResolvedPlan.usage_limits[metric]`` for the configured
          windows. Skips windows the plan didn't configure.
        * For each configured window, computes the current bucket and
          performs an atomic ``INSERT ... ON CONFLICT DO UPDATE SET
          count = count + :delta RETURNING count``.
        * If the post-increment count exceeds the resolved cap, decrements
          the same row (rollback) and raises ``UsageLimitExceeded``.
        * Sentinel ``-1`` = unlimited; ``0`` = disabled.
    """

    @staticmethod
    def _resolve_limit(window_block: dict, window: str):
        """Return ``(limit_value, rolling_days_for_this_window)``."""
        if window == 'rolling':
            limit = window_block.get('rolling_limit')
            return limit, window_block.get('rolling_days')
        return window_block.get(window), None

    @staticmethod
    def check_and_increment(tenant_id, metric: str, delta: int = 1) -> dict:
        """Increment counters for every configured window of ``metric``.

        Returns a dict of ``{window: post_count}`` on success.
        Raises ``UsageLimitExceeded`` on cap hit.
        """
        if metric not in KNOWN_USAGE_METRICS:
            logger.warning('UsageGate called with unknown metric %r — skipping', metric)
            return {}

        resolved = PlanService.resolve(tenant_id)
        block = (resolved.usage_limits or {}).get(metric) or {}
        if not block:
            return {}  # plan didn't configure this metric — skip

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        sub_anchor = resolved.current_period_start
        rolling_days = block.get('rolling_days')

        results: dict[str, int] = {}
        # The check has to consider every configured window. A single
        # transaction makes the multi-window check atomic — if any window
        # would exceed, every increment in this call is rolled back.
        with db.session.begin_nested():
            for window in ('monthly', 'daily', 'rolling'):
                limit, win_rolling_days = UsageGate._resolve_limit(block, window)
                # Skip windows the plan didn't configure.
                if window != 'rolling' and limit is None:
                    continue
                if window == 'rolling' and (limit is None or not rolling_days):
                    continue
                # Sentinel: -1 unlimited (skip), 0 disabled (block before increment).
                if limit == -1:
                    continue
                if limit == 0:
                    raise UsageLimitExceeded(
                        metric=metric, window=window,
                        current=0, max_allowed=0, period_end=None,
                    )

                period_start, period_end = _bucket_for(
                    window, now=now,
                    sub_period_start=sub_anchor,
                    rolling_days=rolling_days,
                )

                # Atomic upsert. ``ON CONFLICT`` updates count in place;
                # otherwise inserts a fresh row at ``count = :delta``.
                from sqlalchemy import text
                row = db.session.execute(
                    text("""
                        INSERT INTO tenant_usage_counters (
                            id, tenant_id, metric, window,
                            period_start, period_end, count,
                            created_at, updated_at
                        ) VALUES (
                            gen_random_uuid(), :tid, :metric, :window,
                            :ps, :pe, :delta,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        ON CONFLICT (tenant_id, metric, window, period_start)
                        DO UPDATE SET
                            count = tenant_usage_counters.count + EXCLUDED.count,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING count
                    """),
                    {
                        'tid': str(tenant_id), 'metric': metric, 'window': window,
                        'ps': period_start, 'pe': period_end, 'delta': delta,
                    },
                ).scalar()

                results[window] = int(row)
                if int(row) > int(limit):
                    raise UsageLimitExceeded(
                        metric=metric, window=window,
                        current=int(row) - delta,
                        max_allowed=int(limit),
                        period_end=period_end,
                    )

        db.session.commit()
        return results

    @staticmethod
    def current_usage(tenant_id) -> dict:
        """Snapshot of current per-metric per-window counters for /me UI."""
        from sqlalchemy import text
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        rows = db.session.execute(
            text("""
                SELECT metric, window, count, period_end
                FROM tenant_usage_counters
                WHERE tenant_id = :tid AND period_end > :now
            """),
            {'tid': str(tenant_id), 'now': now},
        ).fetchall()
        out: dict = {}
        for metric, window, count, period_end in rows:
            out.setdefault(metric, {})[window] = {
                'count': int(count),
                'period_end': period_end.isoformat() if period_end else None,
            }
        return out


# --------------------------------------------------------------------------- #
# Prerequisite topological check (used by AddonValidator + attach route)
# --------------------------------------------------------------------------- #

def assert_prerequisites_active(tenant_id, addon) -> None:
    """Raise :class:`AddonPrerequisiteMissing` if any prerequisite is not
    active on the tenant. ``addon`` is an Addon model row."""
    prereqs = addon.prerequisites or []
    if not prereqs:
        return
    from app.models import TenantAddon
    rows = (
        TenantAddon.query
        .filter_by(tenant_id=tenant_id, is_deleted=False,
                   status=AddonSubscriptionStatus.ACTIVE)
        .all()
    )
    active_codes = {r.addon.code for r in rows if r.addon and not r.addon.is_deleted}
    missing = [code for code in prereqs if code not in active_codes]
    if missing:
        raise AddonPrerequisiteMissing(addon.code, missing)
