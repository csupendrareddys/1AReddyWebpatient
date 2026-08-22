"""Resolve a doctor's effective approval mode for a section / action.

Precedence: **per-doctor override → tenant ApprovalPolicy default → hardcoded
default**. Everything is read live so an admin edit takes effect on the next
submission (no re-version, no cache).

``permission_mode`` (section → ``auto`` | ``manual``) governs whether a doctor's
change to that section auto-applies or stays PENDING for admin approval.
``action_mode`` (action → ``auto_accept`` | ``auto_reject`` | ``manual``) is the
doctor's own operating mode, set directly by the admin.
"""
from app.extensions import db
from app.models import ApprovalPolicy
from app.models.approval_policy import (
    DEFAULT_PERMISSION_MODE, DEFAULT_ACTION_MODE,
    PERMISSION_VALUES, ACTION_VALUES, PERMISSION_SECTIONS, ACTION_KEYS,
)


def get_or_create_policy(tenant_id):
    """The tenant's ApprovalPolicy row (created empty on first use)."""
    policy = ApprovalPolicy.query.filter_by(tenant_id=tenant_id).first()
    if policy is None:
        policy = ApprovalPolicy(tenant_id=tenant_id, permission_modes={}, action_modes={})
        db.session.add(policy)
        db.session.commit()
    return policy


def _policy_for(doctor):
    return ApprovalPolicy.query.filter_by(tenant_id=doctor.tenant_id).first()


def effective_permission_mode(doctor, section):
    """``'auto'`` | ``'manual'`` for a section — override → global → default."""
    override = (getattr(doctor, 'approval_permission_modes', None) or {}).get(section)
    if override in PERMISSION_VALUES:
        return override
    policy = _policy_for(doctor)
    if policy and (policy.permission_modes or {}).get(section) in PERMISSION_VALUES:
        return policy.permission_modes[section]
    return DEFAULT_PERMISSION_MODE


def effective_action_mode(doctor, action):
    """``'auto_accept'`` | ``'auto_reject'`` | ``'manual'`` for an action.

    For ``appointment_acceptance`` the final fallback is the doctor's existing
    ``accepting_appointments`` enum, so a doctor already configured that way is
    unaffected until an admin sets an explicit override/default.
    """
    override = (getattr(doctor, 'approval_action_modes', None) or {}).get(action)
    if override in ACTION_VALUES:
        return override
    policy = _policy_for(doctor)
    if policy and (policy.action_modes or {}).get(action) in ACTION_VALUES:
        return policy.action_modes[action]
    if action == 'appointment_acceptance':
        cur = getattr(doctor, 'accepting_appointments', None)
        val = getattr(cur, 'value', cur)
        if val in ACTION_VALUES:
            return val
    return DEFAULT_ACTION_MODE


def sanitize_permission_modes(raw):
    """Keep only recognised sections with a valid ``auto|manual`` value."""
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if k in PERMISSION_SECTIONS and v in PERMISSION_VALUES:
                out[k] = v
    return out


def sanitize_action_modes(raw):
    """Keep only recognised actions with a valid 3-way value."""
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if k in ACTION_KEYS and v in ACTION_VALUES:
                out[k] = v
    return out
