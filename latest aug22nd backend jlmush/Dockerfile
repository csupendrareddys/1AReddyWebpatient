# syntax=docker/dockerfile:1.6
#
# jlmush Backend — Flask + Gunicorn
# Multi-stage build:
#   1. builder  → compiles wheels for all Python deps
#   2. runtime  → slim image with only what's needed to run gunicorn
#
# Notes:
#   - No DB wait, no migrations on startup. Migrations run via `docker exec`.
#   - RDS SSL CA bundle is baked in at /app/certs/global-bundle.pem (public file).
#   - Runs as non-root user `appuser`.
#

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: builder
# ──────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps for wheels that may need to compile (cryptography, psycopg2, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .

# Pre-build wheels into /wheels so the runtime stage can install offline.
RUN pip wheel --wheel-dir /wheels -r requirements.txt


# ──────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
# ──────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_HOME=/app \
    PORT=5000

# Runtime libs only (no compilers). libpq5 is needed by psycopg2-binary;
# curl is used to download the RDS CA bundle and is removed afterwards.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps from pre-built wheels (fast, no network).
COPY --from=builder /wheels /wheels
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-index --find-links=/wheels -r /tmp/requirements.txt \
    && rm -rf /wheels /tmp/requirements.txt

# Bake the RDS global CA bundle into the image. This is a public file.
RUN mkdir -p ${APP_HOME}/certs \
    && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
         -o ${APP_HOME}/certs/global-bundle.pem \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system app && useradd --system --gid app --home ${APP_HOME} appuser

WORKDIR ${APP_HOME}

# Copy application source. Keep this last so dep installs cache properly.
# NOTE: the legacy root-level ``model.py`` and ``Rbac.py`` re-export shims
# were removed when the code was modularised into ``app/models/`` and
# ``app/models/rbac.py``. Nothing under ``app/`` imports them at runtime,
# so they are no longer part of the image.
COPY --chown=appuser:app app/                      ${APP_HOME}/app/
COPY --chown=appuser:app migrations/               ${APP_HOME}/migrations/
COPY --chown=appuser:app scripts/                  ${APP_HOME}/scripts/
COPY --chown=appuser:app wsgi.py                   ${APP_HOME}/wsgi.py
COPY --chown=appuser:app config.py                 ${APP_HOME}/config.py
# Operator-run helpers. Not imported by the app, but invoked via
# ``docker exec <container> python <file>`` to seed the platform owner
# or admins on a new environment.
COPY --chown=appuser:app create_platform_owner.py  ${APP_HOME}/create_platform_owner.py
COPY --chown=appuser:app create_admin.py           ${APP_HOME}/create_admin.py
COPY --chown=appuser:app diagnose_amplify.py       ${APP_HOME}/diagnose_amplify.py

RUN chown -R appuser:app ${APP_HOME}

USER appuser

EXPOSE 5000

# Selects the eventlet async worker (below) and triggers eventlet.monkey_patch()
# in wsgi.py. Without this the Socket.IO WebSocket transport cannot work.
ENV SOCKETIO_ASYNC_MODE=eventlet

# Gunicorn — switched to the eventlet async worker for Socket.IO.
#   --worker-class eventlet : one worker serves thousands of concurrent
#                             WebSocket/long-poll connections via green threads.
#   --workers 1             : Socket.IO's polling handshake must return to the
#                             SAME worker; gunicorn does NOT pin a client to a
#                             worker, so >1 worker per process causes
#                             intermittent "Session ID unknown". Scale OUT
#                             (more containers behind nginx, sticky sessions +
#                             the Redis message_queue), not up.
# HTTP throughput is preserved because eventlet multiplexes non-blocking I/O in
# the single worker; only blocking psycopg2 calls serialize (see requirements).
CMD ["gunicorn", \
     "--worker-class", "eventlet", \
     "--workers", "1", \
     "--bind", "0.0.0.0:5000", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "wsgi:app"]
