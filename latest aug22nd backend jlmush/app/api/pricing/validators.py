"""Hand-rolled validators for the pricing module.

Same static-method pattern as :class:`app.api.common.appointment.validators.AppointmentValidator`.
Every payload touching a JSON feature tree, addon limits, or override block
goes through one of these before it reaches the DB.
"""
from __future__ import annotations
import uuid


# One source of truth with the resolver — a key the service accepts but
# the validator rejects means an add-on that cannot be saved at all
# (exactly what happened to the entity axes).
from app.api.pricing.service import (
    ALLOWED_FEATURE_PATHS, KNOWN_USAGE_METRICS, _LIMIT_ROLES, _walk_features,
)

# Allowed window keys inside a usage_limits / usage_deltas block.
_USAGE_WINDOW_KEYS = frozenset({
    'monthly', 'daily', 'rolling_days', 'rolling_limit',
})


def _collect_feature_errors(features: dict, *, errors: dict, field_prefix: str) -> None:
    if not isinstance(features, dict):
        errors[field_prefix] = 'Must be an object.'
        return
    for path, leaf in _walk_features(features):
        if path not in ALLOWED_FEATURE_PATHS:
            errors.setdefault(f'{field_prefix}.unknown_paths', []).append(path)
            continue
        if isinstance(leaf, bool):
            continue
        if isinstance(leaf, dict):
            enabled = leaf.get('enabled')
            if not isinstance(enabled, bool):
                errors.setdefault(f'{field_prefix}.invalid_leaves', []).append(path)
            continue
        errors.setdefault(f'{field_prefix}.invalid_leaves', []).append(path)


def _validate_limits_block(block: dict, *, errors: dict, field_prefix: str,
                           allow_negative: bool = False) -> None:
    if not isinstance(block, dict):
        errors[field_prefix] = 'Must be an object.'
        return
    for role, value in block.items():
        if role not in _LIMIT_ROLES:
            errors.setdefault(f'{field_prefix}.unknown_roles', []).append(role)
            continue
        if not isinstance(value, int) or isinstance(value, bool):
            errors.setdefault(f'{field_prefix}.non_integer', []).append(role)
            continue
        if not allow_negative and value < 0:
            errors.setdefault(f'{field_prefix}.negative', []).append(role)


def _validate_usage_block(block: dict, *, errors: dict, field_prefix: str,
                          allow_sentinels: bool = True) -> None:
    """Validate a ``usage_limits`` / ``usage_deltas`` JSON block.

    Shape:
        { "<metric>": { "monthly": int, "daily": int?,
                        "rolling_days": int?, "rolling_limit": int? } }

    Backend convention: ``-1`` = unlimited, ``0`` = disabled, positive int = cap.
    For ``usage_deltas`` (additive), only positive deltas are meaningful;
    we still allow ``-1`` so an add-on can promote a metric to "unlimited".
    """
    if not isinstance(block, dict):
        errors[field_prefix] = 'Must be an object.'
        return
    for metric, windows in block.items():
        if metric not in KNOWN_USAGE_METRICS:
            errors.setdefault(f'{field_prefix}.unknown_metrics', []).append(metric)
            continue
        if not isinstance(windows, dict):
            errors.setdefault(f'{field_prefix}.invalid', []).append(metric)
            continue
        for win, value in windows.items():
            if win not in _USAGE_WINDOW_KEYS:
                errors.setdefault(f'{field_prefix}.unknown_windows', []).append(
                    f'{metric}.{win}',
                )
                continue
            if not isinstance(value, int) or isinstance(value, bool):
                errors.setdefault(f'{field_prefix}.non_integer', []).append(
                    f'{metric}.{win}',
                )
                continue
            # rolling_days must be positive when present
            if win == 'rolling_days' and value <= 0:
                errors.setdefault(f'{field_prefix}.invalid_rolling', []).append(
                    metric,
                )
            # negative not allowed except the -1 unlimited sentinel on cap fields
            if value < 0 and not (allow_sentinels and value == -1
                                  and win in ('monthly', 'daily', 'rolling_limit')):
                errors.setdefault(f'{field_prefix}.negative', []).append(
                    f'{metric}.{win}',
                )
        # rolling_days + rolling_limit must come together
        has_rd = 'rolling_days' in windows
        has_rl = 'rolling_limit' in windows
        if has_rd != has_rl:
            errors.setdefault(f'{field_prefix}.rolling_pair', []).append(metric)


