# Local Backend — Run Guide

Run the jlmush backend locally with Docker Compose. The stack is three
containers on one host:

| Service   | Container         | Image / build        | Host port | Resource cap (forced)      |
|-----------|-------------------|----------------------|-----------|----------------------------|
| backend   | `jlmush-backend`  | `Dockerfile`         | `5000` + `5001` | **2 vCPU, 4 GiB RAM**      |
| postgres  | `jlmush-postgres` | `postgres:16-alpine` | `5432`    | none (20 GB disk in prod)  |
| redis     | `jlmush-redis`    | `Dockerfile.redis`   | `6379`    | **512 MiB RAM** (`maxmemory=384mb`) |

> The backend is published on **both 5000 and 5001** (both host ports map
> to container 5000). The frontend's `.env.development` sets
> `VITE_API_BASE_URL=http://localhost:5001`, so 5001 lets the SPA reach the
> backend with no frontend edits; 5000 is there for direct/manual calls.

The caps mirror the production instance sizing (backend EC2 = 4 GB / 2
core / 20 GB; redis co-located ~500 MB). Disk (20 GB) is an EBS value in
prod and is **not** cappable via Docker Desktop's local volume driver —
it's documented in `docker-compose.yml`, not enforced locally.

The app runs in **development** config locally (`FLASK_ENV=development` in
`.env`). Production config is untouched.

---

## Prerequisites

- **Docker Desktop** running.
- Docker Desktop VM allocated **≥ 5 GB RAM** (Settings → Resources) so the
  backend can actually use its 4 GiB cap.
- `.env` must exist in this directory (already generated — holds the
  Fernet `ENCRYPTION_KEY` + JWT/SECRET keys and points DB/Redis at the
  compose service names). It is git-ignored; keep it stable, because the
  DB's encrypted columns are only readable with that same `ENCRYPTION_KEY`.

---

## First-time setup (run once, in order)

```bash
# 1. Build images + start all three services
docker compose up -d --build

# 2. Create the database schema (create_all + stamp at latest migration)
docker compose exec backend python scripts/migrate.py

# 3. Bootstrap platform tenant + plan1 + subscription + platform owner
#    (reproduces the prod state; makes the plan-limit path realistic)
docker compose exec backend python scripts/bootstrap_local.py

# 4. Seed platform-side users: 5 super_admins, 20 doctors, 20 patients
docker compose exec backend python scripts/seed_platform_users.py

# 5. (optional) Make doctor01..06 flow-ready + sample appointments across
#    every state (for end-to-end appointment/payout testing)
docker compose exec backend python scripts/seed_appointment_flow.py
```

After step 4 the API is live at <http://localhost:5000> (and
<http://localhost:5001>).

> Steps 2–5 are **idempotent** — safe to re-run. `migrate.py` upgrades an
> existing DB; the seeders skip rows that already exist.

---

## Everyday commands

```bash
docker compose up -d              # start (after first build)
docker compose stop               # stop containers, keep data
docker compose down               # stop + remove containers (data volume kept)
docker compose down -v            # ⚠️  also delete DB + redis volumes (wipes all data)
docker compose ps                 # status of the three services
docker compose logs -f backend    # tail backend logs
docker compose restart backend    # restart just the backend

# Open a shell / run any script inside the backend container
docker compose exec backend bash
docker compose exec backend python scripts/<script>.py
```

Code is **bind-mounted** into the backend container (`./app`, `./scripts`,
`./config.py`, …), so scripts you run via `docker compose exec` always use
your live edits — **no rebuild needed** for Python changes. Rebuild only
when dependencies (`requirements.txt`) or the `Dockerfile` change:

```bash
docker compose up -d --build backend
```

> Note: the long-running Gunicorn server does **not** hot-reload on edits.
> Restart it (`docker compose restart backend`) to serve changed code.

---

## Seed / bootstrap scripts

| Script                                  | What it does                                                        |
|-----------------------------------------|---------------------------------------------------------------------|
| `scripts/migrate.py`                    | Create schema on a fresh DB, or upgrade an existing one.            |
| `scripts/bootstrap_local.py`            | Platform tenant + `plan1` (super_admin cap 1) + subscription + owner.|
| `scripts/seed_platform_users.py`        | 5 super_admins, 20 doctors, 20 patients in the platform tenant.     |
| `scripts/seed_appointment_flow.py`      | Makes doctor01..06 flow-ready (verified, bank, services, slots) + 5 sample appointments across every state (pending → completed → payout). Run after `seed_platform_users.py`. |
| `create_platform_owner.py`              | Create/promote a single PLATFORM_OWNER (`--phone --password …`).    |
| `create_admin.py`                       | Create a super_admin / sub_admin in a given tenant.                 |
| `scripts/seed_full_demo.py`             | Full multi-tenant demo (4 tenants × 40 users).                      |

