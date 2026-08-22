"""Socket.IO room-name helpers.

Rooms are namespaced by tenant so a socket authenticated for tenant A can never
receive tenant B's traffic even if it guesses a channel UUID. The tenant id is
always taken from the connection's verified JWT claim (stashed at connect),
NEVER from client-supplied event data.

Two room kinds:
  * channel room  — one per conversation; a socket joins it while it has that
    channel open, and message/typing/read events are broadcast to it.
  * user room     — one per user, auto-joined at connect; used for cross-page
    signals (unread-badge bumps, "a channel you're in had activity") that must
    reach the user even when the specific conversation isn't open.
"""


def channel_room(tenant_id, channel_id):
    """Room for a single conversation, scoped to its tenant."""
    return f"t:{tenant_id}:channel:{channel_id}"


def user_room(tenant_id, user_id):
    """Personal room for a user, scoped to their tenant."""
    return f"t:{tenant_id}:user:{user_id}"