def _validate_prerequisites(prereqs, *, errors: dict, field_prefix: str) -> None:
    if prereqs is None:
        return
    if not isinstance(prereqs, list):
        errors[field_prefix] = 'Must be a list of addon codes.'
        return
    for p in prereqs:
        if not isinstance(p, str) or not p.startswith('addon_'):
            errors.setdefault(f'{field_prefix}.invalid', []).append(repr(p))


# --------------------------------------------------------------------------- #
# PlanValidator
# --------------------------------------------------------------------------- #

class PlanValidator:

    _REQUIRED_FIELDS = (
        "code",
        "name",
        "saas_plan_type_id",
        "max_total_users",
        "max_super_admins",
        "max_sub_admins",
        "max_providers",
        "features",
    )
    _ALLOWED_STATUSES = frozenset({'draft', 'active', 'archived'})

    _CAP_KEYS = frozenset({'total', 'super_admin', 'sub_admin', 'provider',
                           'doctor', 'clinic', 'hospital'})
    _CAP_TRACKS = frozenset({'subdomain', 'custom_domain'})

    @staticmethod
    def _check_pricing(data, errors):
        """Enforce the price contract the whole stack already assumes:
        a number >= 0 sells at that rate, ``-1`` means contact-sales,
        and a blank/absent period simply isn't offered. Nothing
        validated this before, so a stray string reached a bare
        ``float()`` and 500'd, and a negative like -7 was stored as a
        price no consumer could interpret."""
        from app.api.pricing.plan_catalog_service import PRICING_PERIODS

        for period in PRICING_PERIODS:
            for prefix in ('price_inr_', 'og_price_inr_'):
                key = prefix + period
                if key not in data:
                    continue
                raw = data.get(key)
                if raw is None or raw == '':
                    continue          # blank = period not offered
                try:
                    val = float(raw)
                except (TypeError, ValueError):
                    errors[key] = 'Must be a number, -1, or blank.'
                    continue
                if val < 0 and val != -1:
                    errors[key] = (
                        'Use -1 for "contact sales", 0 for free, or a '
                        'positive price.')

    @staticmethod
    def _check_marketing(data, errors):
        if 'benefits' in data and data['benefits'] is not None:
            vals = data['benefits']
            if (not isinstance(vals, list) or len(vals) > 30
                    or any(not isinstance(b, str) or len(b) > 200
                           for b in vals)):
                errors['benefits'] = (
                    'Up to 30 short text lines (max 200 chars each).')
        if 'child_plan_caps' in data and data['child_plan_caps'] is not None:
            caps = data['child_plan_caps']

            def _flat_ok(d):
                return (isinstance(d, dict)
                        and all(k in PlanValidator._CAP_KEYS for k in d)
                        and all(isinstance(v, int)
                                and not isinstance(v, bool) and v >= 0
                                for v in d.values()))

            if not isinstance(caps, dict):
                bad = True
            elif set(caps) & PlanValidator._CAP_TRACKS:
                # Two-track shape: {subdomain: {...}, custom_domain: {...}}
                # — each track a flat caps dict (or null = uncapped track).
                bad = (any(k not in PlanValidator._CAP_TRACKS for k in caps)
                       or any(v is not None and not _flat_ok(v)
                              for v in caps.values()))
            else:
                bad = not _flat_ok(caps)
            if bad:
                errors['child_plan_caps'] = (
                    'Either a flat caps object or {subdomain, '
                    'custom_domain} tracks; keys total/super_admin/'
                    'sub_admin/provider/doctor/clinic/hospital with '
                    'non-negative integer values.')
            else:
                # Same rule the plan's own seats obey: the per-role
                # ceilings cannot add up to more than the total, or the
                # cap is self-contradictory (and the apex could author a
                # plan that satisfies each role yet breaks the total).
                blocks = ([(k, v) for k, v in caps.items()
                           if isinstance(v, dict)]
                          if set(caps) & PlanValidator._CAP_TRACKS
                          else [(None, caps)])
                for track, block in blocks:
                    roles = ('super_admin', 'sub_admin', 'provider')
                    if 'total' not in block or not all(
                            r in block for r in roles):
                        continue
                    per_role = sum(int(block[r]) for r in roles)
                    if int(block['total']) < per_role:
                        key = ('child_plan_caps.%s' % track if track
                               else 'child_plan_caps')
                        errors[key] = (
                            'Total users (%d) must be at least the sum of '
                            'super admins + sub admins + providers (%d).'
                            % (int(block['total']), per_role))

    _CARD_DISPLAY_KEYS = frozenset({
        'show_addons_main', 'show_addons_subdomain_child',
        'show_addons_custom_domain_child',
    })

    @staticmethod
    def _check_card_display(data, errors):
        if 'card_display' not in data or data['card_display'] is None:
            return
        cd = data['card_display']
        if (not isinstance(cd, dict)
                or any(k not in PlanValidator._CARD_DISPLAY_KEYS
                       for k in cd)
                or any(not isinstance(v, bool) for v in cd.values())):
            errors['card_display'] = (
                'Boolean flags: ' +
                ', '.join(sorted(PlanValidator._CARD_DISPLAY_KEYS)) + '.')

    @staticmethod
    def _check_addon_terms(data, errors):
        """Per-plan add-on terms: {addon_code: tier-shaped dict | null}.
        Same field rules as an add-on tier (AddonValidator does the
        per-entry work); null = this plan does not offer the add-on."""
        if 'addon_terms' not in data or data['addon_terms'] is None:
            return
        terms = data['addon_terms']
        if not isinstance(terms, dict):
            errors['addon_terms'] = 'Must be an object keyed by add-on code.'
            return
        for code, t in terms.items():
            if not isinstance(code, str) or not code.strip():
                errors['addon_terms'] = 'Keys must be add-on codes.'
                return
            if t is None:
                continue
            sub_errors = {}
            AddonValidator._check_tiers({'tiers': {'main': t}}, sub_errors)
            for k, msg in sub_errors.items():
                errors[k.replace('tiers.main', f'addon_terms.{code}')] = msg

    @staticmethod
    def _check_retention(data, errors):
        # A cleared UI number field arrives as 0 - honoring it would
        # schedule a same-day archive-and-delete. Floor at 1 day.
        if 'data_retention_days' in data:
            try:
                if int(data.get('data_retention_days')) < 1:
                    errors['data_retention_days'] = 'Must be at least 1 day.'
            except (TypeError, ValueError):
                errors['data_retention_days'] = 'Must be a number of days.'
    _ALLOWED_OVER_LIMIT_ACTIONS = frozenset({
        'block_new', 'grace_then_suspend', 'suspend_immediately',
    })
    _ALLOWED_KINDS = frozenset({'normal', 'apex'})

    @staticmethod
    def _validate_kind_block(data: dict, errors: dict) -> None:
        """Reseller fields: ``kind`` + the child quotas apex plans carry.

        Child quotas are strict ``>= 0`` ints (no ``-1`` sentinels — house
        rule) and only meaningful with ``kind='apex'``; the cross-field
        rule is validated here for creates (kind present or defaulted) and
        backstopped by the DB CHECK for updates that omit ``kind``.
        """
        kind = data.get('kind')
        if kind is not None and kind not in PlanValidator._ALLOWED_KINDS:
            errors['kind'] = f'Must be one of {sorted(PlanValidator._ALLOWED_KINDS)}.'

        for int_field in ('max_child_subdomains', 'max_child_custom_domains'):
            if int_field in data and data[int_field] is not None:
                value = data[int_field]
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    errors.setdefault('non_negative_int', []).append(int_field)

        has_quota = any(
            data.get(f) is not None
            for f in ('max_child_subdomains', 'max_child_custom_domains')
        )
        if has_quota and (kind or 'normal') != 'apex':
            errors['child_quotas'] = (
                'max_child_subdomains / max_child_custom_domains are only '
                "valid on kind='apex' plans."
            )

    @staticmethod
    def validate_create(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}

        for field_name in PlanValidator._REQUIRED_FIELDS:
            if field_name not in data:
                errors.setdefault('missing', []).append(field_name)

        for int_field in ('max_total_users', 'max_super_admins',
                          'max_sub_admins', 'max_providers', 'trial_days',
                          'grace_period_days'):
            if int_field in data and data[int_field] is not None:
                value = data[int_field]
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    errors.setdefault('non_negative_int', []).append(int_field)

        # Per-vertical provider-entity quotas. ``-1`` (unlimited) is a valid
        # sentinel here; the user-limit columns above use a strict ``>= 0``
        # rule. Caller must explicitly state per-vertical caps (NULL/missing
        # is accepted at validation time but enforcement treats it as 0).
        for int_field in ('max_provider_doctors', 'max_provider_clinics',
                          'max_provider_hospitals'):
            if int_field in data and data[int_field] is not None:
                value = data[int_field]
                if not isinstance(value, int) or isinstance(value, bool) or value < -1:
                    errors.setdefault('invalid_quota', []).append(int_field)

        if all(
            k in data and isinstance(data[k], int)
            for k in ('max_total_users', 'max_super_admins', 'max_sub_admins', 'max_providers')
        ):
            if data['max_total_users'] < (
                data['max_super_admins'] + data['max_sub_admins'] + data['max_providers']
            ):
                errors['limits_sum'] = (
                    'max_total_users must be >= sum of per-role limits.'
                )

        PlanValidator._validate_kind_block(data, errors)

        status = data.get('status')
        if status is not None and status not in PlanValidator._ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(PlanValidator._ALLOWED_STATUSES)}.'

        ola = data.get('over_limit_action')
        if ola is not None and ola not in PlanValidator._ALLOWED_OVER_LIMIT_ACTIONS:
            errors['over_limit_action'] = (
                f'Must be one of {sorted(PlanValidator._ALLOWED_OVER_LIMIT_ACTIONS)}.'
            )

        if 'features' in data:
            _collect_feature_errors(
                data['features'], errors=errors, field_prefix='features',
            )
        if 'usage_limits' in data and data['usage_limits'] is not None:
            _validate_usage_block(
                data['usage_limits'], errors=errors,
                field_prefix='usage_limits', allow_sentinels=True,
            )
        if 'default_addons' in data and data['default_addons'] is not None:
            _validate_prerequisites(
                data['default_addons'], errors=errors,
                field_prefix='default_addons',
            )
        if 'saas_plan_type_id' in data                 and data['saas_plan_type_id'] not in (None, ''):
            # Null/blank means "no type" — a legal state (e.g. internal
            # ops plans); rejecting it made such plans uneditable from
            # the UI, which always echoes the field back.
            try:
                uuid.UUID(str(data['saas_plan_type_id']))
            except (ValueError, TypeError):
                errors['saas_plan_type_id'] = 'Must be a valid UUID.'

        PlanValidator._check_retention(data, errors)
        PlanValidator._check_marketing(data, errors)
        PlanValidator._check_pricing(data, errors)
        PlanValidator._check_addon_terms(data, errors)
        PlanValidator._check_card_display(data, errors)
        return errors

    @staticmethod
    def validate_update(data: dict) -> dict:
        # Update allows partial payloads — same checks but without required-field check.
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}
        PlanValidator._validate_kind_block(data, errors)
        for int_field in ('max_total_users', 'max_super_admins',
                          'max_sub_admins', 'max_providers', 'trial_days',
                          'grace_period_days'):
            if int_field in data and data[int_field] is not None:
                value = data[int_field]
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    errors.setdefault('non_negative_int', []).append(int_field)

        # Per-vertical provider-entity quotas. ``-1`` (unlimited) is a valid
        # sentinel here; the user-limit columns above use a strict ``>= 0``
        # rule. Caller must explicitly state per-vertical caps (NULL/missing
        # is accepted at validation time but enforcement treats it as 0).
        for int_field in ('max_provider_doctors', 'max_provider_clinics',
                          'max_provider_hospitals'):
            if int_field in data and data[int_field] is not None:
                value = data[int_field]
                if not isinstance(value, int) or isinstance(value, bool) or value < -1:
                    errors.setdefault('invalid_quota', []).append(int_field)
        if 'features' in data:
            _collect_feature_errors(
                data['features'], errors=errors, field_prefix='features',
            )
        if 'status' in data and data['status'] not in PlanValidator._ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(PlanValidator._ALLOWED_STATUSES)}.'
        if 'over_limit_action' in data \
                and data['over_limit_action'] not in PlanValidator._ALLOWED_OVER_LIMIT_ACTIONS:
            errors['over_limit_action'] = (
                f'Must be one of {sorted(PlanValidator._ALLOWED_OVER_LIMIT_ACTIONS)}.'
            )
        if 'usage_limits' in data and data['usage_limits'] is not None:
            _validate_usage_block(
                data['usage_limits'], errors=errors,
                field_prefix='usage_limits', allow_sentinels=True,
            )
        if 'default_addons' in data and data['default_addons'] is not None:
            _validate_prerequisites(
                data['default_addons'], errors=errors,
                field_prefix='default_addons',
            )
        if 'saas_plan_type_id' in data                 and data['saas_plan_type_id'] not in (None, ''):
            # Null/blank means "no type" — a legal state (e.g. internal
            # ops plans); rejecting it made such plans uneditable from
            # the UI, which always echoes the field back.
            try:
                uuid.UUID(str(data['saas_plan_type_id']))
            except (ValueError, TypeError):
                errors['saas_plan_type_id'] = 'Must be a valid UUID.'

        PlanValidator._check_retention(data, errors)
        PlanValidator._check_marketing(data, errors)
        PlanValidator._check_pricing(data, errors)
        PlanValidator._check_addon_terms(data, errors)
        PlanValidator._check_card_display(data, errors)
        return errors