---

## Frontend

The React/Vite SPA lives in `../JlmushIITMfrontend` and runs on
**<http://localhost:3000>**.

```bash
cd ../JlmushIITMfrontend
npm install        # first time only
npm run dev        # serves on http://localhost:3000
```

- It calls the backend via `VITE_API_BASE_URL` (see `.env.development` =
  `http://localhost:5001`), which the compose stack now serves.
- CORS for `http://localhost:3000` is already allowed in the backend `.env`.
- SPA login routes by role:
  - `/auth/admin/login` — platform owner + super admin
  - `/auth/service-provider/login` — doctor
  - `/auth/service-receiver/login` — patient
- Backend login endpoint (what the SPA posts to): `POST /auth/signin`
  with `{ phone_number | email, password }`.

---

## Credentials (local seed data)

Log in with **phone _or_ email + password**.

| Role            | Login (phone)                         | Email pattern                       | Password       |
|-----------------|---------------------------------------|-------------------------------------|----------------|
| Platform owner  | `9876500000`                          | `owner@platform-seed.test`          | `Owner@1234`   |
| Super admins    | `9950010000` … `9950050000`           | `super_adminNN@platform-seed.test`  | `Demo@1234`    |
| Doctors         | `9952010000` … `9952200000`           | `doctorNN@platform-seed.test`       | `Demo@1234`    |
| Patients        | `9953010000` … `9953200000`           | `patientNN@platform-seed.test`      | `Demo@1234`    |

### Flow-test roster (after `seed_appointment_flow.py`)

| Who | Phone | Purpose |
|-----|-------|---------|
| doctor01 | `9952010000` | Cardiology, auto-accept, has slots; owns paid-out appt A5 |
| doctor03 | `9952030000` | has completed+paid appt **A4** → ready to **initiate payout** |
| doctor04 | `9952040000` | MANUAL accept; appt **A2** is **pending accept/reject** |
| doctor05 / 06 | `9952050000` / `9952060000` | verified but **no slots** → test **publish slots** |
| patient01 | `9953010000` | book against doctor01–04 (they have bookable slots) |

*(doctor07–20 / patient07–20 exist but are bare/unverified — ignore for flow testing.)*

Emails follow `super_admin01@platform-seed.test`, `doctor01@…`,
`patient01@…`. All seeded accounts are created with `email_verified` and
`phone_verified` = **true** (no OTP step needed). Admins sign in at
`/auth/admin/login`.

---

## Database access

```bash
# psql inside the postgres container
docker compose exec postgres psql -U postgres -d jlmush_dev

# or from the host (postgres is published on localhost:5432)
#   host=localhost port=5432 db=jlmush_dev user=postgres pass=postgres
```

**Reset the database from scratch:**

```bash
docker compose down -v            # deletes the pgdata + redisdata volumes
docker compose up -d --build
# then re-run first-time setup steps 2–4
```

---

## Verify resource caps are applied

```bash
# Live usage vs enforced limit
docker stats --no-stream

# Configured hard limits
docker inspect jlmush-backend --format '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}'
#   -> 2000000000 4294967296   (2 vCPU, 4 GiB)
docker inspect jlmush-redis   --format '{{.HostConfig.Memory}}'
#   -> 536870912               (512 MiB)
```

---

## Troubleshooting

- **Backend keeps restarting / exits on boot** — check `docker compose
  logs backend`. Most common cause: missing/short `ENCRYPTION_KEY` in
  `.env` (must be a 44-char Fernet key).
- **`Plan limit exceeded for super_admin`** on the platform tenant — this
  is fixed: `PlanService.require_within_limit` bypasses the cap for the
  `is_default` (platform) tenant. If you see it, confirm the running
  backend has the current `app/api/pricing/service.py` (it's bind-mounted,
  so just re-run the script; no rebuild needed).
- **Port already in use (5000/5432/6379)** — stop the conflicting service
  or change the left-hand host port in `docker-compose.yml`.
- **Backend can't reach DB/redis** — the `.env` hosts must be the compose
  service names `postgres` / `redis` (not `localhost`), because the app
  runs inside the compose network.

---

## Deploying the same change to prod (EC2)

The production image **bakes code in at build time** (`COPY app/ …` in the
`Dockerfile`), so a running EC2 container will not see a source edit until
the image is rebuilt. To ship a backend code change to EC2: rebuild the
image, recreate the backend container, then run the relevant migration /
seed scripts via `docker exec`. (Prod already has the platform tenant +
`plan1` + subscription, so only `seed_platform_users.py` is needed there —
not `bootstrap_local.py`.)
```
