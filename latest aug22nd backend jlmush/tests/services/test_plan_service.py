"""Unit tests for the pricing service module.

These tests exercise pure logic (validators, feature-tree walking, the merge
order in ``PlanService._resolve_uncached``) without touching the database.
DB-integration tests for downgrade / grace-period drills live in
``tests/api/test_pricing.py`` because they need a real tenant + RLS session.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


# --------------------------------------------------------------------------- #
# Validators
# --------------------------------------------------------------------------- #

class TestPlanValidator:
    def test_rejects_missing_required_fields(self):
        from app.api.pricing.validators import PlanValidator
        errors = PlanValidator.validate_create({})
        assert 'missing' in errors
        for required in ('code', 'name', 'max_total_users', 'features'):
            assert required in errors['missing']

    def test_rejects_negative_limits(self):
        from app.api.pricing.validators import PlanValidator
        errors = PlanValidator.validate_create({
            'code': 'p', 'name': 'P',
            'max_total_users': -1, 'max_super_admins': 0,
            'max_sub_admins': 0, 'max_providers': 0,
            'features': {},
        })
        assert 'max_total_users' in errors.get('non_negative_int', [])

    def test_rejects_limit_sum_violation(self):
        from app.api.pricing.validators import PlanValidator
        errors = PlanValidator.validate_create({
            'code': 'p', 'name': 'P',
            'max_total_users': 10,
            'max_super_admins': 5,
            'max_sub_admins': 5,
            'max_providers': 5,  # sum = 15 > 10
            'features': {},
        })
        assert 'limits_sum' in errors

    def test_rejects_unknown_feature_path(self):
        from app.api.pricing.validators import PlanValidator
        errors = PlanValidator.validate_create({
            'code': 'p', 'name': 'P',
            'max_total_users': 20, 'max_super_admins': 1,
            'max_sub_admins': 3, 'max_providers': 16,
            'features': {'patient': {'unknown_flag': True}},
        })
        assert errors.get('features.unknown_paths') == ['patient.unknown_flag']

    def test_accepts_valid_plan1_shape(self):
        import uuid

        from app.api.pricing.validators import PlanValidator
        errors = PlanValidator.validate_create({
            'code': 'plan1',
            'name': 'Plan 1',
            # Required since the plan-type table landed; the validator
            # checks UUID shape only (no DB lookup) — pure-unit safe.
            'saas_plan_type_id': str(uuid.uuid4()),
            'max_total_users': 20, 'max_super_admins': 1,
            'max_sub_admins': 3, 'max_providers': 16,
            'features': {
                'patient': {'basic_info': True, 'vitals': False,
                            'documents': False, 'family': False},
                'doctor': {'profile': True, 'calendar': True,
                           'pricing': True, 'prescriptions': True},
                'admin': {'manage_users': True, 'page_configuration': False},
                'communication': {
                    'sms': {'enabled': True, 'control': 'platform'},
                    'email': {'enabled': True, 'control': 'platform'},
                },
                'payments': {'razorpay': {'enabled': True, 'control': 'platform'}},
                'domain': {
                    'subdomain': {'enabled': True, 'configurable': True},
                    'custom_domain': {'enabled': False, 'configurable': False},
                },
            },
        })
        assert errors == {}


class TestAddonValidator:
    def test_rejects_unknown_limit_role(self):
        from app.api.pricing.validators import AddonValidator
        errors = AddonValidator.validate_create({
            'code': 'a', 'name': 'A',
            'limits': {'unknown_role': 5},
        })
        assert 'limits.unknown_roles' in errors

    def test_rejects_non_integer_limits(self):
        from app.api.pricing.validators import AddonValidator
        errors = AddonValidator.validate_create({
            'code': 'a', 'name': 'A',
            'limits': {'provider': 'five'},
        })
        assert 'limits.non_integer' in errors

    def test_accepts_negative_delta_for_addons(self):
        # Add-ons may carry signed deltas (compliance packs can remove seats).
        from app.api.pricing.validators import AddonValidator
        errors = AddonValidator.validate_create({
            'code': 'a', 'name': 'A',
            'limits': {'provider': -2},
        })
        assert errors == {}

    def test_rejects_empty_addon(self):
        from app.api.pricing.validators import AddonValidator
        errors = AddonValidator.validate_create({'code': 'a', 'name': 'A'})
        assert 'empty_addon' in errors


class TestOverrideValidator:
    def test_rejects_unknown_top_level_keys(self):
        from app.api.pricing.validators import PlanOverrideValidator
        errors = PlanOverrideValidator.validate({'foo': {}})
        assert errors.get('unknown_keys') == ['foo']

    def test_rejects_negative_override_limit(self):
        from app.api.pricing.validators import PlanOverrideValidator
        errors = PlanOverrideValidator.validate({'limits': {'total': -1}})
        assert 'limits.negative' in errors

    def test_rejects_non_int_override_limit(self):
        from app.api.pricing.validators import PlanOverrideValidator
        errors = PlanOverrideValidator.validate({'limits': {'total': 'twenty'}})
        assert 'limits.non_integer' in errors

    def test_accepts_valid_override(self):
        from app.api.pricing.validators import PlanOverrideValidator
        errors = PlanOverrideValidator.validate({
            'limits': {'provider': 25},
            'features': {'patient': {'vitals': True}},
        })
        assert errors == {}


# --------------------------------------------------------------------------- #
# Feature-tree walking helpers
# --------------------------------------------------------------------------- #

class TestFeatureTreeWalking:
    def test_walk_features_yields_every_leaf(self):
        from app.api.pricing.service import _walk_features
        tree = {
            'patient': {'vitals': True, 'family': False},
            'communication': {
                'sms': {'enabled': True, 'control': 'platform'},
            },
        }
        paths = dict(_walk_features(tree))
        assert paths['patient.vitals'] is True
        assert paths['patient.family'] is False
        assert isinstance(paths['communication.sms'], dict)

    def test_walk_to_leaf_bool_leaf(self):
        from app.api.pricing.service import _walk_to_leaf
        tree = {'patient': {'vitals': True, 'family': False}}
        assert _walk_to_leaf(tree, 'patient.vitals') is True
        assert _walk_to_leaf(tree, 'patient.family') is False

    def test_walk_to_leaf_object_leaf(self):
        from app.api.pricing.service import _walk_to_leaf
        tree = {'communication': {'sms': {'enabled': True, 'control': 'platform'}}}
        assert _walk_to_leaf(tree, 'communication.sms') is True

    def test_walk_to_leaf_missing_defaults_deny(self):
        from app.api.pricing.service import _walk_to_leaf
        tree = {}
        assert _walk_to_leaf(tree, 'patient.vitals') is False


# --------------------------------------------------------------------------- #
# PaymentResolver interface — returns typed record, not a string
# --------------------------------------------------------------------------- #

class TestPaymentResolver:
    """resolve_gateway is the TENANT rail now (tenant-owned Razorpay,
    NO platform-key fallback — the a4d36f7 payment-gateway model);
    both the config lookup and the plan resolve are mocked so this
    stays a pure unit test."""

    @staticmethod
    def _fake_resolved(svc):
        return svc.ResolvedPlan(
            plan_code='plan1',
            limits={'total': 20, 'super_admin': 1, 'sub_admin': 3, 'provider': 16},
            features={},
            payment={'razorpay_supported': True, 'tenant_keys_allowed': False},
            over_limit_action=svc.OverLimitAction.BLOCK_NEW,
            grace_period_days=0,
            subscription_status=svc.SubscriptionStatus.ACTIVE,
            subscription_id='sub-1',
        )

    def test_binding_is_a_dataclass(self, monkeypatch):
        import uuid

        from app.api.pricing import service as svc
        from app.models.tenant_payment_config import TenantPaymentConfig

        monkeypatch.setattr(
            svc.PlanService, 'resolve',
            staticmethod(lambda tid: self._fake_resolved(svc)),
        )
        cfg = MagicMock()
        cfg.collection_ready = True
        cfg.id = uuid.uuid4()
        cfg.razorpay_key_id = 'rzp_test_x'
        cfg.razorpay_key_secret = 'secret'
        cfg.razorpay_webhook_secret = 'whsec'
        monkeypatch.setattr(
            TenantPaymentConfig, 'for_tenant', classmethod(lambda c, t: cfg),
        )
        binding = svc.PaymentResolver.resolve_gateway(str(uuid.uuid4()))
        assert binding.provider == 'razorpay'
        assert binding.credentials_source == 'tenant_config'
        assert binding.credentials_ref == str(cfg.id)

    def test_unconfigured_tenant_raises_no_fallback(self, monkeypatch):
        import uuid

        from app.api.pricing import service as svc
        from app.models.tenant_payment_config import TenantPaymentConfig

        monkeypatch.setattr(
            svc.PlanService, 'resolve',
            staticmethod(lambda tid: self._fake_resolved(svc)),
        )
        monkeypatch.setattr(
            TenantPaymentConfig, 'for_tenant', classmethod(lambda c, t: None),
        )
        with pytest.raises(svc.GatewayNotConfigured):
            svc.PaymentResolver.resolve_gateway(str(uuid.uuid4()))


# --------------------------------------------------------------------------- #
# PlanService.resolve — merge order (Plan < Add-ons < Overrides)
# --------------------------------------------------------------------------- #

def _make_plan(features=None, limits=None):
    plan = MagicMock()
    plan.code = 'plan1'
    plan.max_total_users = (limits or {}).get('total', 20)
    plan.max_super_admins = (limits or {}).get('super_admin', 1)
    plan.max_sub_admins = (limits or {}).get('sub_admin', 3)
    plan.max_providers = (limits or {}).get('provider', 16)
    plan.razorpay_supported = True
    plan.tenant_keys_allowed = False
    from app.models._enums import OverLimitAction
    plan.over_limit_action = OverLimitAction.BLOCK_NEW
    plan.grace_period_days = 0
    plan.features = features or {
        'patient': {'vitals': False, 'family': True},
    }
    return plan


def _make_subscription(plan, overrides=None):
    sub = MagicMock()
    sub.id = 'sub-1'
    sub.plan = plan
    sub.overrides = overrides
    from app.models._enums import SubscriptionStatus
    sub.status = SubscriptionStatus.ACTIVE
    return sub


def _make_tenant_addon(code, features=None, limits=None):
    addon = MagicMock()
    addon.code = code
    addon.features = features or {}
    addon.limits = limits
    addon.is_deleted = False
    ta = MagicMock()
    ta.addon = addon
    return ta


class TestResolvePrecedence:
    """Exercises the Plan < Add-ons < Overrides merge using mocked ORM rows."""

    def _patch_queries(self, monkeypatch, subscription, tenant_addons):
        from app.api.pricing import service as svc

        class _Q:
            def __init__(self, rows):
                self._rows = rows

            def filter_by(self, **kw):
                return self

            def first(self):
                return self._rows[0] if self._rows else None

            def all(self):
                return self._rows

        fake_models = MagicMock()
        fake_models.Plan = MagicMock
        fake_models.TenantSubscription = MagicMock()
        fake_models.TenantSubscription.query = _Q([subscription] if subscription else [])
        fake_models.TenantAddon = MagicMock()
        fake_models.TenantAddon.query = _Q(tenant_addons)

        import sys
        monkeypatch.setitem(sys.modules, 'app.models', fake_models)
        monkeypatch.setattr(svc, 'has_request_context', lambda: False)
        return svc

    def test_plan_only(self, monkeypatch):
        plan = _make_plan()
        svc = self._patch_queries(monkeypatch, _make_subscription(plan), [])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.limits['provider'] == 16
        assert resolved.features['patient']['vitals'] is False
        assert resolved.feature_sources['patient.vitals'] == 'plan'

    def test_addon_adds_capacity(self, monkeypatch):
        plan = _make_plan()
        addon = _make_tenant_addon(
            'addon_5_providers', limits={'provider': 5, 'total': 5},
        )
        svc = self._patch_queries(monkeypatch, _make_subscription(plan), [addon])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.limits['provider'] == 21
        assert resolved.limits['total'] == 25
        assert 'addon:addon_5_providers' in resolved.limit_sources['provider']

    def test_addon_can_enable_disabled_feature(self, monkeypatch):
        plan = _make_plan(features={'patient': {'vitals': False}})
        addon = _make_tenant_addon(
            'addon_vitals', features={'patient': {'vitals': True}},
        )
        svc = self._patch_queries(monkeypatch, _make_subscription(plan), [addon])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.features['patient']['vitals'] is True
        assert resolved.feature_sources['patient.vitals'] == 'addon:addon_vitals'

    def test_addon_can_disable_enabled_feature(self, monkeypatch):
        plan = _make_plan(features={'patient': {'family': True}})
        addon = _make_tenant_addon(
            'addon_lite', features={'patient': {'family': False}},
        )
        svc = self._patch_queries(monkeypatch, _make_subscription(plan), [addon])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.features['patient']['family'] is False
        assert resolved.feature_sources['patient.family'] == 'addon:addon_lite'

    def test_override_replaces_limits_not_additive(self, monkeypatch):
        plan = _make_plan()
        addon = _make_tenant_addon(
            'addon_5_providers', limits={'provider': 5},
        )
        sub = _make_subscription(plan, overrides={'limits': {'provider': 10}})
        svc = self._patch_queries(monkeypatch, sub, [addon])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.limits['provider'] == 10   # replaced, not 16+5
        assert resolved.limit_sources['provider'] == ['override']

    def test_override_wins_over_addon_feature(self, monkeypatch):
        plan = _make_plan(features={'patient': {'vitals': False}})
        addon = _make_tenant_addon(
            'addon_vitals', features={'patient': {'vitals': True}},
        )
        sub = _make_subscription(
            plan, overrides={'features': {'patient': {'vitals': False}}},
        )
        svc = self._patch_queries(monkeypatch, sub, [addon])
        resolved = svc.PlanService.resolve('t1')
        assert resolved.features['patient']['vitals'] is False
        assert resolved.feature_sources['patient.vitals'] == 'override'
