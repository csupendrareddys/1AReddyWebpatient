"""Validators for marketplace ``MembershipPlan`` admin payloads.

Mirrors the style of ``app.api.pricing.validators.PlanValidator`` — same
shape (``validate_create`` / ``validate_update``), same error-dict
contract, returns ``{}`` on success. The route layer hands the dict
straight to ``validation_error_response``.

Kept distinct from the SaaS PlanValidator because the field set is
different — no over-limit action, but does carry ``vertical`` / ``tier`` /
``commission_pct`` / ``platform_fee_inr`` / ``is_featured`` / ``sort_order``.
The two capacity caps it does have (``max_support_staff`` /
``max_link_connections``) count what a MEMBER holds, not what a tenant does,
and read NULL as unlimited rather than as deny — see the column comments on
``MembershipPlan``.
"""
from __future__ import annotations

import re


_ALLOWED_VERTICALS = frozenset({'doctor', 'clinic', 'hospital'})
_ALLOWED_TIERS = frozenset({'basic', 'growth', 'pro'})
_ALLOWED_STATUSES = frozenset({'draft', 'active', 'archived'})
_ALLOWED_CHARGE_TYPES = frozenset({'percentage', 'fixed'})

# The three platform charges relocated from BillingConfig. Each has a
# ``_name`` (free string), ``_type`` (percentage|fixed) and non-negative
# ``_value``. Shared by create + update so both stay in lockstep.
_CHARGE_NUM = (1, 2, 3)


# The two capacity caps. Both are nullable ("unlimited") and both accept the
# ``-1`` spelling of unlimited an operator may type out of habit from the SaaS
# plan form — the route normalises it to None so only one spelling is stored.
_LIMIT_FIELDS = ('max_support_staff', 'max_link_connections')


def _validate_limits(data: dict, errors: dict) -> None:
    for field_name in _LIMIT_FIELDS:
        if field_name not in data or data[field_name] is None:
            continue
        # A cleared field. The form sends null, but ``''`` is what a hand-
        # written call or an older client sends for the same intent, and the
        # route's ``_normalise_limit`` already folds it into NULL — rejecting
        # it here would make the validator and the normaliser disagree about
        # what "unlimited" looks like.
        if isinstance(data[field_name], str) and not data[field_name].strip():
            continue
        _check_number(
            data[field_name], field=field_name, errors=errors,
            allow_none=True, allow_custom=True,
        )
        # A cap has to be a whole number of people. 2.5 seats would round
        # somewhere invisible and the meter would disagree with the refusal.
        value = data[field_name]
        if isinstance(value, float) and not value.is_integer():
            errors[field_name] = 'Must be a whole number.'


def _validate_charges(data: dict, errors: dict) -> None:
    for n in _CHARGE_NUM:
        # Both the charge itself and its optional tax share the same
        # {type ∈ percentage|fixed, value >= 0} shape.
        for prefix in (f'charge{n}', f'charge{n}_tax'):
            type_key = f'{prefix}_type'
            value_key = f'{prefix}_value'
            if type_key in data and data[type_key] is not None:
                if data[type_key] not in _ALLOWED_CHARGE_TYPES:
                    errors[type_key] = (
                        f'Must be one of {sorted(_ALLOWED_CHARGE_TYPES)}.'
                    )
            if value_key in data and data[value_key] is not None:
                _check_number(data[value_key], field=value_key, errors=errors)

# Billing periods carried on the pricing payload. Each has a ``price_inr_*``
# and a "no discount" ``og_price_inr_*`` twin. ``-1`` on any of these means
# "Custom / Contact sales"; blank/0 means the period isn't offered.
_PRICING_PERIODS = (
    'monthly', 'quarterly', 'semi_annual', 'annual', 'biennial', 'triennial',
)
_PRICE_FIELDS = tuple(
    f'{prefix}{period}'
    for period in _PRICING_PERIODS
    for prefix in ('price_inr_', 'og_price_inr_')
)

# Same code-format rule as SaaS Plan codes elsewhere — lowercase
# ``[a-z0-9_]+`` so we can use the code as a stable URL slug.
_CODE_RE = re.compile(r'^[a-z][a-z0-9_]{1,58}[a-z0-9]$')


def _check_number(
    value, *, field: str, errors: dict,
    allow_none: bool = False, allow_zero: bool = True, max_value=None,
    allow_custom: bool = False,
) -> None:
    """Numeric guard. Coerces ints/floats; rejects ``bool``.

    ``allow_custom`` permits the ``-1`` sentinel used by price fields to
    mean "Custom / Contact sales" (blank/0 still means "period not
    offered"). It's accepted only for exactly ``-1`` — any other
    negative is still rejected.
    """
    if value is None:
        if not allow_none:
            errors.setdefault('non_negative_number', []).append(field)
        return
    if isinstance(value, bool):
        errors.setdefault('non_negative_number', []).append(field)
        return
    if not isinstance(value, (int, float)):
        errors.setdefault('non_negative_number', []).append(field)
        return
    if allow_custom and value == -1:
        return
    if value < 0 or (value == 0 and not allow_zero):
        errors.setdefault('non_negative_number', []).append(field)
        return
    if max_value is not None and value > max_value:
        errors.setdefault('above_max', []).append(field)