# --------------------------------------------------------------------------- #
# AddonValidator
# --------------------------------------------------------------------------- #

class AddonValidator:

    _REQUIRED_FIELDS = ('code', 'name')
    _ALLOWED_STATUSES = frozenset({'draft', 'active', 'archived'})
    _TIER_KEYS = frozenset({'main', 'subdomain_child', 'custom_domain_child'})
    _TIER_FIELDS = frozenset({'active', 'units', 'price_inr', 'og_price_inr',
                              'min_qty', 'max_qty', 'billing_cycle'})
    _TIER_CYCLES = frozenset({'one_time', 'monthly', 'quarterly',
                              'semi_annual', 'annual', 'biennial',
                              'triennial'})

    @staticmethod
    def _check_tiers(data, errors):
        """Validate the per-buyer-tier commercial terms. Shape:
        {main|subdomain_child|custom_domain_child: {active, units,
        price_inr, og_price_inr, min_qty, max_qty, billing_cycle}}.
        A null tier value or absent key = not offered at that tier."""
        if 'tiers' not in data or data['tiers'] is None:
            return
        tiers = data['tiers']
        if not isinstance(tiers, dict):
            errors['tiers'] = 'Must be an object keyed by buyer tier.'
            return
        unknown = set(tiers) - AddonValidator._TIER_KEYS
        if unknown:
            errors['tiers'] = (
                f'Unknown tier keys {sorted(unknown)}; allowed: '
                f'{sorted(AddonValidator._TIER_KEYS)}.')
            return
        for key, t in tiers.items():
            if t is None:
                continue                      # explicitly not offered
            pre = f'tiers.{key}'
            if not isinstance(t, dict):
                errors[pre] = 'Must be an object or null.'
                continue
            bad = set(t) - AddonValidator._TIER_FIELDS
            if bad:
                errors[pre] = f'Unknown fields {sorted(bad)}.'
                continue
            if 'active' in t and not isinstance(t['active'], bool):
                errors[f'{pre}.active'] = 'Must be true or false.'
            units = t.get('units', 1)
            if not isinstance(units, int) or isinstance(units, bool)                     or units < 1:
                errors[f'{pre}.units'] = 'Must be an integer >= 1.'
            for pf in ('price_inr', 'og_price_inr'):
                v = t.get(pf)
                if v is None:
                    continue
                if isinstance(v, bool) or not isinstance(v, (int, float))                         or v < 0:
                    errors[f'{pre}.{pf}'] = 'Must be a number >= 0.'
            mn = t.get('min_qty', 1)
            if not isinstance(mn, int) or isinstance(mn, bool) or mn < 1:
                errors[f'{pre}.min_qty'] = 'Must be an integer >= 1.'
                mn = 1
            mx = t.get('max_qty')
            if mx is not None:
                if not isinstance(mx, int) or isinstance(mx, bool) or mx < 1:
                    errors[f'{pre}.max_qty'] = 'Must be an integer >= 1 or null.'
                elif mx < mn:
                    errors[f'{pre}.max_qty'] = 'Must be >= min_qty.'
            cyc = t.get('billing_cycle')
            if cyc is not None and cyc not in AddonValidator._TIER_CYCLES:
                errors[f'{pre}.billing_cycle'] = (
                    f'Must be one of {sorted(AddonValidator._TIER_CYCLES)}.')

    @staticmethod
    def validate_create(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}
        for f in AddonValidator._REQUIRED_FIELDS:
            if f not in data:
                errors.setdefault('missing', []).append(f)

        if 'features' in data and data['features'] is not None:
            _collect_feature_errors(
                data['features'], errors=errors, field_prefix='features',
            )
        if 'limits' in data and data['limits'] is not None:
            _validate_limits_block(
                data['limits'], errors=errors, field_prefix='limits',
                allow_negative=True,
            )

        status = data.get('status')
        if status is not None and status not in AddonValidator._ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(AddonValidator._ALLOWED_STATUSES)}.'

        if 'usage_deltas' in data and data['usage_deltas'] is not None:
            _validate_usage_block(
                data['usage_deltas'], errors=errors,
                field_prefix='usage_deltas', allow_sentinels=True,
            )
        if 'prerequisites' in data:
            _validate_prerequisites(
                data['prerequisites'], errors=errors,
                field_prefix='prerequisites',
            )

        # Require at least one of features/limits/usage_deltas to be meaningful.
        has_features = bool(data.get('features'))
        has_limits = bool(data.get('limits'))
        has_usage = bool(data.get('usage_deltas'))
        if not has_features and not has_limits and not has_usage:
            errors['empty_addon'] = 'Add-on must carry features, limits, or usage_deltas.'

        AddonValidator._check_tiers(data, errors)
        return errors

    @staticmethod
    def validate_update(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}
        if 'features' in data and data['features'] is not None:
            _collect_feature_errors(
                data['features'], errors=errors, field_prefix='features',
            )
        if 'limits' in data and data['limits'] is not None:
            _validate_limits_block(
                data['limits'], errors=errors, field_prefix='limits',
                allow_negative=True,
            )
        if 'usage_deltas' in data and data['usage_deltas'] is not None:
            _validate_usage_block(
                data['usage_deltas'], errors=errors,
                field_prefix='usage_deltas', allow_sentinels=True,
            )
        if 'prerequisites' in data:
            _validate_prerequisites(
                data['prerequisites'], errors=errors,
                field_prefix='prerequisites',
            )
        if 'status' in data and data['status'] not in AddonValidator._ALLOWED_STATUSES:
            errors['status'] = f'Must be one of {sorted(AddonValidator._ALLOWED_STATUSES)}.'
        AddonValidator._check_tiers(data, errors)
        return errors


