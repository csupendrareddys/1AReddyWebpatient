"""
Working-hours enforcement for Group Offering plan channels.

A plan defines a per-weekday service window (tenant-local). Voice/video calls
can only be scheduled and chat messages can only be sent inside that window —
no late-night activity. Non-plan channels (individual services) are unaffected.
"""
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']


def _tenant_now():
    """Current time in the tenant's local zone (India by default)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo('Asia/Kolkata'))
    except Exception:  # noqa: BLE001
        return datetime.now()


def _plan_for_channel(channel_id, tenant_id):
    """Resolve the GroupOffering plan behind a channel, or None if it isn't a
    plan-team channel."""
    from app.models import (
        ServiceChannel, PurchasedService, MarketplaceServiceGroup, GroupOffering,
    )
    channel = ServiceChannel.query.filter_by(id=channel_id, tenant_id=tenant_id).first()
    if not channel or not channel.purchased_service_id:
        return None
    purchase = PurchasedService.query.get(channel.purchased_service_id)
    group_id = getattr(purchase, 'service_group_id', None) if purchase else None
    if not group_id:
        return None
    team = MarketplaceServiceGroup.query.get(group_id)
    if not team or not team.group_offering_id:
        return None
    return GroupOffering.query.get(team.group_offering_id)


def working_hours_error(channel_id, tenant_id):
    """Return a user-facing message if the plan channel is currently OUTSIDE its
    working hours, else None (allowed). No plan / no window configured = allowed.
    """
    plan = _plan_for_channel(channel_id, tenant_id)
    wh = getattr(plan, 'working_hours', None) if plan else None
    if not wh or not isinstance(wh, dict):
        return None

    now = _tenant_now()
    day = _WEEKDAYS[now.weekday()]
    window = wh.get(day)
    if not window:
        return None  # day not configured → open
    if window.get('closed'):
        return f'This plan is closed on {day.capitalize()}. Calls and chat are unavailable.'

    open_t, close_t = window.get('open'), window.get('close')
    if not open_t or not close_t:
        return None
    cur = now.strftime('%H:%M')
    if cur < open_t or cur > close_t:
        return (f'Outside plan hours ({open_t}–{close_t}). '
                'Calls and chat are available only during working hours.')
    return None
