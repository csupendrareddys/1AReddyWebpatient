"""Service Communication module — blueprint.

Communication bundled INTO an admin-authored Service/Product. See the
isolation contract at the top of ``app/models/service_communication.py``:
nothing in this package may import or mutate appointment/consultation
models. It reuses only generic infrastructure (auth, S3, notifications,
Twilio, rate limiting, FeatureGate).

Mounted at ``/api/service-communication``. Deliberately NOT under
``/api/doctor/documents`` or any appointment prefix — those belong to other
systems and the names are already taken.

**A practice's own support staff can work these threads**, on one condition
that the rest of this system doesn't need: the message must say who wrote it.

Everywhere else a staff member acts for their practice by borrowing its
identity, and that is harmless because the data belongs to the practice. A
channel is different — it is a conversation with a patient, and the patient
is owed the knowledge that the person replying is the receptionist and not
their doctor. Access is a *participant row*, and staff have none, so a
delegated request speaks through the doctor's row (``_channel_user_id``); what
keeps that from being impersonation is that every message it writes is stamped
with the real author and rendered as "Support staff · <name>" to both sides.
The substitution buys access to the conversation, never anonymity inside it.

This mirrors the Operations proxy, which already did exactly this for platform
operators ("Admin staff · <name>"). Same mechanism, second kind of author; see
``_on_behalf()`` in ``service.py``.
"""
from flask import Blueprint

from app.common.provider_access import staff_prefix_gate

service_communication_bp = Blueprint('service_communication', __name__)

from app.api.service_communication import routes  # noqa: E402,F401

_CHANNELS = 'records.service_chats.channels'
_MESSAGES = 'records.service_chats.messages'
_CALLS = 'records.service_chats.calls'

# No vertical: a clinic's front desk fields these as readily as a doctor's
# assistant, and both catalogs carry the same three leaves.
service_communication_bp.before_request(staff_prefix_gate(
    base='/api/v1/service-communication',
    rules={
        # Calls before the plain channel rule, so the longer prefix wins.
        'channels/<uuid:channel_id>/calls': (_CALLS, {'POST': 'can_edit'}),
        # Posting a message is creating one; marking read is neither and is
        # bundled with reading, since it is what reading does.
        'channels/<uuid:channel_id>/messages': _MESSAGES,
        'channels/<uuid:channel_id>/read': (_MESSAGES, {'POST': 'can_view'}),
        'channels/<uuid:channel_id>/documents': _MESSAGES,
        'channels/<uuid:channel_id>/forms': _MESSAGES,
        'channels/<uuid:channel_id>/timeline': _CHANNELS,
        'channels': _CHANNELS,
        'my/documents': _MESSAGES,
        'account-state': _CHANNELS,
    },
    vertical=None,
))
