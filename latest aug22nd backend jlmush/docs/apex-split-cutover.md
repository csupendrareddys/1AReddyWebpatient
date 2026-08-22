# Apex split — production cutover runbook

Splits the single apex tenant into two rows: the SaaS **vendor** and **Larazen**,
an ordinary customer. Everything below has been rehearsed against a local
database; the production run is the same sequence against real data.

## The two domains

These are different things and confusing them is the main way this goes wrong.

| | value | who owns it | where it is declared |
|---|---|---|---|
| **DNS zone** | `larazen.in` | Larazen (a customer) | `CLOUDFLARE_BASE_DOMAIN`, `VITE_PUBLIC_BASE_DOMAIN` |
| **Vendor host** | `jlmushcloud.com` | the SaaS vendor | `vendor.domain` column, `VITE_PLATFORM_APEX_HOSTS` |

Existing tenant subdomains stay `<slug>.larazen.in`. They do not move, and the
zone does not change.

The vendor host must be declared in **both** places. Pointing a domain at the
frontend does not by itself make it the vendor: an undeclared host falls through
to the `is_default` fallback, so it renders the vendor's content while the SPA
still treats it as a tenant — `/pricing` hidden, `/join` shown.

## Preconditions

1. **Take a database backup.** The split mutates the apex row in place. It runs
   as one transaction and rolls back on failure, but the migrations before it do
   not, and there is no unsplit script.
2. `CLOUDFLARE_BASE_DOMAIN=larazen.in` is set on the backend. Host resolution has
   no database fallback for the zone — if it is unset, `<slug>.larazen.in` stops
   resolving to its tenant.
3. DNS for `jlmushcloud.com` points at the frontend, with a certificate. Do this
   first; nothing below provisions it.
4. Alembic is at head. The split needs `b1p2l3a4t5f6` (`is_platform`) applied.
5. No `PLATFORM_OWNER` user sits outside the apex tenant. The dry run in step 2
   checks this and refuses if any do — resolve them deliberately rather than
   letting the cutover re-home them onto the vendor.

## Order

Substitute your production container name for `jlmush-backend`.

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/measure_larazen_footprint.py
```

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/probe_larazen_feature_usage.py
```

Those two are read-only and size the plan. Review the output before continuing —
the plan created next is built from it, and a plan sized too small means Larazen
starts over its limits on day one.

The next one takes no flags and **writes on invocation** — there is no dry run,
so review the measurements first. It is idempotent, so a re-run is safe.

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/create_larazen_plan.py
```

Dry run the split. Nothing is written; read the output and confirm the row it
proposes to convert is the one you expect.

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/split_apex_tenant.py --larazen-domain larazen.in --vendor-domain jlmushcloud.com
```

Then apply:

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/split_apex_tenant.py --larazen-domain larazen.in --vendor-domain jlmushcloud.com --apply
```

This converts the apex row in place — no row changes `tenant_id`, so every user,
doctor, clinic, appointment and landing config stays exactly where it is. It
then creates the vendor row, moves the platform owner(s) onto it, and **revokes
their sessions**: they must sign in again, on `jlmushcloud.com`.

Give the two sites distinct branding, or both fall through to the same
placeholder and you cannot tell by eye which host you are on:

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/seed_vendor_and_larazen_branding.py
```

## Frontend

`VITE_PLATFORM_APEX_HOSTS=jlmushcloud.com` is already committed in
`.env.production`. It is a **build-time** value, so the SPA must be rebuilt and
redeployed for it to take effect. Until then the bundle still names `larazen.in`
as the vendor host and will hide Larazen's own `/join`, `/book/*`, `/module` and
`/service` behind `TenantOnlyRoute`.

Deploy the backend and the rebuilt frontend together. `VITE_PUBLIC_BASE_DOMAIN`
and `VITE_API_BASE_URL` do not change — the API stays at `api.larazen.in`.

## Verification

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/verify_apex_split.py
```

Exits non-zero on any failure. It checks entitlement *outcomes*, not just row
flags — a split that flipped the columns but left Larazen sailing through every
gate is a failed split.

```bash
docker exec -w /app -e PYTHONPATH=/app jlmush-backend python scripts/verify_tenant_domains.py
```

Then by hand:

- `larazen.in` serves the clinic — `/book/*` and `/join` render, `/pricing` does not.
- `jlmushcloud.com` serves the vendor — `/pricing` and `/signup/tenant` render, `/join` does not.
- An existing `<slug>.larazen.in` tenant still resolves to its own row.
- A platform owner can sign in on `jlmushcloud.com` and reach `/dashboard/platform/*`.
- A platform owner acting on a customer tenant is refused without a support session.

## Rollback

Restore the backup. The split is idempotent and reports "already split" on a
re-run, so a partial retry is safe, but there is no script that reverses it.

If only the frontend is wrong — vendor pages on the clinic's domain or the
reverse — redeploy the SPA with the previous `VITE_PLATFORM_APEX_HOSTS`. That is
a UI-level fix; the backend split stays in place and the data is unaffected.

## After

Larazen is now plan-gated like any other customer. It will hit limits the apex
never did. When it does, size its plan — do not add an `is_platform` bypass to
make a gate pass, because that is the exemption the whole split removed.
