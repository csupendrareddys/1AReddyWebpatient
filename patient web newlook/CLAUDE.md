# Conventions for Claude

## Architecture — Platform Owner & tenancy (current vs. future)

**Today, the PLATFORM_OWNER is itself a tenant** (anchored to the default
``is_default`` / ``platform`` tenant — the apex/localhost). Their own data
lives on that tenant, AND they can control other tenants: manage the SaaS
plan catalog + add-ons, grant per-tenant entitlements/feature flags, and act
cross-tenant via the ``/dashboard/platform/*`` surface. This is why the
platform owner is allowed into ``/dashboard/admin`` and why gating keys off
both role (``isPlatformOwner``) and host (``is_default_tenant`` /
``useIsOnPlatformDomain``). Treat them as a **"super tenant"** for now.
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

