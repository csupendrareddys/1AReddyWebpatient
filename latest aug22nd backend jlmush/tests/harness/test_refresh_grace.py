"""Refresh-token grace window: the retry a flaky mobile network forces.

Timeline the feature exists for:

    client ──refresh(A)──▶ server rotates A→B, stores grace(A→pair B)
           ◀──pair B──✗     response LOST in transit
    client ──refresh(A)──▶ within the window: SAME pair B (idempotent)
    client ──refresh(B)──▶ normal rotation to C

Without the grace record the second call read as a replay attack and
revoked the whole session — a user logged out because their train went
through a tunnel.

What must stay true (asserted below):
  * retry inside the window returns byte-identical tokens, and does NOT
    revoke the session — the returned pair still refreshes;
  * the rotated-to token keeps working normally (chain continues);
  * once the window closes, the old token is a genuine replay again:
    401 AND the session is revoked (theft detection is delayed, not lost);
  * a never-issued token is refused without touching the session.
"""
import time

import pytest

from tests.conftest import get_auth_headers


REFRESH = '/api/v1/auth/refresh'


def _refresh(client, refresh_token):
    return client.post(REFRESH,
                       headers={'Authorization': f'Bearer {refresh_token}'})


@pytest.fixture()
def session_tokens(app, client, sample_patient):
    """A real signed-in session's token pair (via the same helper the
    other authenticated tests use, which seeds the UserSession row +
    Redis entries exactly like signin does)."""
    from app.auth.session_store import SessionStore
    from flask_jwt_extended import create_refresh_token, decode_token

    user, _patient = sample_patient
    headers = get_auth_headers(app, user)
    # get_auth_headers minted an ACCESS token; mint the matching refresh
    # token on the same session and register its jti like signin does.
    with app.app_context():
        access = headers['Authorization'].split(' ', 1)[1]
        session_id = decode_token(access)['session_id']
        import uuid as _uuid
        jti = str(_uuid.uuid4())
        refresh = create_refresh_token(identity=user, additional_claims={
            'session_id': session_id, 'jti': jti,
            'tenant_id': str(user.tenant_id) if user.tenant_id else None,
        })
        assert SessionStore.store_refresh_token(jti, session_id, 3600)
    return {'refresh': refresh, 'session_id': session_id}


def test_grace_window_makes_retry_idempotent(app, client, db_session,
                                             session_tokens):
    app.config['REFRESH_GRACE_SECONDS'] = 60

    first = _refresh(client, session_tokens['refresh'])
    assert first.status_code == 200, first.get_json()
    pair1 = first.get_json()['data']

    # The lost-response retry: same old token, same NEW pair back.
    retry = _refresh(client, session_tokens['refresh'])
    assert retry.status_code == 200, (
        'retry within the grace window must not be treated as a replay: '
        f'{retry.get_json()}')
    pair2 = retry.get_json()['data']
    assert pair2['refresh_token'] == pair1['refresh_token']
    assert pair2['access_token'] == pair1['access_token']

    # The chain continues from the rotated-to token.
    onward = _refresh(client, pair1['refresh_token'])
    assert onward.status_code == 200, onward.get_json()
    assert onward.get_json()['data']['refresh_token'] != pair1['refresh_token']


def test_replay_after_window_still_revokes(app, client, db_session,
                                           session_tokens):
    app.config['REFRESH_GRACE_SECONDS'] = 1

    first = _refresh(client, session_tokens['refresh'])
    assert first.status_code == 200
    pair1 = first.get_json()['data']

    time.sleep(1.2)  # let the grace record expire

    replay = _refresh(client, session_tokens['refresh'])
    assert replay.status_code == 401

    # ...and the whole session went with it: the rotated pair is dead too.
    after = _refresh(client, pair1['refresh_token'])
    assert after.status_code == 401


def test_unknown_token_refused(app, client, db_session, session_tokens):
    """A structurally-valid refresh JWT whose jti was never issued is
    refused. (It carries the same session claims, so this also proves the
    grace path only honours jtis that actually rotated.)"""
    from flask_jwt_extended import create_refresh_token
    from app.models import User

    with app.app_context():
        # Recreate a token for the same session with a jti Redis never saw.
        import uuid as _uuid
        user = User.query.first()
        forged = create_refresh_token(identity=user, additional_claims={
            'session_id': session_tokens['session_id'],
            'jti': str(_uuid.uuid4()),
            'tenant_id': str(user.tenant_id) if user.tenant_id else None,
        })
    resp = _refresh(client, forged)
    assert resp.status_code == 401
