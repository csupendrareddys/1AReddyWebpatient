# Conventions for Claude

## Architecture — vendor host vs. tenant hosts

The SaaS **vendor** and the product **tenants** are now separate tenant rows
(see the backend CLAUDE.md). The same JS bundle is served from every host, so
"does this page belong here?" is a **host** question, not a role question.

* ``useIsOnPlatformDomain()`` — true on the vendor apex. Driven by
  ``VITE_PLATFORM_APEX_HOSTS`` (comma-separated, in ``.env.*``), **not**
  hardcoded: the vendor's domain moves, and ``larazen.in`` is becoming an
  ordinary customer tenant.
* ``VendorOnlyRoute`` / ``TenantOnlyRoute``
  (``src/common/components/VendorOnlyRoute/``) enforce the split. Pages that
  SELL the SaaS (``/pricing``, ``/signup/tenant``) are vendor-only. The
  product's own public surfaces (``/join``, ``/module``, ``/service``,
  ``/book/*``) are tenant-only.
* Marketplace copy must not leak onto the vendor site: the "Join Our
  Network" nav button, ``JoinNetworkBand``, and the ``cta_band`` *defaults*
  ("Are you a doctor?" → ``/join/doctor``) are all tenant-gated.

Both guards are presentation only. Authorization is server-side.

## A tenant's own settings vs. the platform console

``/dashboard/platform/*`` is the vendor managing **other** tenants
(PLATFORM_OWNER-only). ``/dashboard/admin/*`` is a tenant managing **itself** —
including ``getting-started`` and ``domain``, which call
``/api/admin/tenant-domain`` where the backend resolves the tenant from the
request. Never route a tenant's self-service through ``/api/platform/*``.

Customer-facing screens must not surface internal provisioning detail. The
tenant-domain API deliberately returns ``has_provisioning_issue`` (a boolean)
rather than ``dns_error`` / ``cf_error``, whose text names our Cloudflare env
vars.

## RTK Query can wedge — `usePrimedQuery`

A query's selector can sit at ``status: 'pending'`` with ``data === undefined``
forever while the network tab shows a **200 with the full body**. This is NOT
a StrictMode-only artifact — it reproduces in a production ``vite build``. It
surfaces as a permanent spinner, or worse, silently-defaulted content.

``src/common/hooks/usePrimedQuery.js`` wraps a query and additionally primes
it from an imperative ``refetch().unwrap()``. Call its ``reprime()`` after any
mutation that invalidates the query, or the primed value stays frozen and a
successful save appears to do nothing. Used by ``PublicLandingLayout``,
``PricingSection`` and the tenant-domain pages.
## CHANGES IN DATABASE
  1. If any database changes are made Use `docker compose exec <backend> flask db migrate -m "<message>"` to create migrations
     and then do the upgrade using `docker compose exec <backend> python scripts/migrate.py`


**Future intent:** split the platform owner off from owning a tenant — they
should eventually only *manage plans / entitlements* (a pure cross-tenant
control plane). Until then, assume the current model, but don't deepen the
coupling where a clean plans-only separation is cheap to keep.

## Commits and pushes

- **NEVER commit or push without first verifying the change runs
  cleanly in the live app.** A passing `vite build` / Python import
  smoke-test is NOT enough — those catch syntax / compile errors but
  miss runtime regressions (e.g. preview crashes, save-without-effect,
  silent backend errors). The verification flow is:
  1. Run the backend in Docker (already running on the user's
     machine; do not start / stop it without asking).
  2. If node modules is empty, That means frontend is running in docker.
  3. IF not in docker, Run the frontend in dev mode (`npm run dev` from `Frontend/`). 
  Else use docker commands
  4. Drive the actual flow the change affects as the relevant role
     (PLATFORM_OWNER / SUPER_ADMIN / patient / doctor as appropriate)
     and confirm the symptom is fixed AND nothing nearby broke.
  5. Only after that, commit.
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

