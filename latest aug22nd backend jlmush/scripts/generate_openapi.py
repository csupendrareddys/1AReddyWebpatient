"""Generate the OpenAPI 3.1 spec for the mobile-facing API surface.

Run inside the backend container:

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \
        python scripts/generate_openapi.py
    docker cp jlmush-backend:/app/openapi/openapi.json openapi/openapi.json

(the ``docker cp`` because ``openapi/`` is not one of the compose bind
mounts). Commit the artifact — clients and the TS type generation
consume the file, not this script.

Design: paths and methods are INTROSPECTED from the live Flask url_map,
so the spec cannot drift on what exists or where it lives — regenerate
after adding routes and the diff shows exactly what changed. Operation
summaries come from view docstrings. On top of that, ``CURATED`` carries
hand-written request/response schemas for the endpoints the mobile MVP
calls on day one; everything else gets the standard envelope schemas
with an open body (``additionalProperties: true`` — honest: the server
may return more than the spec promises, never less).

TypeScript types are generated from the artifact in the frontend repo:

    npx openapi-typescript ../JlmushIITMbackend/openapi/openapi.json \
        -o src/api/types/api.d.ts
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── which first path segments (after /api/v1/) are the mobile surface ───────
SEGMENTS = {
    'auth', 'appointment', 'patient', 'timeslot', 'doctor', 'notifications',
    'payment', 'media', 'membership', 'service-communication', 'video',
    'profile',
}

# Auth endpoints reachable BEFORE a login exists.
PUBLIC_PATHS = {
    '/api/v1/auth/signin', '/api/v1/auth/signup', '/api/v1/auth/signup/doctor',
    '/api/v1/auth/signup/clinic', '/api/v1/auth/signup/hospital',
    '/api/v1/auth/login-via-otp', '/api/v1/auth/forgot-password',
    '/api/v1/auth/verify-reset-otp', '/api/v1/auth/reset-password',
    '/api/v1/auth/pre-signup/send-phone-otp',
    '/api/v1/auth/pre-signup/verify-phone-otp',
    '/api/v1/auth/pre-signup/send-email-otp',
    '/api/v1/auth/pre-signup/verify-email-otp',
    '/api/v1/auth/send-phone-otp', '/api/v1/auth/resend-phone-otp',
    '/api/v1/auth/send-email-otp', '/api/v1/auth/verify-email-otp',
    '/api/v1/auth/resend-email-otp',
    '/api/v1/media/{asset_id}',  # 'public'-access assets need no token
}

# Machine error codes a client may branch on. Status-default codes first,
# then the endpoint-specific ones (frozen UPPER legacy included).
ERROR_CODES = [
    'bad_request', 'unauthorized', 'payment_required', 'forbidden',
    'not_found', 'method_not_allowed', 'conflict', 'gone',
    'payload_too_large', 'unsupported_media_type', 'validation_error',
    'locked', 'client_update_required', 'rate_limited', 'server_error',
    'bad_gateway', 'service_unavailable', 'timeout',
    'token_expired', 'invalid_token', 'authorization_required',
    'token_verification_failed',
    'invalid_credentials', 'session_limit_reached', 'account_not_found',
    'otp_expired', 'otp_invalid', 'already_registered',
    'slot_taken', 'own_duplicate_booking', 'reschedule_window_closed',
    'gateway_not_configured', 'duplicate_transaction', 'signature_invalid',
    'feature_disabled', 'no_active_subscription', 'channel_readonly',
    'unknown_tenant',
    'ROLE_MISMATCH', 'EMAIL_NOT_VERIFIED', 'PHONE_NOT_VERIFIED',
    'PENDING_ACTIVATION', 'PASSWORD_ALREADY_SET', 'EMAIL_OTP_DISABLED',
]


def _ref(name):
    return {'$ref': f'#/components/schemas/{name}'}


def _obj(props, required=None, open_=True):
    schema = {'type': 'object', 'properties': props}
    if required:
        schema['required'] = required
    if open_:
        schema['additionalProperties'] = True
    return schema


COMPONENTS = {
    'securitySchemes': {
        'bearerAuth': {'type': 'http', 'scheme': 'bearer',
                       'bearerFormat': 'JWT'},
    },
    'parameters': {
        'XTenantHost': {
            'name': 'X-Tenant-Host', 'in': 'header', 'required': True,
            'schema': {'type': 'string'},
            'description': "The tenant's hostname (e.g. clinic.example.com). "
                           'Browsers convey this via the Host header; native '
                           'apps MUST send it explicitly on every request.',
        },
        'XClient': {
            'name': 'X-Client', 'in': 'header', 'required': False,
            'schema': {'type': 'string', 'enum': ['web', 'mobile', 'desktop']},
            'description': 'Client kind, for logs / rate limits / the '
                           'min-version gate. Absent reads as legacy web.',
        },
        'XClientVersion': {
            'name': 'X-Client-Version', 'in': 'header', 'required': False,
            'schema': {'type': 'string'},
            'description': 'Build version (semver-ish). Gated clients below '
                           'CLIENT_MIN_VERSIONS get 426 client_update_required.',
        },
        'XDeviceId': {
            'name': 'X-Device-Id', 'in': 'header', 'required': False,
            'schema': {'type': 'string', 'maxLength': 64},
            'description': 'Persistent per-install id. Log correlation only — '
                           'never a security input.',
        },
    },
    'schemas': {
        'ErrorCode': {'type': 'string', 'enum': ERROR_CODES,
                      'description': 'Machine-readable error code. Every error '
                                     'response carries one; clients branch on '
                                     'it, never on message text.'},
        'ErrorEnvelope': _obj({
            'success': {'type': 'boolean', 'const': False},
            'error': {'type': 'string'},
            'code': _ref('ErrorCode'),
            'errors': {'type': 'object', 'additionalProperties': True,
                       'description': 'Field-level validation errors.'},
            'data': {'type': 'object', 'additionalProperties': True},
        }, required=['success', 'error', 'code'], open_=False),
        'SuccessEnvelope': _obj({
            'success': {'type': 'boolean', 'const': True},
            'message': {'type': 'string'},
            'data': {'type': 'object', 'additionalProperties': True},
        }, required=['success'], open_=False),
        'TokenPair': _obj({
            'access_token': {'type': 'string'},
            'refresh_token': {'type': 'string'},
        }, required=['access_token', 'refresh_token']),
        'UserPublic': _obj({
            'id': {'type': 'string', 'format': 'uuid'},
            'email': {'type': 'string', 'nullable': True},
            'phone_number': {'type': 'string', 'nullable': True},
            'first_name': {'type': 'string'},
            'last_name': {'type': 'string', 'nullable': True},
            'full_name': {'type': 'string'},
            'role': {'type': 'string'},
            'status': {'type': 'string'},
            'profile_image': {'type': 'string', 'nullable': True,
                              'description': 'Stable media path '
                                             '(/api/v1/media/<id>) or legacy URL.'},
            'must_set_password': {'type': 'boolean'},
        }),
        'SigninResult': _obj({
            'user': _ref('UserPublic'),
            'session_id': {'type': 'string', 'format': 'uuid'},
            'access_token': {'type': 'string'},
            'refresh_token': {'type': 'string'},
        }, required=['user', 'session_id', 'access_token', 'refresh_token']),
        'Appointment': _obj({
            'id': {'type': 'string', 'format': 'uuid'},
            'doctor_id': {'type': 'string', 'format': 'uuid'},
            'patient_id': {'type': 'string', 'format': 'uuid'},
            'appointment_date': {'type': 'string', 'format': 'date'},
            'start_time': {'type': 'string', 'example': '10:00'},
            'end_time': {'type': 'string', 'nullable': True},
            'status': {'type': 'string',
                       'enum': ['pending_payment', 'pending', 'confirmed',
                                'completed', 'cancelled', 'missed']},
            'appointment_type': {'type': 'string'},
            'consultation_type': {'type': 'string', 'nullable': True},
            'meeting_link': {'type': 'string', 'nullable': True},
            'time_slot_id': {'type': 'string', 'format': 'uuid',
                             'nullable': True},
        }),
        'TimeSlot': _obj({
            'id': {'type': 'string', 'format': 'uuid'},
            'doctor_id': {'type': 'string', 'format': 'uuid'},
            'date': {'type': 'string', 'format': 'date'},
            'start_time': {'type': 'string'},
            'end_time': {'type': 'string'},
            'is_booked': {'type': 'boolean'},
            'consultation_types': {'type': 'array',
                                   'items': {'type': 'string'}},
        }),
        'Notification': _obj({
            'id': {'type': 'string', 'format': 'uuid'},
            'type': {'type': 'string'},
            'title': {'type': 'string'},
            'body': {'type': 'string'},
            'data': _obj({
                'kind': {'type': 'string',
                         'description': 'Client cache-invalidation key '
                                        '(appointment, prescription, order, '
                                        'payout, consultation, ...).'},
                'url': {'type': 'string',
                        'description': 'In-app deep link path.'},
            }),
            'read_at': {'type': 'string', 'format': 'date-time',
                        'nullable': True},
            'created_at': {'type': 'string', 'format': 'date-time'},
        }),
        'PaymentOrder': _obj({
            'payment_id': {'type': 'string', 'format': 'uuid'},
            'gateway_order_id': {'type': 'string'},
            'razorpay_key_id': {'type': 'string'},
            'amount': {'type': 'number'},
            'currency': {'type': 'string', 'example': 'INR'},
        }),
    },
}


def _envelope_with(data_schema, description='OK'):
    schema = dict(COMPONENTS['schemas']['SuccessEnvelope'])
    schema = {'allOf': [_ref('SuccessEnvelope'),
                        {'type': 'object', 'properties': {'data': data_schema}}]}
    return {'description': description,
            'content': {'application/json': {'schema': schema}}}


_ERR = {'description': 'Error',
        'content': {'application/json': {'schema': _ref('ErrorEnvelope')}}}
_OK = {'description': 'OK',
       'content': {'application/json': {'schema': _ref('SuccessEnvelope')}}}


def _body(schema):
    return {'required': True,
            'content': {'application/json': {'schema': schema}}}


# ── curated operations: (METHOD, spec-path) → operation fragment ────────────
CURATED = {
    ('POST', '/api/v1/auth/signin'): {
        'summary': 'Password login',
        'requestBody': _body(_obj({
            'email': {'type': 'string', 'format': 'email'},
            'phone_number': {'type': 'string'},
            'aadhar_number': {'type': 'string'},
            'password': {'type': 'string', 'minLength': 8, 'maxLength': 128},
        }, required=['password'], open_=False)),
        'responses': {
            '200': _envelope_with(_ref('SigninResult')),
            '401': dict(_ERR, description='invalid_credentials'),
            '403': dict(_ERR, description='session_limit_reached / '
                                          'ROLE_MISMATCH / verification gates'),
        },
    },
    ('POST', '/api/v1/auth/login-via-otp'): {
        'summary': 'Passwordless login with a phone OTP',
        'requestBody': _body(_obj({
            'phone_number': {'type': 'string'},
            'otp': {'type': 'string', 'maxLength': 6},
            'device_info': {'type': 'object', 'additionalProperties': True},
        }, required=['phone_number', 'otp'], open_=False)),
        'responses': {'200': _envelope_with(_ref('SigninResult')),
                      '400': dict(_ERR, description='otp_invalid / otp_expired')},
    },
    ('POST', '/api/v1/auth/refresh'): {
        'summary': 'Rotate the token pair (idempotent within the grace window)',
        'description': 'Send the REFRESH token as the Bearer credential. '
                       'Single-use with a ~60s idempotent-replay window: a '
                       'retry after a lost response returns the same new '
                       'pair; a genuine replay revokes the session.',
        'responses': {'200': _envelope_with(_ref('TokenPair')),
                      '401': dict(_ERR, description='Session invalid — '
                                                    'discard tokens, sign in again')},
    },
    ('GET', '/api/v1/auth/me'): {
        'summary': 'Current user + tenant context (features, subscription)',
        'responses': {'200': _envelope_with(_obj({
            'id': {'type': 'string', 'format': 'uuid'},
            'role': {'type': 'string'},
            'tenant_context': _obj({
                'tenant_id': {'type': 'string', 'format': 'uuid'},
                'tenant_slug': {'type': 'string'},
                'feature_paths': {'type': 'array', 'items': {'type': 'string'}},
                'subscription': _obj({
                    'status': {'type': 'string'},
                    'billing_cycle': {'type': 'string'},
                    'current_period_end': {'type': 'string',
                                           'format': 'date-time',
                                           'nullable': True},
                }),
            }),
        }))},
    },
    ('POST', '/api/v1/auth/account/delete'): {
        'summary': 'Delete account (deactivate + anonymize; records retained '
                   'per statutory rules)',
        'requestBody': _body(_obj({'password': {'type': 'string'}},
                                  required=['password'], open_=False)),
        'responses': {'200': _OK,
                      '409': dict(_ERR, description='Deletion blocked '
                                                    '(owner account, upcoming '
                                                    'appointments, ...)')},
    },
    ('POST', '/api/v1/appointment'): {
        'summary': 'Book an appointment',
        'requestBody': _body(_obj({
            'doctor_id': {'type': 'string', 'format': 'uuid'},
            'appointment_date': {'type': 'string', 'format': 'date'},
            'start_time': {'type': 'string', 'example': '10:00'},
            'end_time': {'type': 'string'},
            'time_slot_id': {'type': 'string', 'format': 'uuid'},
            'consultation_type': {'type': 'string'},
        }, required=['doctor_id', 'appointment_date', 'start_time'])),
        'responses': {
            '201': _envelope_with(_ref('Appointment')),
            '409': dict(_ERR, description='slot_taken / own_duplicate_booking'),
            '402': dict(_ERR, description='no_active_subscription'),
            '403': dict(_ERR, description='feature_disabled'),
        },
    },
    ('GET', '/api/v1/appointment/patient/upcoming'): {
        'summary': "The patient's upcoming appointments",
        'responses': {'200': _envelope_with(
            {'type': 'array', 'items': _ref('Appointment')})},
    },
    ('GET', '/api/v1/appointment/patient/history'): {
        'summary': "The patient's past appointments (paginated)",
        'parameters': [
            {'name': 'page', 'in': 'query', 'schema': {'type': 'integer'}},
            {'name': 'per_page', 'in': 'query', 'schema': {'type': 'integer'}},
        ],
        'responses': {'200': _OK},
    },
    ('PUT', '/api/v1/appointment/{appointment_id}/reschedule'): {
        'summary': 'Reschedule onto another of the same doctor’s slots '
                   '(≥24h before start)',
        'requestBody': _body(_obj({'time_slot_id':
                                   {'type': 'string', 'format': 'uuid'}},
                                  required=['time_slot_id'], open_=False)),
        'responses': {
            '200': _envelope_with(_ref('Appointment')),
            '400': dict(_ERR, description='reschedule_window_closed / slot_taken'),
        },
    },
    ('GET', '/api/v1/timeslot/doctor/{doctor_id}/timeslots'): {
        'summary': "A doctor's bookable slots",
        'responses': {'200': _envelope_with(
            {'type': 'array', 'items': _ref('TimeSlot')})},
    },
    ('GET', '/api/v1/notifications'): {
        'summary': 'Notification feed + unread count',
        'responses': {'200': _envelope_with(_obj({
            'items': {'type': 'array', 'items': _ref('Notification')},
            'unread_count': {'type': 'integer'},
        }))},
    },
    ('POST', '/api/v1/notifications/devices'): {
        'summary': 'Register this device’s push token (Expo)',
        'requestBody': _body(_obj({
            'token': {'type': 'string', 'maxLength': 512,
                      'example': 'ExponentPushToken[xxxx]'},
            'platform': {'type': 'string', 'enum': ['android', 'ios']},
        }, required=['token'], open_=False)),
        'responses': {'200': _OK},
    },
    ('DELETE', '/api/v1/notifications/devices'): {
        'summary': 'Remove this device’s push token (call at logout)',
        'requestBody': _body(_obj({'token': {'type': 'string'}},
                                  required=['token'], open_=False)),
        'responses': {'200': _OK},
    },
    ('POST', '/api/v1/payment/create-order'): {
        'summary': 'Create a Razorpay order on the TENANT’s gateway',
        'requestBody': _body(_obj({
            'appointment_id': {'type': 'string', 'format': 'uuid'},
            'order_id': {'type': 'string', 'format': 'uuid'},
            'booking_installment_id': {'type': 'string', 'format': 'uuid'},
        })),
        'responses': {
            '200': _envelope_with(_ref('PaymentOrder')),
            '409': dict(_ERR, description='gateway_not_configured — the '
                                          'organisation has not connected '
                                          'its Razorpay account'),
        },
    },
    ('POST', '/api/v1/payment/verify'): {
        'summary': 'Verify a checkout signature and settle the payment',
        'requestBody': _body(_obj({
            'razorpay_order_id': {'type': 'string'},
            'razorpay_payment_id': {'type': 'string'},
            'razorpay_signature': {'type': 'string'},
            'payment_id': {'type': 'string', 'format': 'uuid'},
        }, required=['razorpay_order_id', 'razorpay_payment_id',
                     'razorpay_signature', 'payment_id'], open_=False)),
        'responses': {
            '200': _OK,
            '400': dict(_ERR, description='signature_invalid'),
            '409': dict(_ERR, description='duplicate_transaction'),
        },
    },
    ('GET', '/api/v1/media/{asset_id}'): {
        'summary': 'Resolve a stable media URL (302 to a fresh signed URL)',
        'description': 'Cache the STABLE path forever; never cache the '
                       'redirect target beyond its response headers. '
                       '``public`` assets need no token; ``tenant`` assets '
                       'need a same-tenant bearer.',
        'responses': {
            '302': {'description': 'Redirect to the object URL'},
            '404': dict(_ERR, description='Unknown id — also the answer a '
                                          'foreign tenant gets'),
        },
    },
}

_CONVERTER_SCHEMAS = {
    'uuid': {'type': 'string', 'format': 'uuid'},
    'int': {'type': 'integer'},
    'default': {'type': 'string'},
    'path': {'type': 'string'},
    'string': {'type': 'string'},
}


def build_spec(app):
    paths = {}
    ops = 0
    for rule in app.url_map.iter_rules():
        parts = rule.rule.split('/')
        if len(parts) < 4 or parts[1] != 'api' or parts[2] != 'v1':
            continue
        if parts[3] not in SEGMENTS:
            continue

        spec_path = re.sub(r'<(?:[^:<>]+:)?([^<>]+)>', r'{\1}', rule.rule)
        params = []
        for arg in rule.arguments:
            conv = rule._converters[arg].__class__.__name__.lower()
            conv = ('uuid' if 'uuid' in conv else
                    'int' if 'integer' in conv else 'default')
            params.append({'name': arg, 'in': 'path', 'required': True,
                           'schema': _CONVERTER_SCHEMAS[conv]})

        view = app.view_functions.get(rule.endpoint)
        doc = (view.__doc__ or '').strip().splitlines()
        summary = doc[0].strip() if doc else rule.endpoint

        for method in sorted(m for m in rule.methods
                             if m not in ('HEAD', 'OPTIONS')):
            op = {
                'tags': [parts[3]],
                'summary': summary[:120],
                'operationId': f'{method.lower()}_{rule.endpoint}',
                'responses': {'200': _OK, '4XX': _ERR},
            }
            if params:
                op['parameters'] = list(params)
            if method in ('POST', 'PUT', 'PATCH'):
                op['requestBody'] = {
                    'required': False,
                    'content': {'application/json': {'schema': {
                        'type': 'object', 'additionalProperties': True}}},
                }
            if spec_path in PUBLIC_PATHS:
                op['security'] = []

            curated = CURATED.get((method, spec_path))
            if curated:
                merged_params = op.get('parameters', [])
                op.update(curated)
                if merged_params and 'parameters' not in curated:
                    op['parameters'] = merged_params
                elif merged_params and 'parameters' in curated:
                    op['parameters'] = merged_params + curated['parameters']
                op.setdefault('tags', [parts[3]])
                op.setdefault('operationId',
                              f'{method.lower()}_{rule.endpoint}')
                op['responses'].setdefault('4XX', _ERR)
                if spec_path in PUBLIC_PATHS:
                    op['security'] = []
            paths.setdefault(spec_path, {})[method.lower()] = op
            ops += 1

    spec = {
        'openapi': '3.1.0',
        'info': {
            'title': 'JLMUSH API (mobile surface)',
            'version': '1.0.0',
            'description': (
                'Every client API lives under /api/v1 — no unversioned '
                'aliases exist. All requests should carry X-Tenant-Host '
                '(mandatory for native apps), X-Client, X-Client-Version '
                'and X-Device-Id (see components.parameters). Responses '
                'echo X-Request-Id; quote it in bug reports. Every error '
                'body carries a machine `code` (components.schemas.'
                'ErrorCode). Auth: `Authorization: Bearer <access_token>`; '
                'refresh by sending the REFRESH token as the bearer on '
                'POST /api/v1/auth/refresh. Outdated builds receive 426 '
                'client_update_required.'
            ),
        },
        'servers': [{'url': 'https://{tenant_host}',
                     'variables': {'tenant_host': {
                         'default': 'example.jlmushcloud.com',
                         'description': "The tenant's own hostname."}}}],
        'security': [{'bearerAuth': []}],
        'tags': [{'name': s} for s in sorted(SEGMENTS)],
        'paths': dict(sorted(paths.items())),
        'components': COMPONENTS,
    }
    return spec, ops


def main():
    from app import create_app
    app = create_app()
    spec, ops = build_spec(app)
    out_dir = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), 'openapi')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'openapi.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(spec, fh, indent=2, sort_keys=False)
        fh.write('\n')
    curated_hits = sum(1 for (m, p) in CURATED if p in spec['paths']
                       and m.lower() in spec['paths'][p])
    print(f'wrote {out}: {len(spec["paths"])} paths, {ops} operations, '
          f'{curated_hits}/{len(CURATED)} curated ops matched')
    missing = [(m, p) for (m, p) in CURATED
               if p not in spec['paths'] or m.lower() not in spec['paths'][p]]
    for m, p in missing:
        print(f'  CURATED MISS (path/method not in url_map): {m} {p}')


if __name__ == '__main__':
    main()