# --------------------------------------------------------------------------- #
# SubscriptionValidator
# --------------------------------------------------------------------------- #

class SubscriptionValidator:

    _ALLOWED_CYCLES = frozenset({'monthly', 'quarterly', 'semi_annual',
                                'annual', 'biennial', 'triennial'})

    @staticmethod
    def validate_assign(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}
        if 'plan_code' not in data:
            errors.setdefault('missing', []).append('plan_code')
        cycle = data.get('billing_cycle')
        if cycle is not None and cycle not in SubscriptionValidator._ALLOWED_CYCLES:
            errors['billing_cycle'] = (
                f'Must be one of {sorted(SubscriptionValidator._ALLOWED_CYCLES)}.'
            )
        overrides = data.get('overrides')
        if overrides is not None:
            ov_errors = PlanOverrideValidator.validate(overrides)
            if ov_errors:
                errors['overrides'] = ov_errors
        return errors


# --------------------------------------------------------------------------- #
# PlanOverrideValidator
# --------------------------------------------------------------------------- #

class PlanOverrideValidator:

    _ALLOWED_TOP_KEYS = frozenset({'limits', 'features'})

    @staticmethod
    def validate(overrides: dict) -> dict:
        errors: dict = {}
        if overrides is None:
            return errors
        if not isinstance(overrides, dict):
            return {'body': 'overrides must be an object.'}
        unknown = set(overrides.keys()) - PlanOverrideValidator._ALLOWED_TOP_KEYS
        if unknown:
            errors['unknown_keys'] = sorted(unknown)

        if 'limits' in overrides and overrides['limits'] is not None:
            _validate_limits_block(
                overrides['limits'], errors=errors, field_prefix='limits',
                allow_negative=False,  # overrides are absolute caps
            )
        if 'features' in overrides and overrides['features'] is not None:
            _collect_feature_errors(
                overrides['features'], errors=errors, field_prefix='features',
            )
        return errors
