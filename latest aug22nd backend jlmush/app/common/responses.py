"""
Response Helpers
Standardized API response formatting
"""
from flask import jsonify

# Default machine-readable code per HTTP status. Every error envelope
# carries a ``code`` — mobile clients pin builds and branch on codes, not
# on human message strings that copywriting may change. A call site passes
# an explicit ``code=`` only when the client must distinguish between
# DIFFERENT failures sharing one status on one endpoint (e.g. 409
# ``slot_taken`` vs 409 ``duplicate_transaction``); otherwise the status
# default is the contract. New explicit codes are lower_snake_case;
# legacy UPPER_SNAKE codes (EMAIL_NOT_VERIFIED, ...) are frozen — the web
# frontend already branches on them.
_STATUS_CODES = {
    400: 'bad_request',
    401: 'unauthorized',
    402: 'payment_required',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    409: 'conflict',
    410: 'gone',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    422: 'validation_error',
    423: 'locked',
    426: 'client_update_required',
    429: 'rate_limited',
    500: 'server_error',
    502: 'bad_gateway',
    503: 'service_unavailable',
    504: 'timeout',
}


def default_code_for_status(status_code):
    """The envelope ``code`` implied by an HTTP status alone."""
    try:
        status = int(status_code)
    except (TypeError, ValueError):
        return 'error'
    if status in _STATUS_CODES:
        return _STATUS_CODES[status]
    return 'server_error' if status >= 500 else 'bad_request'


def success_response(data=None, message=None, status_code=200):
    """
    Create a standardized success response.
    
    Args:
        data: Response data (dict, list, or None)
        message: Optional success message
        status_code: HTTP status code (default 200)
    
    Returns:
        Flask Response object
    """
    response = {'success': True}
    
    if message:
        response['message'] = message
    
    if data is not None:
        response['data'] = data
    
    return jsonify(response), status_code


def error_response(message, errors=None, status_code=400, code=None, data=None):
    """
    Create a standardized error response.

    Args:
        message: Error message (also placed in ``error`` field of the envelope)
        errors: Optional dict of field-specific errors (e.g. marshmallow output)
        status_code: HTTP status code (default 400)
        code: Optional short machine-readable error code (e.g. ``EMAIL_NOT_VERIFIED``)
              that the frontend can branch on without parsing the message string.
        data: Optional payload the client may still need on a failed response
              (e.g. the email address that needs verification). Keeps the envelope
              shape uniform with success responses.

    Returns:
        Flask Response tuple ``(response, status_code)``
    """
    response = {
        'success': False,
        'error': message,
        # Always present: explicit code wins, else derived from the status.
        'code': code if code is not None else default_code_for_status(status_code),
    }

    if errors:
        response['errors'] = errors
    if data is not None:
        response['data'] = data

    return jsonify(response), status_code


# Substring → code table for messages raised by the service layer as bare
# ValueErrors. Checked in order; first hit wins. This keeps codes correct
# at the ~30 generic ``except ValueError`` route catches without threading
# a code argument through every service raise. Lowercased matching.
_MESSAGE_CODE_RULES = (
    (('otp', 'expired'), 'otp_expired'),
    (('otp', 'not requested'), 'otp_expired'),
    (('otp', 'invalid'), 'otp_invalid'),
    (('invalid otp',), 'otp_invalid'),
    (('already registered',), 'already_registered'),
    (('already exists',), 'already_registered'),
    (('already in use',), 'already_registered'),
    (('not found',), 'not_found'),
)


def classify_error_message(message):
    """Best-effort machine code for a service-layer error message, or None."""
    text = str(message or '').lower()
    for needles, code in _MESSAGE_CODE_RULES:
        if all(n in text for n in needles):
            return code
    return None


def service_error_response(exc, status_code=400):
    """Envelope a service-layer exception, classifying known messages into
    stable codes (otp_expired / otp_invalid / already_registered / ...).
    Unrecognised messages fall back to the status-default code."""
    return error_response(str(exc), status_code=status_code,
                          code=classify_error_message(exc))


def created_response(data, message='Resource created successfully'):
    """Response for successful resource creation (201)."""
    return success_response(data=data, message=message, status_code=201)


def no_content_response():
    """Response for successful deletion (204)."""
    return '', 204


def not_found_response(resource='Resource', code=None):
    """Response for resource not found (404, code ``not_found``)."""
    return error_response(f'{resource} not found', status_code=404, code=code)


def unauthorized_response(message='Authentication required', code=None):
    """Response for unauthorized access (401, code ``unauthorized``)."""
    return error_response(message, status_code=401, code=code)


def forbidden_response(message='Access denied', code=None):
    """Response for forbidden access (403, code ``forbidden``)."""
    return error_response(message, status_code=403, code=code)


def validation_error_response(errors):
    """Response for validation errors (422, code ``validation_error``)."""
    return error_response('Validation failed', errors=errors, status_code=422)


def paginated_response(pagination, items_key='items'):
    """
    Create a paginated response from Flask-SQLAlchemy Pagination object.
    
    Args:
        pagination: Pagination object from query.paginate()
        items_key: Key name for items list (default 'items')
    
    Returns:
        Flask Response object
    """
    return success_response(data={
        items_key: [item.to_dict() if hasattr(item, 'to_dict') else item for item in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev,
        }
    })
