"""Marshmallow schemas for platform (owner) endpoints."""
from marshmallow import Schema, fields, validate


class TenantCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=300))
    # Either slug OR domain (or both) — service-layer enforces the OR.
    # When only domain is supplied, the service derives a slug from it.
    slug = fields.Str(
        required=False,
        allow_none=True,
        validate=validate.Regexp(
            r'^[a-z0-9][a-z0-9-]{1,98}$',
            error='Lowercase letters, digits, and dashes only (max 99 chars)',
        ),
    )
    domain = fields.Str(validate=validate.Length(max=255), allow_none=True)
    logo_url = fields.Str(validate=validate.Length(max=500), allow_none=True)
    settings = fields.Dict(allow_none=True)
    auto_subdomain = fields.Bool(load_default=True)
    # Optional: pin a Plan + billing cycle at creation time so the new
    # tenant has a real ``TenantSubscription`` row from the start.
    # Without this the tenant would have no resolvable Plan, and any
    # feature/limit gate (PlanService.resolve) would 402. Codes must
    # match an existing ``plans.code`` row.
    plan_code = fields.Str(
        validate=validate.Length(min=1, max=50), allow_none=True,
    )
    billing_cycle = fields.Str(
        validate=validate.OneOf(['monthly', 'quarterly', 'semi_annual',
                                 'annual', 'biennial', 'triennial']),
        load_default='monthly',
    )


class TenantUpdateSchema(Schema):
    name = fields.Str(validate=validate.Length(min=1, max=300))
    domain = fields.Str(validate=validate.Length(max=255), allow_none=True)
    logo_url = fields.Str(validate=validate.Length(max=500), allow_none=True)
    status = fields.Str(validate=validate.OneOf(['active', 'inactive', 'suspended']))
    settings = fields.Dict(allow_none=True)
    auto_subdomain = fields.Bool()


class AllocationItemSchema(Schema):
    module = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    action = fields.Str(required=True, validate=validate.Length(min=1, max=50))
    allowed = fields.Bool(load_default=True)


class PermissionAllocationSchema(Schema):
    allocations = fields.List(fields.Nested(AllocationItemSchema), required=True)


class TenantSuperAdminSchema(Schema):
    """Payload for ``POST /api/platform/tenants/<id>/super-admin``.

    Every super_admin is tenant-scoped; this endpoint creates one inside the
    tenant named in the URL.
    """
    first_name = fields.Str(required=True, validate=validate.Length(min=1, max=50))
    last_name = fields.Str(required=False, validate=validate.Length(max=50), load_default='')
    phone_number = fields.Str(
        required=True,
        validate=validate.Regexp(
            r'^[6-9]\d{9}$',
            error='Phone must be a 10-digit Indian mobile starting with 6, 7, 8, or 9.',
        ),
    )
    email = fields.Email(required=False, allow_none=True, load_default=None)
    password = fields.Str(required=True, validate=validate.Length(min=8, max=128))
