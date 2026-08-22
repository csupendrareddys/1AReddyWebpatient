"""Admin "Onboarding / Holding" chats.

The admin side of the vendor holding channel: list the tenant's held vendors
(pending verification / inactive / trial expired) and open the shared chat with
one. The admin converses through the normal /service-communication endpoints
(they are a channel participant); only the admin may schedule a call there.
"""
import logging

from flask import Blueprint
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.common.responses import success_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole, Doctor, User

logger = logging.getLogger(__name__)

holding_channels_bp = Blueprint('admin_holding_channels', __name__)

_MANAGE = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]


def _channel_stats(channel, tid):
    """(unread_count, last_message_at) for the acting admin on a holding
    channel — the admin's own messages don't count as unread."""
    from app.models import ChannelParticipant, ChannelMessage
    if channel is None:
        return 0, None
    me = ChannelParticipant.query.filter_by(
        tenant_id=tid, channel_id=channel.id,
        user_id=current_user.id, is_deleted=False,
    ).first()
    q = ChannelMessage.query.filter(
        ChannelMessage.tenant_id == tid,
        ChannelMessage.channel_id == channel.id,
        ChannelMessage.is_deleted.is_(False),
    )
    if me is not None:
        q = q.filter(ChannelMessage.sender_participant_id != me.id)
        if me.last_read_at is not None:
            q = q.filter(ChannelMessage.created_at > me.last_read_at)
    return q.count(), channel.last_message_at


def _vertical_for_user(user, tid, default):
    """The vertical a held user belongs to for grouping. Prefers their
    membership subscription's provider_type (captures corporate), then their
    account role."""
    try:
        from app.models import MembershipSubscription
        sub = (MembershipSubscription.query
               .filter_by(tenant_id=tid, user_id=user.id, is_deleted=False)
               .order_by(MembershipSubscription.created_at.desc())
               .first())
        if sub is not None and sub.provider_type is not None:
            return getattr(sub.provider_type, 'value', sub.provider_type)
    except Exception:  # noqa: BLE001 — best-effort classification
        pass
    role = getattr(user.role, 'value', user.role)
    return role or default


