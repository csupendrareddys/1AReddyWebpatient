"""Unit tests for ``MembershipPlanValidator``.

Pure functions — no DB / no Flask app context. Verifies the
admin-side payload guard that sits in front of every membership-plan
write. Runs in CI even when Postgres isn't available.
"""
from __future__ import annotations

import pytest

from app.api.platform.membership_validators import MembershipPlanValidator


# --------------------------------------------------------------------------- #
# Create
# --------------------------------------------------------------------------- #

class TestValidateCreate:

    def _good(self):
        return {
            'code': 'doctor_starter',
            'name': 'Doctor Starter',
            # Pure shape validation — no DB lookup, any non-empty
            # value passes (verticals are FK rows now, not an enum).
            'vertical_plan_type_id': '2c9a4c2e-1111-4222-8333-444455556666',
            'tier': 'basic',
            'price_inr_monthly': 0,
            'trial_days': 14,
            'features': {'bullets': ['Basic EHR']},
        }

    def test_minimal_valid_payload(self):
        errors = MembershipPlanValidator.validate_create(self._good())
        assert errors == {}

    def test_rejects_non_dict_body(self):
        assert MembershipPlanValidator.validate_create('hello') == {
            'body': 'Must be a JSON object.',
        }
        assert MembershipPlanValidator.validate_create(None) == {
            'body': 'Must be a JSON object.',
        }

    def test_missing_required_fields(self):
        errors = MembershipPlanValidator.validate_create({})
        assert 'missing' in errors
        missing = set(errors['missing'])
        assert {'code', 'name', 'vertical_plan_type_id', 'tier'}.issubset(missing)

    def test_bad_code_format(self):
        bad_codes = [
            'Doctor_Starter',         # uppercase
            'doctor starter',         # space
            'doctor-starter',         # hyphen — not in allow-set
            '0_leading_digit',        # must start with letter
            'a',                      # too short (under 3)
            'a' * 65,                 # too long (over 60)
            'trailing_underscore_',   # must end alphanumeric
        ]
        for bc in bad_codes:
            data = {**self._good(), 'code': bc}
            errors = MembershipPlanValidator.validate_create(data)
            assert 'code' in errors, f'expected code error for {bc!r}'

    def test_accepts_well_formed_codes(self):
        good_codes = [
            'doctor_starter',
            'clinic_growth',
            'hospital_enterprise',
            'hospital_pro2',
            'a01',  # 3 chars, letter start, digit end
        ]
        for gc in good_codes:
            data = {**self._good(), 'code': gc}
            errors = MembershipPlanValidator.validate_create(data)
            assert 'code' not in errors, f'unexpected code error for {gc!r}'

    # (The old bad-'vertical' rows are gone with the enum itself —
    # verticals are tenant-defined VerticalPlanType rows now.)
    @pytest.mark.parametrize('field,bad_value', [
        ('tier', 'enterprise'),  # we use display name 'enterprise' but enum value is 'pro'
        ('tier', 'starter'),
        ('status', 'live'),
    ])
    def test_rejects_bad_enum_values(self, field, bad_value):
        data = {**self._good(), field: bad_value}
        errors = MembershipPlanValidator.validate_create(data)
        assert field in errors

    def test_commission_pct_must_be_in_range(self):
        for bad in (-1, -0.5, 101, 150):
            data = {**self._good(), 'commission_pct': bad}
            errors = MembershipPlanValidator.validate_create(data)
            assert (
                'non_negative_number' in errors or 'above_max' in errors
            ), f'expected range error for commission_pct={bad}'

    def test_commission_pct_accepts_boundaries(self):
        for ok in (0, 0.5, 50, 100):
            data = {**self._good(), 'commission_pct': ok}
            errors = MembershipPlanValidator.validate_create(data)
            assert 'non_negative_number' not in errors
            assert 'above_max' not in errors

    def test_commission_pct_can_be_none(self):
        # ``None`` means "no commission configured" — pricing page
        # renders without a fee chip. Validator must accept.
        data = {**self._good(), 'commission_pct': None}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'non_negative_number' not in errors

    def test_prices_can_be_none(self):
        data = {
            **self._good(),
            'price_inr_monthly': None,
            'price_inr_annual': None,
        }
        errors = MembershipPlanValidator.validate_create(data)
        assert 'non_negative_number' not in errors

    def test_negative_prices_rejected(self):
        data = {**self._good(), 'price_inr_monthly': -100}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'non_negative_number' in errors
        assert 'price_inr_monthly' in errors['non_negative_number']

    def test_features_must_be_dict(self):
        data = {**self._good(), 'features': ['oops', 'not a dict']}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'features' in errors

    def test_features_none_is_allowed(self):
        # Routes default to ``{}`` server-side when features is omitted
        # / null, so validator should not block.
        data = {**self._good(), 'features': None}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'features' not in errors

    def test_is_featured_must_be_bool(self):
        data = {**self._good(), 'is_featured': 'yes'}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'is_featured' in errors

    def test_bool_is_not_a_valid_number(self):
        """Python's ``isinstance(True, int)`` is True — the validator
        must reject booleans where a numeric is expected to avoid
        ``price_inr_monthly=True`` silently writing 1."""
        data = {**self._good(), 'price_inr_monthly': True}
        errors = MembershipPlanValidator.validate_create(data)
        assert 'non_negative_number' in errors


# --------------------------------------------------------------------------- #
# Update — partial payloads
# --------------------------------------------------------------------------- #

class TestValidateUpdate:

    def test_empty_payload_is_valid(self):
        # Partial-update — empty body means "no changes", still valid.
        assert MembershipPlanValidator.validate_update({}) == {}

    def test_status_only_payload(self):
        # Mirrors the row's clickable-status-chip flow:
        # ``PUT /membership-plans/<code>`` with body ``{status:active}``.
        assert MembershipPlanValidator.validate_update({'status': 'active'}) == {}

    def test_invalid_status_rejected(self):
        errors = MembershipPlanValidator.validate_update({'status': 'live'})
        assert 'status' in errors

    def test_rejects_non_dict_body(self):
        assert MembershipPlanValidator.validate_update(42) == {
            'body': 'Must be a JSON object.',
        }

    def test_commission_pct_range_enforced_on_update(self):
        errors = MembershipPlanValidator.validate_update({'commission_pct': 150})
        assert 'above_max' in errors
