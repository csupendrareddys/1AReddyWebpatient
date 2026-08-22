"""Service Communication — HTTP routes.

Mounted at ``/api/service-communication``.

  Admin (config)
    GET  /config/<product_id>       read a product's communication terms
    PUT  /config/<product_id>       create/update them

  Activation
    POST /purchases                 activate a purchase → channel
    POST /group-purchases           activate a group offering → group chat
                                    + one 1:1 channel per serving doctor

  Channels
    GET  /channels                  my channels (patient or provider)
    GET  /channels/<channel_id>     one channel + participants + entitlement

Authorization for channel-scoped reads is *membership*: you see a channel iff
you have a ``ChannelParticipant`` row in it. That keeps the rule identical for
patient, provider and (later) any group participant.
"""
import logging

from flask import request
from flask_jwt_extended import current_user, get_jwt_identity, jwt_required

from app.api.service_communication import service_communication_bp as bp
from app.api.service_communication.service import (
    ActivationService, CallService, ConfigService, DocumentService, FormService,
    HoldingChannelService, MessageService, ServiceCommunicationError,
    channel_timeline, participant_for_user,
)
from app.common.decorators import role_required
from app.common.provider_access import acting_doctor
from app.common.responses import (
    created_response, error_response, not_found_response, success_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import limiter
from app.realtime.emit import broadcast_message, broadcast_read
from app.models import (
    ChannelParticipant, PurchasedService, ServiceChannel, UserRole,
)

logger = logging.getLogger(__name__)

_ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER]


def _channel_user_id():
    """Whose participant row this request speaks through.

    Membership in a channel IS the permission here (``participant_for_user``),
    and a staff member is not a participant — the doctor is. So a delegated
    request resolves to the doctor's user, exactly as the Operations proxy
    does, and everything downstream is unchanged.

    What stops that from being impersonation is that the message records who
    actually typed it: ``_on_behalf()`` in the service stamps the staff member,
    and the thread shows "Support staff · <name>" to both sides. The
    substitution buys access to the conversation, never anonymity inside it.
    """
    from app.common.provider_access import acting_user
    if getattr(current_user, 'role', None) == UserRole.PROVIDER_STAFF:
        return acting_user().id
    return current_user.id


def _user_rate_key():
    """Rate-limit chat per USER, not per IP.

    The default limiter keys on remote address, which would lump every patient
    behind one clinic NAT / mobile carrier together. Chat abuse is per-account,
    so the JWT subject is the right bucket.
    """
    return get_jwt_identity() or request.remote_addr


def _handle(exc):
    # Distinct codes where the app branches: channel_readonly → show the
    # "service ended" banner and disable the composer; feature_disabled →
    # hide chat entirely. Everything else keeps the status-default code.
    low = str(exc.message).lower()
    if 'read-only' in low:
        code = 'channel_readonly'
    elif 'not included in this service' in low:
        code = 'feature_disabled'
    else:
        code = None
    return error_response(exc.message, status_code=exc.status_code, code=code)


# ---------------------------------------------------------------------------
# Admin — per-product communication config
# ---------------------------------------------------------------------------

@bp.route('/config/<uuid:product_id>', methods=['GET'])
@jwt_required()
@role_required(_ADMIN_ROLES)
def get_config(product_id):
    """A product's communication terms.

    Returns ``config: null`` (not 404) when the product has none — the admin UI
    renders the same form either way, with defaults.
    """
    config = ConfigService.get_for_product(product_id, current_tenant_id_strict())
    return success_response(data={
        'product_id': str(product_id),
        'config': config.to_dict() if config else None,
    })