@holding_channels_bp.route('', methods=['GET'])
@jwt_required()
@role_required(_MANAGE)
def list_held_vendors():
    """Everyone currently held, grouped by vertical (doctor / clinic / hospital /
    corporate / patient). Each entry carries an unread-message count for the
    acting admin and last-activity time. Sorted WhatsApp-style within its
    vertical: unread first, then most recent message."""
    from app.api.service_provider.doctor.holding_routes import (
        hold_reason, hold_reason_for_user,
    )
    from app.models import ServiceChannel, Clinic, Hospital

    tid = current_tenant_id_strict()
    out = []
    seen_user_ids = set()

    def _add(vertical, name, reason, channel, *, doctor_id=None, user_id=None):
        unread, last_at = _channel_stats(channel, tid)
        out.append({
            'vertical': vertical,
            'doctor_id': str(doctor_id) if doctor_id else None,
            'user_id': str(user_id) if user_id else None,
            'doctor_name': name,   # kept for backwards-compatibility
            'name': name,
            'reason': reason,
            'channel_id': str(channel.id) if channel else None,
            'unread_count': unread,
            'last_message_at': last_at.isoformat() if last_at else None,
        })

    # ── Doctors (held via the vendor-hold logic; channel keyed on the doctor) ──
    for d in Doctor.query.filter_by(tenant_id=tid, is_deleted=False).all():
        user = User.query.get(d.user_id) if d.user_id else None
        if not user:
            continue
        reason = hold_reason(d, user, tid)
        if not reason:
            continue
        if user.id:
            seen_user_ids.add(user.id)
        channel = ServiceChannel.query.filter_by(
            tenant_id=tid, held_doctor_id=d.id, is_deleted=False).first()
        _add('doctor', d.full_name, reason, channel,
             doctor_id=d.id, user_id=user.id)

    # ── Facility providers — clinics & hospitals (held via their admin user) ──
    def _scan_facilities(model, vertical):
        for f in model.query.filter_by(tenant_id=tid, is_deleted=False).all():
            uid = getattr(f, 'admin_user_id', None)
            user = User.query.get(uid) if uid else None
            if not user or user.id in seen_user_ids:
                continue
            reason = hold_reason_for_user(user, tid)
            # A facility PENDING verification is held even when its admin login
            # is already ACTIVE — mirror the doctor path, which holds on the
            # provider entity's verification_status, not just the user's status.
            # Without this, a clinic/hospital awaiting approval never lands here.
            if not reason and getattr(
                    getattr(f, 'verification_status', None), 'value', None) == 'pending':
                reason = 'pending_verification'
            if not reason:
                continue
            seen_user_ids.add(user.id)
            channel = ServiceChannel.query.filter_by(
                tenant_id=tid, held_user_id=user.id, is_deleted=False).first()
            _add(vertical, f.name or (user.full_name or vertical.title()),
                 reason, channel, user_id=user.id)

    _scan_facilities(Clinic, 'clinic')
    _scan_facilities(Hospital, 'hospital')

    # ── Any other held user that already has a holding channel (patients,
    #    corporate members, …) — keyed on held_user_id. ──
    other_channels = ServiceChannel.query.filter(
        ServiceChannel.tenant_id == tid,
        ServiceChannel.is_deleted.is_(False),
        ServiceChannel.held_user_id.isnot(None),
    ).all()
    for ch in other_channels:
        if ch.held_user_id in seen_user_ids:
            continue
        user = User.query.get(ch.held_user_id)
        if not user:
            continue
        reason = hold_reason_for_user(user, tid)
        if not reason:
            continue
        seen_user_ids.add(user.id)
        _add(_vertical_for_user(user, tid, 'patient'),
             user.full_name or user.email or 'Member', reason, ch,
             user_id=user.id)

    # ── Held non-doctor users discovered by STATUS, not by a channel ──
    # An admin hold or a pending account never mints a holding channel — that
    # happens lazily on the held user's next /account-state hit — so the
    # channel-only scan above missed everyone an admin held who hasn't logged
    # in since. Pull them in by state: pending/inactive accounts (indexed
    # status) plus disciplinary holds on an otherwise-active subscription.
    from app.models._enums import UserStatus, UserRole
    from app.models import MembershipSubscription
    held_uids = {
        u.id for u in User.query.filter(
            User.tenant_id == tid, User.is_deleted.is_(False),
            User.status.in_([UserStatus.INACTIVE, UserStatus.PENDING])).all()
    }
    held_uids |= {
        s.user_id for s in MembershipSubscription.query.filter_by(
            tenant_id=tid, on_hold=True, is_deleted=False).all() if s.user_id
    }
    for uid in held_uids:
        if uid in seen_user_ids:
            continue
        user = User.query.get(uid)
        # Doctors are handled by their own vendor-hold scan above; skip so a
        # held doctor isn't re-listed under the generic 'patient' vertical.
        if not user or getattr(user, 'role', None) == UserRole.DOCTOR:
            continue
        reason = hold_reason_for_user(user, tid)
        if not reason:
            continue
        seen_user_ids.add(user.id)
        channel = ServiceChannel.query.filter_by(
            tenant_id=tid, held_user_id=user.id, is_deleted=False).first()
        _add(_vertical_for_user(user, tid, 'patient'),
             user.full_name or user.email or 'Member', reason, channel,
             user_id=user.id)

    # WhatsApp-style: unread conversations first, then most recent activity.
    out.sort(key=lambda v: (
        v['unread_count'] > 0,
        v['last_message_at'] or '',
    ), reverse=True)
    return success_response(data={'vendors': out})


@holding_channels_bp.route('/<doctor_id>/open', methods=['POST'])
@jwt_required()
@role_required(_MANAGE)
def open_holding_channel(doctor_id):
    """Open (create on first use) the holding chat with a vendor and make sure
    the acting admin is a participant. Returns the channel id to converse in."""
    from app.api.service_communication.service import HoldingChannelService
    from app.models import ChannelParticipantRole

    tid = current_tenant_id_strict()
    doctor = Doctor.query.filter_by(id=doctor_id, tenant_id=tid).first()
    if not doctor:
        return not_found_response('Doctor')
    channel = HoldingChannelService.get_or_create(tid, doctor)
    # Ensure THIS admin can act on it (get_or_create seeds current admins, but a
    # newer admin opening it for the first time needs a row too).
    HoldingChannelService._ensure_participant(
        channel, current_user.id, ChannelParticipantRole.ADMIN, tid,
    )
    db.session.commit()
    return success_response(data={'channel_id': str(channel.id)})


@holding_channels_bp.route('/user/<user_id>/open', methods=['POST'])
@jwt_required()
@role_required(_MANAGE)
def open_holding_channel_for_user(user_id):
    """Open (create on first use) the holding chat with a NON-doctor held member
    (clinic / hospital / corporate / patient), keyed on their user id. Returns
    the channel id to converse in."""
    from app.api.service_communication.service import HoldingChannelService
    from app.models import ChannelParticipantRole

    tid = current_tenant_id_strict()
    user = User.query.get(user_id)
    if not user:
        return not_found_response('User')
    channel = HoldingChannelService.get_or_create_for_user(tid, user)
    HoldingChannelService._ensure_participant(
        channel, current_user.id, ChannelParticipantRole.ADMIN, tid,
    )
    db.session.commit()
    return success_response(data={'channel_id': str(channel.id)})