class MembershipPlanValidator:
    """Shape-checks the payload coming in to ``/api/platform/membership-plans``.

    Notes:
      * ``features`` is free-form in Round 1 (any dict accepted). Round 2
        will tighten this to a whitelisted feature-path set, mirroring
        the SaaS ``ALLOWED_FEATURE_PATHS`` guard.
      * ``vertical`` and ``tier`` are required on create — they pair to
        form the partial-unique index.
    """

    _REQUIRED_CREATE = ("code", "name", "vertical_plan_type_id", "tier")

    @staticmethod
    def validate_create(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}

        for field_name in MembershipPlanValidator._REQUIRED_CREATE:
            if field_name not in data or data[field_name] in (None, ''):
                errors.setdefault('missing', []).append(field_name)

        code = data.get('code')
        if isinstance(code, str) and not _CODE_RE.match(code):
            errors['code'] = (
                'Must be lowercase letters/digits/underscores, '
                'start with a letter, end alphanumeric (3-60 chars).'
            )

        tier = data.get('tier')
        if tier is not None and tier not in _ALLOWED_TIERS:
            errors['tier'] = f'Must be one of {sorted(_ALLOWED_TIERS)}.'

        status = data.get('status')
        if status is not None and status not in _ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(_ALLOWED_STATUSES)}.'

        # Numerics. Prices can be None ("Contact us") or -1 (Custom);
        # trial_days is required-int (server default 0 fills in if omitted).
        for f in _PRICE_FIELDS:
            if f in data:
                _check_number(data[f], field=f, errors=errors, allow_none=True, allow_custom=True)
        if 'platform_fee_inr' in data:
            _check_number(data['platform_fee_inr'], field='platform_fee_inr', errors=errors, allow_none=True)
        if 'trial_days' in data and data['trial_days'] is not None:
            _check_number(
                data['trial_days'], field='trial_days', errors=errors,
            )
        # payout_hold_days is nullable — None means "plan doesn't set a
        # hold", not "invalid", unlike trial_days which always has a value.
        if 'payout_hold_days' in data and data['payout_hold_days'] is not None:
            _check_number(
                data['payout_hold_days'], field='payout_hold_days', errors=errors,
            )
        if 'commission_pct' in data:
            _check_number(
                data['commission_pct'], field='commission_pct',
                errors=errors, allow_none=True, max_value=100,
            )
        # The tier's blanket member discount — same 0-100 range rule as
        # commission_pct, and nullable for "this tier grants none".
        if 'member_discount_pct' in data:
            _check_number(
                data['member_discount_pct'], field='member_discount_pct',
                errors=errors, allow_none=True, max_value=100,
            )
        if 'sort_order' in data and data['sort_order'] is not None:
            _check_number(
                data['sort_order'], field='sort_order', errors=errors,
            )

        if 'features' in data and data['features'] is not None:
            if not isinstance(data['features'], dict):
                errors['features'] = 'Must be a JSON object.'

        if 'is_featured' in data and not isinstance(
            data['is_featured'], bool,
        ):
            errors['is_featured'] = 'Must be a boolean.'

        _validate_charges(data, errors)
        _validate_limits(data, errors)

        return errors

    @staticmethod
    def validate_update(data: dict) -> dict:
        """Partial update — same rules as create, but no required-field check.

        ``code``, ``vertical``, and ``tier`` are technically mutable, but
        the route layer typically pins them by URL. We still validate
        them here so a stray field in the body is caught early.
        """
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}

        if 'code' in data:
            if not isinstance(data['code'], str) or not _CODE_RE.match(data['code']):
                errors['code'] = (
                    'Must be lowercase letters/digits/underscores, '
                    'start with a letter, end alphanumeric (3-60 chars).'
                )
        if 'tier' in data and data['tier'] not in _ALLOWED_TIERS:
            errors['tier'] = f'Must be one of {sorted(_ALLOWED_TIERS)}.'
        if 'status' in data and data['status'] not in _ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(_ALLOWED_STATUSES)}.'

        for f in _PRICE_FIELDS:
            if f in data:
                _check_number(data[f], field=f, errors=errors, allow_none=True, allow_custom=True)
        if 'platform_fee_inr' in data:
            _check_number(data['platform_fee_inr'], field='platform_fee_inr', errors=errors, allow_none=True)
        if 'trial_days' in data and data['trial_days'] is not None:
            _check_number(
                data['trial_days'], field='trial_days', errors=errors,
            )
        if 'payout_hold_days' in data and data['payout_hold_days'] is not None:
            _check_number(
                data['payout_hold_days'], field='payout_hold_days', errors=errors,
            )
        if 'commission_pct' in data:
            _check_number(
                data['commission_pct'], field='commission_pct',
                errors=errors, allow_none=True, max_value=100,
            )
        # The tier's blanket member discount — same 0-100 range rule as
        # commission_pct, and nullable for "this tier grants none".
        if 'member_discount_pct' in data:
            _check_number(
                data['member_discount_pct'], field='member_discount_pct',
                errors=errors, allow_none=True, max_value=100,
            )
        if 'sort_order' in data and data['sort_order'] is not None:
            _check_number(
                data['sort_order'], field='sort_order', errors=errors,
            )

        if 'features' in data and data['features'] is not None:
            if not isinstance(data['features'], dict):
                errors['features'] = 'Must be a JSON object.'
        if 'is_featured' in data and not isinstance(
            data['is_featured'], bool,
        ):
            errors['is_featured'] = 'Must be a boolean.'

        _validate_charges(data, errors)
        _validate_limits(data, errors)

        return errors