@bp.route('/config/<uuid:product_id>', methods=['PUT'])
@jwt_required()
@role_required(_ADMIN_ROLES)
def upsert_config(product_id):
    """Create or update a product's communication terms.

    Note these values are snapshotted onto each purchase at activation, so
    editing here changes what FUTURE buyers get and never rewrites the terms of
    a service someone already bought.
    """
    try:
        config = ConfigService.upsert(
            product_id, current_tenant_id_strict(),
            request.get_json() or {}, actor_id=current_user.id,
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(
        data=config.to_dict(), message='Communication settings saved',
    )


# ---------------------------------------------------------------------------
# Activation
# ---------------------------------------------------------------------------

@bp.route('/purchases', methods=['POST'])
@jwt_required()
@role_required(_ADMIN_ROLES)
def activate_purchase():
    """Activate a purchased service and open its channel.

    Admin-invoked for now: the marketplace purchase route is still a stub, so
    this is how a channel comes into existence until payment integration lands.
    The same service function is what that flow will call.

    Payload::

        {"product_id", "patient_id", "provider_type", "provider_id",
         "order_id"?}
    """
    data = request.get_json() or {}
    required = ('product_id', 'patient_id', 'provider_type', 'provider_id')
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error_response(
            f'Missing required field(s): {", ".join(missing)}', status_code=400,
        )

    try:
        purchase, channel, created = ActivationService.activate(
            product_id=data['product_id'],
            patient_id=data['patient_id'],
            provider_type=data['provider_type'],
            provider_id=data['provider_id'],
            order_id=data.get('order_id'),
            tenant_id=current_tenant_id_strict(),
            actor_id=current_user.id,
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)

    payload = {
        'purchased_service': purchase.to_dict(),
        'channel': channel.to_dict() if channel else None,
    }
    if not created:
        return success_response(
            data=payload,
            message='This patient already has an active channel for that service',
        )
    return created_response(payload, message='Service activated')


def _channel_payload(channel):
    """Channel + its entitlement, matching the ``/purchases`` response shape."""
    if channel is None:
        return None
    return {
        'channel': channel.to_dict(),
        'purchased_service': (
            channel.purchased_service.to_dict()
            if channel.purchased_service else None
        ),
    }


@bp.route('/group-purchases', methods=['POST'])
@jwt_required()
@role_required(_ADMIN_ROLES)
def activate_group_purchase():
    """Activate a group service offering → group chat + a 1:1 per doctor.

    Admin-invoked for now, mirroring ``/purchases``: the marketplace purchase
    route is still a stub, so this is how a group's channels come into
    existence until payment integration lands. Idempotent — re-invoking returns
    the existing channels rather than minting duplicates.

    Payload::

        {"group_id", "patient_id", "order_id"?}
    """
    data = request.get_json() or {}
    missing = [f for f in ('group_id', 'patient_id') if not data.get(f)]
    if missing:
        return error_response(
            f'Missing required field(s): {", ".join(missing)}', status_code=400,
        )

    try:
        member_channels, group_channel, group = ActivationService.activate_group(
            group_id=data['group_id'],
            patient_id=data['patient_id'],
            order_id=data.get('order_id'),
            tenant_id=current_tenant_id_strict(),
            actor_id=current_user.id,
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)

    payload = {
        'service_group_id': str(group.id),
        'group_channel': _channel_payload(group_channel),
        'member_channels': [
            _channel_payload(channel) for _purchase, channel in member_channels
        ],
    }
    return created_response(payload, message='Group service activated')


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

@bp.route('/channels', methods=['GET'])
@jwt_required()
def list_my_channels():
    """Every channel the caller participates in, newest activity first.

    One endpoint for both sides — a patient and a provider are just
    participants with different roles.
    """
    tenant_id = current_tenant_id_strict()
    rows = (
        db_channels_for_user(tenant_id, _channel_user_id())
    )

    items = []
    for channel, participant, purchase in rows:
        # Lazily expire on read so the state is correct even when the
        # background job isn't running (APScheduler is an optional import).
        # Second-opinion channels have no purchase → nothing to expire.
        if purchase is not None and ActivationService.expire_if_due(purchase, channel):
            from app.extensions import db
            db.session.commit()
        item = channel.to_dict()
        item['my_role'] = participant.role.value if participant.role else None
        item['purchased_service'] = purchase.to_dict() if purchase else None
        # Family-doctor second-opinion channel (prescription-linked, no
        # purchase) — flag it + label so the list renders it meaningfully.
        item['is_second_opinion'] = bool(getattr(channel, 'prescription_id', None)) and purchase is None
        if item['is_second_opinion']:
            item['title'] = 'Second opinion'
        # Everyone in the channel except the caller — lets the UI label a 1:1
        # leg by the doctor's name and show a group chat's roster/count without
        # a second round-trip. Small N (patient + a handful of doctors).
        others = [
            p for p in channel.participants
            if not p.is_deleted and p.user_id != participant.user_id
        ]
        item['counterparts'] = [
            {
                'user_id': str(p.user_id),
                'display_name': (p.user.full_name if p.user else None) or None,
                'role': p.role.value if p.role else None,
            }
            for p in others
        ]
        item['participant_count'] = 1 + len(others)
        items.append(item)

    return success_response(data={'channels': items})


def db_channels_for_user(tenant_id, user_id):
    """(channel, my_participant, purchase) for every channel this user is in.

    Outer-joins the purchase so purchase-less channels still surface — in
    particular the family-doctor "second opinion" channels (keyed on a
    prescription, no purchase). Holding channels (no purchase AND no
    prescription) stay excluded from this list.
    """
    from app.extensions import db
    return (
        ServiceChannel.query
        .join(ChannelParticipant,
              ChannelParticipant.channel_id == ServiceChannel.id)
        .outerjoin(PurchasedService,
                   PurchasedService.id == ServiceChannel.purchased_service_id)
        .filter(
            ServiceChannel.tenant_id == tenant_id,
            ServiceChannel.is_deleted.is_(False),
            ChannelParticipant.user_id == user_id,
            ChannelParticipant.is_deleted.is_(False),
            db.or_(
                ServiceChannel.purchased_service_id.isnot(None),
                ServiceChannel.prescription_id.isnot(None),
            ),
        )
        .order_by(ServiceChannel.last_message_at.desc().nullslast(),
                  ServiceChannel.created_at.desc())
        .with_entities(ServiceChannel, ChannelParticipant, PurchasedService)
        .all()
    )


@bp.route('/channels/<uuid:channel_id>', methods=['GET'])
@jwt_required()
def get_channel(channel_id):
    """One channel, with its participants and the entitlement behind it.

    404 (not 403) for a non-participant: whether a channel exists is itself
    information a stranger shouldn't get.
    """
    tenant_id = current_tenant_id_strict()
    participant = participant_for_user(channel_id, _channel_user_id(), tenant_id)
    if participant is None:
        return not_found_response('Channel')

    channel = ServiceChannel.query.filter_by(
        id=channel_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if channel is None:
        return not_found_response('Channel')

    purchase = PurchasedService.query.filter_by(
        id=channel.purchased_service_id,
    ).first()
    if purchase is not None and ActivationService.expire_if_due(purchase, channel):
        from app.extensions import db
        db.session.commit()

    data = channel.to_dict()
    data['my_role'] = participant.role.value if participant.role else None
    data['my_participant_id'] = str(participant.id)
    data['purchased_service'] = purchase.to_dict() if purchase else None
    data['participants'] = [p.to_dict() for p in channel.participants if not p.is_deleted]
    # Keep the detail in lock-step with the list: a family-doctor second-opinion
    # channel is prescription-keyed and purchase-less. Without this the selected
    # channel loses the flag and the chat/calls fall back to read-only.
    data['is_second_opinion'] = bool(getattr(channel, 'prescription_id', None)) and purchase is None
    if data['is_second_opinion']:
        data['title'] = 'Second opinion'
    return success_response(data=data)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@bp.route('/channels/<uuid:channel_id>/messages', methods=['GET'])
@jwt_required()
def list_messages(channel_id):
    """A page of chat history, oldest-first.

    Query: ``before`` (ISO timestamp — page further back), ``limit`` (<=100).
    Reads are allowed even after the service expires — history stays visible
    until retention deletes it.
    """
    try:
        rows, has_more = MessageService.history(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
            before=request.args.get('before'),
            limit=request.args.get('limit', 50),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={
        'messages': [m.to_dict() for m in rows],
        'has_more': has_more,
    })


def _bell_support_counterpart(channel_id, tenant_id, message):
    """Seller-tenant SUPPORT channels get a bell on top of the socket
    broadcast: chat is cross-org there, so the other side is often not
    on the page at all. One unread notification per channel per
    recipient — repeat messages re-bump it instead of stacking.
    Best-effort: a notify failure must never fail the send."""
    try:
        from app.models import ServiceChannel
        channel = ServiceChannel.query.filter_by(id=channel_id).first()
        if channel is None or not getattr(channel, 'is_support', False):
            return
        from app.common.notify import (
            notify_tenant_admins, push_to_super_admins,
        )
        sender_id = getattr(message, 'sender_user_id', None) or \
            getattr(message, 'sender_id', None)
        seller_id = channel.support_seller_tenant_id
        body = (getattr(message, 'body', '') or '')[:120]
        # Which ORG wrote? Seller participants sit on the channel with
        # the CHANNEL's tenant stamped on their row, so the only honest
        # signal is the sender USER's home tenant.
        from app.models import ChannelParticipant, User
        sender_user = None
        part = ChannelParticipant.query.filter_by(
            id=message.sender_participant_id).first()             if message.sender_participant_id else None
        if part is not None and part.user_id:
            sender_user = User.query.filter_by(id=part.user_id).first()
        sender_home = str(sender_user.tenant_id) if (
            sender_user and sender_user.tenant_id) else str(tenant_id)
        if sender_home == str(seller_id):
            # Seller staff wrote — bell the TENANT's admins.
            notify_tenant_admins(
                str(channel.tenant_id), type='support_message',
                title='New support message',
                body=body or 'Your provider sent a message.',
                data={'kind': 'support',
                      'url': '/dashboard/admin/support',
                      'channel_id': str(channel_id)},
            )
        else:
            # Tenant wrote — bell the SELLER's admins.
            push_to_super_admins(
                tenant_id=str(seller_id), type='support_message',
                title='New support message',
                body=body or 'A tenant sent a message.',
                data={'kind': 'support',
                      'url': '/dashboard/platform/support',
                      'channel_id': str(channel_id)},
            )
    except Exception:  # noqa: BLE001 — bell must never break the send
        import logging
        logging.getLogger(__name__).debug(
            '[SUPPORT] counterpart bell failed', exc_info=True)


@bp.route('/channels/<uuid:channel_id>/messages', methods=['POST'])
@jwt_required()
@limiter.limit('5 per 10 seconds', key_func=_user_rate_key)
@limiter.limit('30 per minute', key_func=_user_rate_key)
def send_message(channel_id):
    """Send a message.

    Persisted first, then (once the realtime layer lands) broadcast. Refused
    when the channel is read-only / expired, chat isn't in the service, or the
    participant is muted. ``client_msg_id`` makes a retried send idempotent.
    """
    data = request.get_json() or {}
    tenant_id = current_tenant_id_strict()
    # Plan channels are bound by the plan's working hours — no late-night chat.
    from app.api.service_communication.working_hours import working_hours_error
    wh_err = working_hours_error(channel_id, tenant_id)
    if wh_err:
        return error_response(wh_err, status_code=403)
    try:
        message, created = MessageService.send(
            channel_id, _channel_user_id(), tenant_id,
            body=data.get('body'),
            client_msg_id=data.get('client_msg_id'),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)

    payload = message.to_dict()
    if not created:
        # Idempotent replay of an already-persisted message — do NOT re-broadcast
        # (the original send already did), just return the row.
        return success_response(data=payload, message='Already sent')

    # Persist-first: the row is committed; now broadcast it to the conversation
    # room + bump each participant's channel list. Best-effort (never raises).
    broadcast_message(channel_id, tenant_id, payload)
    _bell_support_counterpart(channel_id, tenant_id, message)
    return created_response(payload, message='Sent')


@bp.route('/channels/<uuid:channel_id>/read', methods=['POST'])
@jwt_required()
def mark_read(channel_id):
    """Mark the channel read up to now (drives unread counts)."""
    tenant_id = current_tenant_id_strict()
    try:
        participant = MessageService.mark_read(
            channel_id, _channel_user_id(), tenant_id,
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)

    last_read_at = (
        participant.last_read_at.isoformat() if participant.last_read_at else None
    )
    # Let the other side clear delivered/unread state, and refresh the reader's
    # own channel-list badge on their other devices.
    broadcast_read(channel_id, tenant_id, participant.id, last_read_at)
    return success_response(data={'last_read_at': last_read_at})


# ---------------------------------------------------------------------------
# Scheduled calls
# ---------------------------------------------------------------------------

@bp.route('/channels/<uuid:channel_id>/calls', methods=['GET'])
@jwt_required()
def list_calls(channel_id):
    """Every scheduled call in the channel, newest-first (both sides)."""
    try:
        calls = CallService.list_calls(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={'calls': [c.to_dict() for c in calls]})


@bp.route('/channels/<uuid:channel_id>/calls', methods=['POST'])
@jwt_required()
def schedule_call(channel_id):
    """Provider schedules an audio/video call.

    Provider-only (patients propose + accept, never schedule). Refused when
    the mode isn't in the service or its minutes are used up.
    """
    data = request.get_json() or {}
    from app.api.service_communication.working_hours import working_hours_error
    wh_err = working_hours_error(channel_id, current_tenant_id_strict())
    if wh_err:
        return error_response(wh_err, status_code=403)
    try:
        call = CallService.schedule(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
            mode=data.get('mode'),
            start=data.get('scheduled_start'),
            end=data.get('scheduled_end'),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return created_response(call.to_dict(), message='Call scheduled')


@bp.route('/channels/<uuid:channel_id>/calls/propose', methods=['POST'])
@jwt_required()
def propose_call(channel_id):
    """Patient proposes a call time (lands as a proposal message)."""
    data = request.get_json() or {}
    if not data.get('suggested_time'):
        return error_response('suggested_time is required', status_code=400)
    try:
        message = CallService.propose(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
            suggested_time=data['suggested_time'], note=data.get('note'),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return created_response(message.to_dict(), message='Time proposed')


def _call_action(channel_id, call_id, fn):
    try:
        call = fn(channel_id, call_id, _channel_user_id(), current_tenant_id_strict())
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return call


@bp.route('/channels/<uuid:channel_id>/calls/<uuid:call_id>/accept', methods=['POST'])
@jwt_required()
def accept_call(channel_id, call_id):
    """Patient accepts a scheduled call."""
    result = _call_action(channel_id, call_id, CallService.accept)
    if not hasattr(result, 'to_dict'):
        return result
    return success_response(data=result.to_dict(), message='Call accepted')


@bp.route('/channels/<uuid:channel_id>/calls/<uuid:call_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_call(channel_id, call_id):
    """Either side cancels a call that hasn't completed."""
    result = _call_action(channel_id, call_id, CallService.cancel)
    if not hasattr(result, 'to_dict'):
        return result
    return success_response(data=result.to_dict(), message='Call cancelled')


@bp.route('/channels/<uuid:channel_id>/calls/<uuid:call_id>/join', methods=['POST'])
@jwt_required()
def join_call(channel_id, call_id):
    """Join a call. Returns a Twilio token when calling is configured.

    Opens a CallSession so connected-duration billing can be computed on
    leave/end. Blocked when the service ended or the minute quota is used up.
    """
    try:
        call, join_info = CallService.join(
            channel_id, call_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    payload = {'call': call.to_dict(), **join_info}
    return success_response(data=payload, message='Joined')


@bp.route('/channels/<uuid:channel_id>/calls/<uuid:call_id>/leave', methods=['POST'])
@jwt_required()
def leave_call(channel_id, call_id):
    """Leave a call. Finalizes (duration + quota) once nobody is left on it."""
    result = _call_action(channel_id, call_id, CallService.leave)
    if not hasattr(result, 'to_dict'):
        return result
    return success_response(data=result.to_dict(), message='Left')


@bp.route('/channels/<uuid:channel_id>/calls/<uuid:call_id>/end', methods=['POST'])
@jwt_required()
def end_call(channel_id, call_id):
    """Provider ends the call for everyone and finalizes it."""
    result = _call_action(channel_id, call_id, CallService.end)
    if not hasattr(result, 'to_dict'):
        return result
    return success_response(data=result.to_dict(), message='Call ended')


# ---------------------------------------------------------------------------
# Documents (Phase 5)
# ---------------------------------------------------------------------------

@bp.route('/my/documents', methods=['GET'])
@jwt_required()
def list_my_documents():
    """Every document across ALL the caller's services — the unified
    "My Documents" list for patient and doctor alike. Each row is annotated
    with its service and whether the caller uploaded it."""
    docs = DocumentService.list_mine(_channel_user_id(), current_tenant_id_strict())
    return success_response(data={'documents': docs})


@bp.route('/channels/<uuid:channel_id>/documents', methods=['GET'])
@jwt_required()
def list_documents(channel_id):
    try:
        docs = DocumentService.list(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={'documents': [d.to_dict() for d in docs]})


@bp.route('/channels/<uuid:channel_id>/documents', methods=['POST'])
@jwt_required()
def upload_document(channel_id):
    """Multipart upload (field ``file``, optional ``description``).

    Prescriptions are never uploaded here — they keep their own flow. Blocked
    after the service expires; type/size enforced by S3Service (PDF/image,
    <= 5 MB).
    """
    file_obj = request.files.get('file')
    try:
        doc = DocumentService.upload(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
            file_obj=file_obj,
            description=request.form.get('description'),
            category=request.form.get('category'),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return created_response(doc.to_dict(), message='Uploaded')


@bp.route('/channels/<uuid:channel_id>/documents/<uuid:doc_id>/download',
          methods=['GET'])
@jwt_required()
def download_document(channel_id, doc_id):
    """A short-lived presigned URL for one document."""
    try:
        doc, url = DocumentService.download_url(
            channel_id, doc_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={'url': url, 'filename': doc.original_filename})


# ---------------------------------------------------------------------------
# Forms (Phase 6)
# ---------------------------------------------------------------------------

@bp.route('/channels/<uuid:channel_id>/forms', methods=['GET'])
@jwt_required()
def list_forms(channel_id):
    try:
        forms = FormService.list(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={'forms': [f.to_dict() for f in forms]})


@bp.route('/channels/<uuid:channel_id>/forms', methods=['POST'])
@jwt_required()
def submit_form(channel_id):
    data = request.get_json() or {}
    try:
        response = FormService.submit(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
            form_key=data.get('form_key'), answers=data.get('answers'),
            schema_version=data.get('schema_version', 1),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return created_response(response.to_dict(), message='Submitted')


# ---------------------------------------------------------------------------
# Timeline (Phase 6) — the channel's audit trail
# ---------------------------------------------------------------------------

@bp.route('/channels/<uuid:channel_id>/timeline', methods=['GET'])
@jwt_required()
def get_timeline(channel_id):
    """System events, oldest-first — the frontend interleaves with messages."""
    try:
        events = channel_timeline(
            channel_id, _channel_user_id(), current_tenant_id_strict(),
        )
    except ServiceCommunicationError as exc:
        return _handle(exc)
    return success_response(data={'events': [e.to_dict() for e in events]})


@bp.route('/account-state', methods=['GET'])
@jwt_required()
def general_account_state():
    """Whether the CURRENT user (any role) is held + the holding channel id.
    Doctors resolve via the vendor-hold logic; any other user via their account
    status / disciplinary hold. The frontend routes held users to the holding
    page instead of their dashboard."""
    from app.extensions import db
    from app.api.service_provider.doctor.service import DoctorService
    from app.api.service_provider.doctor.holding_routes import (
        hold_reason, hold_reason_for_user,
    )
    tid = current_tenant_id_strict()
    doctor = acting_doctor()
    channel_id = None
    if doctor:
        reason = hold_reason(doctor, current_user, tid)
        if reason:
            channel = HoldingChannelService.get_or_create(tid, doctor)
            db.session.commit()
            channel_id = str(channel.id)
    else:
        reason = hold_reason_for_user(current_user, tid)
        if reason:
            channel = HoldingChannelService.get_or_create_for_user(tid, current_user)
            db.session.commit()
            channel_id = str(channel.id)
    return success_response(data={
        'held': bool(reason),
        'reason': reason,
        'holding_channel_id': channel_id,
    })
