# Conventions for Claude

## API versioning — everything client-facing lives under ``/api/v1``

``auth_bp`` mounts at ``/api/v1/auth`` and ``api_bp`` at ``/api/v1``
(``register_blueprints`` in ``app/__init__.py``). There are NO legacy
``/auth`` / ``/api`` aliases — this was a deliberate hard cutover before
go-live, because mobile apps pin a version and dual registrations make
live debugging ambiguous. A breaking change ships as ``/api/v2`` next to
v1; never mutate v1 routes in place once real clients exist.

Unversioned on purpose: ``/health``, ``/internal/*`` (ops probes),
``/static``, ``/uploads`` (file serving), and Socket.IO's ``/socket.io``.

## Error envelope — every error carries a machine ``code``

``error_response`` (app/common/responses.py) always emits ``code``:
explicit ``code=`` wins, else it derives from the status
(``default_code_for_status`` — 404→``not_found``, 422→``validation_error``,
429→``rate_limited``, ...). Framework errors (404/405/422/429/500), JWT
failures (``token_expired`` / ``invalid_token`` / ``authorization_required``)
and limiter 429s all use the same envelope. Rules:

* NEVER pass the status positionally — ``error_response(msg, 404)`` puts
  404 into ``errors`` and silently returns 400 (a sweep fixed 129 of
  these; the AST check in the commit for this section finds regressions).
* Pass an explicit ``code=`` only when a client must branch between
  DIFFERENT failures on one endpoint (``slot_taken`` vs
  ``own_duplicate_booking``, ``otp_expired`` vs ``otp_invalid``,
  ``session_limit_reached``, ``channel_readonly``...). New codes are
  lower_snake_case; legacy UPPER_SNAKE codes (``EMAIL_NOT_VERIFIED``,
  ``ROLE_MISMATCH``...) are FROZEN — the web frontend branches on them.
* Generic ``except ValueError`` catches that surface service-layer
  messages should use ``service_error_response(e)`` — it classifies known
  messages (OTP, already-registered) into stable codes.
* 500 bodies are redacted in production (``FLASK_ENV=production``):
  detail goes to logs + Sentry, the client gets the ``request_id``.

Path-literal hotspots that must track the mount if it ever changes:
``_STRICT_PATH_PREFIXES`` (app/__init__.py), ``resolve_view`` in
``app/common/act_as.py`` (act-on-behalf re-dispatch),
``staff_prefix_gate(base=...)`` callers (four blueprints — a wrong base
fails staff access closed), ``_webhook_urls`` in
``app/api/admin/payment_gateway.py``, and ``Document`` download URLs in
``app/models/document.py``.

## Media — stable URLs over S3, never raw signed links

``media_assets`` (app/models/media_asset.py) is the durable name for a
stored object; clients keep ``/api/v1/media/<id>`` forever and the
redirect (app/api/media) exchanges it for a fresh presigned / public S3
URL per request. Rules:

* NEVER persist a presigned URL into a DB column — it dies in an hour.
  Three "refresh before returning" writers did exactly that; reads now
  sign fresh from ``*_s3_key`` (``ProfileSignature.to_response_dict``).
* New upload surfaces go through ``S3Service.upload_file`` and store the
  returned ``media_url`` (RELATIVE ``/api/v1/media/<id>`` — host-portable).
  Uploads are sha256-deduped per tenant+bucket.
* Asset ``access``: ``public`` (no auth on redirect) vs ``tenant``
  (same-tenant authenticated); finer rules stay in owning features.
  Cross-tenant lookups answer 404, not 403.
* Local dev has NO AWS credentials — object storage is the
  ``jlmush-minio`` container (buckets pre-created, ``MINIO_*`` +
  ``MINIO_ALL_BUCKETS=true`` in .env). Production leaves those unset.
* **Per-tenant key layout** (all NEW uploads):
  ``tenants/<tenant_id>/[public/]<folder>/<asset_type>/<uuid>.<ext>``,
  ``platform/...`` for vendor assets. One prefix per tenant makes
  offboarding/DPDP erasure a recursive delete and storage metering a
  prefix listing; the ``public/`` marker keeps key-only bucket
  detection deterministic (``get_signed_url``).
* Migration scripts (both idempotent/resumable, dry-run by default):
  ``scripts/backfill_media_assets.py`` registers legacy objects as
  assets at their CURRENT keys + rewrites the 26 ``*_url``/``*_s3_key``
  column pairs to stable paths (``--hash`` fills sha256);
  ``scripts/migrate_s3_tenant_layout.py`` then relocates objects into
  tenant prefixes (copy → verify → update asset row AND every legacy
  ``*_s3_key`` column → delete), flags sensitive docs sitting in the
  public bucket, and never leaves a dangling reference. Prod order:
  backfill --apply, then mover per tenant.
* Remaining legacy: pre-rail ``/uploads/...`` profile images (local
  files, still served read-only); the ``*_url`` columns themselves
  (now stable-path caches — dropping them means touching each reader).

## Architecture — vendor vs. customer tenants

**The SaaS vendor and the product business are now two different tenant
rows.** This replaced the old "platform owner is a super tenant" model.

Two flags on ``tenants``, deliberately separate — do NOT conflate them:

* ``is_platform`` — the **SaaS vendor** (slug ``vendor``). Sells the
  product, consumes none of it, owns no product data. This is the row
  that bypasses entitlement and seat limits, and the one the
  PLATFORM_OWNER user belongs to. Exactly one row, enforced by the
  partial unique index ``ux_tenants_single_platform``.
* ``is_default`` — only "where an unresolved anonymous request lands".
  Carries **no** privileges. It happens to point at the vendor today,
  but a customer tenant that became the fallback must stay fully gated.

``larazen`` is now an **ordinary customer tenant** on the ``larazen-ops``
plan, gated by the same ``FeatureGate`` as everyone else (41 of 72 feature
paths, finite seat/entity limits, no ``-1`` sentinels).

Rules of thumb when touching this area:

* Entitlement/quota bypasses key on ``is_platform``. Never re-key one to
  ``is_default``, and never add a new bypass to "fix" a tenant that is
  failing a gate — size its plan instead.
* "Is this the tenant running the public marketplace?" is a **plan
  entitlement**, not a flag: use
  ``MarketplacePolicy.runs_marketplace(tenant_id, vertical)``
  (``app/api/pricing/service.py``). ``is_default`` used to answer this and
  no longer can.
* Plan feature leaves must be ``{'enabled': True}`` dicts, not bare
  booleans — ``DomainPolicy`` reads them via ``_walk_to_leaf_meta``, which
  returns ``{}`` for a bool, so a bool leaf silently fails every
  DomainPolicy check while looking enabled to ``FeatureGate``.
* A tenant acts on its **own** routing via ``/api/admin/tenant-domain``
  (tenant id from ``current_tenant_id_strict()``); ``/api/platform/*`` is
  the vendor control plane and is PLATFORM_OWNER-only.

Relevant scripts: ``split_apex_tenant.py`` (the migration, ``--apply``),
``create_larazen_plan.py``, ``verify_apex_split.py``,
``measure_larazen_footprint.py`` / ``probe_larazen_feature_usage.py``.

**Still coupled (planned, not done):** one SPA bundle is served for both
the vendor and every tenant host, so which pages apply is decided at
runtime by ``useIsOnPlatformDomain`` rather than at build time.

The vendor also still answers on the zone apex it shares with the Larazen
business. Until the data cutover runs and the two get distinct hosts, the
separation is real in code but not yet on DNS.

## CHANGES IN DATABASE
  1. If any database changes are made Use `docker compose exec <backend> flask db migrate -m "<message>"` to create migrations
     and then do the upgrade using `docker compose exec <backend> python scripts/migrate.py`

## Commits and pushes
- **NEVER commit or push without first verifying the change runs
  cleanly in the live app.** A passing `vite build` / Python import
  smoke-test is NOT enough — those catch syntax / compile errors but
  miss runtime regressions (e.g. preview crashes, save-without-effect,
  silent backend errors). The verification flow is:
  1. Run the backend in Docker (already running on the user's
     machine; do not start / stop it without asking).
  2. Run the frontend in dev mode (`npm run dev` from `Frontend/`).
  3. Drive the actual flow the change affects as the relevant role
     (PLATFORM_OWNER / SUPER_ADMIN / patient / doctor as appropriate)
     and confirm the symptom is fixed AND nothing nearby broke.
  4. Only after that, commit + push.
  
- If interactive verification is genuinely impossible (no browser
  access, no MCP browser tool, credentials unavailable), STOP and
  ask the user how to proceed. Do not commit + push and apologise
  afterward — the user has made clear that's the wrong order.
- **Do NOT add a `Co-Authored-By: Claude ...` trailer to commit
  messages.** The user prefers their git history to attribute
  commits to themselves only.
- Otherwise follow the standard commit-style described in CLAUDE
  Code's default git instructions (clear subject line, "why over
  what" in the body, HEREDOC for multiline messages).

## OpenAPI

``openapi/openapi.json`` describes the mobile surface (337 operations,
introspected from the url_map + curated schemas for the MVP core).
Regenerate after route changes: ``scripts/generate_openapi.py`` (see its
docstring for the docker run + cp recipe), then re-run
``npx openapi-typescript`` in the frontend (src/api/types/api.d.ts).
