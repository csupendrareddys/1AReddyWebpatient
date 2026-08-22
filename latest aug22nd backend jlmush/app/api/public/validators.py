"""Input validators for the public self-serve signup.

Hand-rolled, same pattern as ``AppointmentValidator``. Normalises the
subdomain slug to the allowed shape and checks that the admin payload
has the minimum set of fields expected by ``SuperAdminService.create_admin``.
"""
from __future__ import annotations

import re


_SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')

# Reserved slugs: platform anchor + paths the main app owns. Prevents a
# self-serve tenant from claiming ``platform.<apex>`` or ``api.<apex>``.
_RESERVED_SLUGS = frozenset({
    'platform', 'api', 'www', 'admin', 'app', 'mail', 'smtp', 'support',
    'billing', 'dashboard', 'auth', 'login', 'signup',
})


class TenantSignupValidator:

    @staticmethod
    def validate(data: dict) -> dict:
        errors: dict = {}
        if not isinstance(data, dict):
            return {'body': 'Must be a JSON object.'}

        tenant = data.get('tenant') or {}
        admin = data.get('admin') or {}
        plan_code = data.get('plan_code')

        # ── Plan ──
        if not plan_code or not isinstance(plan_code, str):
            errors.setdefault('missing', []).append('plan_code')

        # ── Billing cycle (optional; downstream defaults to monthly) ──
        # Literals mirror models._enums.BillingCycle — an unknown value
        # would 500 inside BillingCycle(cycle_str) if let through.
        cycle = data.get('billing_cycle')
        if cycle is not None and cycle not in (
                'monthly', 'quarterly', 'semi_annual',
                'annual', 'biennial', 'triennial'):
            errors['billing_cycle'] = "Must be 'monthly' or 'annual'."

        # ── Tenant ──
        if not isinstance(tenant, dict):
            errors['tenant'] = 'Must be an object.'
        else:
            name = (tenant.get('name') or '').strip()
            slug_raw = (tenant.get('slug') or '').strip().lower()
            if not name:
                errors.setdefault('tenant.missing', []).append('name')
            elif len(name) > 300:
                errors['tenant.name'] = 'Too long (max 300 chars).'
            if not slug_raw:
                errors.setdefault('tenant.missing', []).append('slug')
            elif not _SLUG_RE.match(slug_raw):
                errors['tenant.slug'] = (
                    'Must be 3-50 chars, lowercase letters, digits and hyphens; '
                    'cannot start or end with a hyphen.'
                )
            elif slug_raw in _RESERVED_SLUGS:
                errors['tenant.slug'] = f'Slug "{slug_raw}" is reserved.'

        # ── Admin ──
        if not isinstance(admin, dict):
            errors['admin'] = 'Must be an object.'
        else:
            for f in ('first_name', 'last_name', 'phone_number', 'password'):
                if not (admin.get(f) or '').strip():
                    errors.setdefault('admin.missing', []).append(f)
            pwd = admin.get('password') or ''
            if pwd and len(pwd) < 8:
                errors['admin.password'] = 'Must be at least 8 characters.'
            phone = re.sub(r'[\s\-]', '', admin.get('phone_number') or '')
            if phone.startswith('+91'):
                phone = phone[3:]
            elif phone.startswith('91') and len(phone) == 12:
                phone = phone[2:]
            if phone and not re.match(r'^[6-9]\d{9}$', phone):
                errors['admin.phone_number'] = (
                    'Must be a 10-digit Indian phone number starting with 6-9.'
                )
            email = admin.get('email') or ''
            if email and not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
                errors['admin.email'] = 'Invalid email.'

        picks = data.get('addons')
        if picks is not None:
            if not isinstance(picks, list) or len(picks) > 20:
                errors['addons'] = 'Up to 20 {code, quantity} entries.'
            else:
                for i, r in enumerate(picks):
                    if (not isinstance(r, dict)
                            or not isinstance(r.get('code'), str)
                            or not str(r.get('code')).strip()):
                        errors[f'addons.{i}'] = 'code is required.'
                        continue
                    q = r.get('quantity')
                    if not isinstance(q, int) or isinstance(q, bool) \
                            or q < 1 or q > 999:
                        errors[f'addons.{i}'] = (
                            'quantity must be an integer 1-999.')
        return errors
