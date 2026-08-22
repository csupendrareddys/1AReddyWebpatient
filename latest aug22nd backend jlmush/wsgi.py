# ── Eventlet monkey-patch (MUST run before any other import) ──────────────
# Flask-SocketIO's WebSocket transport needs an async worker. Under the
# gunicorn ``eventlet`` worker class, eventlet's green threads only cooperate
# if the stdlib socket/thread/time modules are monkey-patched FIRST — before
# Flask, SQLAlchemy, redis, etc. are imported. Gated on SOCKETIO_ASYNC_MODE so
# local dev / pytest (which run without eventlet) are unaffected: only the
# production container sets SOCKETIO_ASYNC_MODE=eventlet.
import os
if os.environ.get('SOCKETIO_ASYNC_MODE') == 'eventlet':
    import eventlet
    eventlet.monkey_patch()

from app import create_app
from app.extensions import socketio

app = create_app()

# gunicorn imports ``wsgi:app`` (the Flask app). Flask-SocketIO has already
# wrapped it during socketio.init_app, so the same ``app`` serves both HTTP and
# the Socket.IO handshake/WebSocket upgrade — no separate entry point needed.
# ``socketio`` is re-exported here for tooling / ``socketio.run(app)`` in dev.

import logging

logging.basicConfig(level=logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("alembic").setLevel(logging.WARNING)

# /wsgi.py is the entry point for the flask application
# it is used to create the flask application
# it is used to run the flask application
# it is used to debug the flask application
# it is used to deploy the flask application
# we dont have anything called app.py in our project so we are using wsgi.py
# we are not configuring the app here itself as it will craete the issue of circular import
# we are importing the create_app() function from the app.common module
# and we are creating the app instance by calling the create_app() function