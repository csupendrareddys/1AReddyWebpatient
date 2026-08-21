# Patient Mobile MVP — Recommended Architecture

**Expo + React Native + TypeScript, against the existing Flask backend with zero backend/web changes.**

This document is a design recommendation only. No implementation, no changes to
`JlmushIITMbackend/` or `JlmushIITMfrontend/`.

---

## 1. The constraint that shapes everything

The backend was built for a **multi-tenant browser app**. Two of its core
mechanisms assume a browser, and a mobile app has neither:

| Browser mechanism | Why mobile lacks it | Consequence |
|---|---|---|
| `Host` header identifies the tenant | An app has no URL/host | Tenant must be sent explicitly |
| HTTP-only cookies carry the JWT | No cookie jar, no CSRF cookie | Auth must be header-based |

The good news, verified in the source: **both already have first-class, supported
escape hatches** — because the web app itself hit these problems with tenant custom
domains and third-party-cookie blocking. So the mobile app rides a path the backend
already supports and exercises in production. **No backend change is required.**

---

## 2. How the mobile app authenticates (bearer-only)

`config.py:52` — `JWT_TOKEN_LOCATION = ['headers', 'cookies']`

`/auth/signin` returns the tokens **in the response body**, not just as cookies
(`app/auth/route.py:595-606`), with this comment in the source:

> Tokens are ALSO returned in the response body so a cross-site frontend […] can
> stash them […] and send them as `Authorization: Bearer …`

`/auth/refresh` accepts the refresh token from a cookie, an
`Authorization: Bearer` header, **or** a JSON body field (`app/auth/route.py:692-699`).

**Recommendation: the mobile app is bearer-only. It never sends cookies.**

Consequences that simplify mobile a lot:

- **No CSRF handling.** `JWT_COOKIE_CSRF_PROTECT` only applies to tokens sourced
  from cookies. Header-sourced tokens skip it entirely. Drop all the
  `X-CSRF-TOKEN` logic the web client carries.
- Access token: **10 min** (`JWT_ACCESS_TOKEN_EXPIRES_MINUTES`).
- Refresh token: **10 days**, absolute session cap **30 days** (`SESSION_HARD_LIMIT_DAYS`).
- `MAX_SESSIONS_PER_USER = 5` — a phone is one more session alongside the user's
  web logins. Not a problem at 5, but worth knowing: a user on several devices can
  get pushed into a session-limit `403` on signin.

### 2.1 The single most important correctness detail

Refresh tokens are **single-use, atomically consumed, and always rotated**, backed
by Redis and **failing closed** if Redis is unavailable (`app/auth/route.py:676-679`,
and `config.py:74` — *"tokens now ALWAYS rotate (single-use)"*).

That means: **two concurrent refresh calls = the second one is a replay = the whole
session is invalidated and the user is logged out.**

This is a much bigger risk on mobile than on web. A React Native app fires a burst
of parallel requests every time it resumes from background — which is exactly when
the 10-minute access token has expired. Without protection, *every* app resume after
10 minutes idle logs the user out.

**Required design:**

- A **single-flight refresh mutex** — one refresh in flight, all other 401s queue on
  its result and then retry. (The web client already does this in
  `src/api/axiosConfig.js:17-26`; mirror it.)
- The mutex must be **module-level and survive app state changes**, not per-screen.
- **Persist the rotated refresh token to secure storage *before* releasing the
  mutex.** If the app is killed between "server rotated" and "we saved it", the
  stored token is already dead and the user is silently logged out on next launch.
- Never refresh on 401 from `/auth/signin`, `/auth/signup*`, `/auth/refresh`
  themselves — infinite loop.
- Optional but recommended: **proactive refresh** on app foreground when the access
  token is within ~60s of expiry, so the burst never 401s in the first place.

### 2.2 Token storage

Use **`expo-secure-store`** (iOS Keychain / Android Keystore). **Not** AsyncStorage
— this is a PHI application and AsyncStorage is plaintext on disk.

Store: `access_token`, `refresh_token`, selected tenant, and a cached minimal user
object for optimistic launch.

---

## 3. Tenant resolution — the biggest design decision

Backend resolution order (`app/__init__.py:560-632`):

1. `request.host` (trusted) — **mobile has none**
2. `X-Tenant-Slug` header — honoured when `BACKEND_TRUST_TENANT_HOST_HEADER=true`
3. `X-Tenant-Host` header — same gate

That flag **defaults to `true`** (`config.py:301-303`), so the mobile app can send
`X-Tenant-Host` today and it resolves correctly.

### 3.1 The trap: JWT-vs-host mismatch silently 401s everything

`app/__init__.py:660-673`: when the JWT's tenant and the header-resolved tenant
**disagree**, the backend **scrubs the JWT** and the request proceeds as anonymous —
so every authenticated endpoint returns **401**, not a clear tenant error.

Practical rule for the mobile client:

> The persisted tenant **must** match the logged-in user's tenant, always. On login
> success, overwrite the stored tenant from the authoritative
> `/auth/me` → `tenant_context`. Never let a stale tenant selection outlive a session.

Otherwise you get an unfixable-looking "logged in but everything 401s" bug, and the
refresh-on-401 logic will burn the refresh token trying to recover from it.

### 3.2 Recommended approach

**MVP: a single build per deployment**, tenant host baked into the EAS build profile
(`EXPO_PUBLIC_TENANT_HOST`), with a hidden dev-only override screen.

This is the simplest thing that works and matches how most patient apps ship (a
clinic brands its own app). Add a runtime **tenant picker** only when you actually
need one binary serving many tenants — at which point the picker writes to
SecureStore and the rule in 3.1 applies.

### 3.3 One risk to track

`BACKEND_TRUST_TENANT_HOST_HEADER` is explicitly documented as a **rollout
compatibility flag intended to be flipped off** once the web frontend stops sending
legacy headers. If it's turned off, the mobile app loses tenant resolution for all
**anonymous** calls (authenticated calls still work — the JWT carries `tenant_id`).

Not a blocker, and not something to fix now, but the person who eventually flips
that flag needs to know mobile depends on it. Worth a comment in the backend config
when the time comes.

---

## 4. Stack recommendation

| Concern | Choice | Why |
|---|---|---|
| Framework | **Expo SDK (latest), TypeScript `strict`** | As specified |
| Navigation | **expo-router** (file-based, typed routes) | Deep links come free — needed for invites/booking links |
| Server state | **TanStack Query** | The app is ~90% server state; caching, retry, background refetch, offline are exactly the mobile problems |
| Client state | **Zustand** (small) | Auth session + tenant only |
| HTTP | **axios**, one configured instance | Direct port of the web interceptor logic, minus cookies/CSRF |
| Storage | **expo-secure-store** (tokens) + **AsyncStorage** (non-sensitive cache) | PHI separation |
| Forms | **react-hook-form** + **zod** | Needed for the dynamic renderer in §6 |
| Realtime | **socket.io-client** | Backend is Socket.IO; token goes in handshake `auth` |

### 4.1 Why TanStack Query and not Redux Toolkit (as the web uses)

The web app uses RTK, so RTK Query would give surface-level parity. I'd still
recommend TanStack Query: parity of *libraries* matters much less than parity of
*API contracts*, and the mobile-specific problems here — refetch on app foreground,
stale-while-revalidate over flaky mobile networks, offline cache of appointments —
are TanStack Query's core competency and would be hand-rolled in RTK.

Keep parity where it actually matters: **share the endpoint paths, payload shapes,
and error codes**, not the state library.

### 4.2 Expo Go will not be sufficient

Plan for a **custom dev client via EAS Build from day one**:

- **Razorpay** (`razorpay==1.4.2`, `app/api/common/payment/routes.py`) — the RN SDK
  is a native module.
- **Twilio Video** (`twilio==9.4.0`) — WebRTC is native; `twilio-video` is browser-only.
- Secure store, notifications, and file pickers all behave differently in Go.

Discovering this in week 3 is a common and avoidable schedule hit.

---

## 5. API client design

A single `apiClient` mirroring `src/api/axiosConfig.js`, with these differences:

**Removed:** `withCredentials`, all cookie reads, all CSRF headers, `window`/`document`
access, Vite env vars.

**Added / changed:**

- `Authorization: Bearer <access>` on every call; `<refresh>` **only** on `/auth/refresh`.
- `X-Tenant-Host` (and optionally `X-Tenant-Slug`) from stored tenant config.
- **Timeouts** — mobile networks stall in ways desktop doesn't; axios defaults to none.
- **Retry with backoff** for idempotent GETs on network failure only. Never retry
  POSTs — booking and payment are not idempotent here.
- **429 handling.** Limits are real: `100/min` global API, `5/min` signin,
  `10/min` refresh. Respect `Retry-After`; never retry a 429 blindly.

### 5.1 Response envelope

Uniform across the API (`app/common/responses.py`):

```
success → { success: true, message?, data? }
error   → { success: false, error, code?, errors? }
```

Unwrap `data` in one place and type it. Model the **error `code`** as a
discriminated union — the backend uses codes for real control flow, and the mobile
app must branch on them rather than on message strings:

| Code | HTTP | Mobile behaviour |
|---|---|---|
| `ROLE_MISMATCH` | 403 | Non-patient account used a patient app — explain, don't retry |
| `EMAIL_NOT_VERIFIED` | 403 | Route to verify flow; backend suggests phone login instead |
| `PHONE_NOT_VERIFIED` | 403 | Route to OTP verification |
| `PENDING_ACTIVATION` | 403 | Admin-created account — show activation instructions |
| `feature_disabled` | 403 | Tenant's plan lacks the feature — hide/disable the UI |
| `no_active_subscription` | 402 | Tenant billing lapsed — informational screen |

Pass `expected_role: 'patient'` on signin so the backend rejects doctor/admin
credentials at the door rather than letting them into a patient UI.

---

## 6. Server-driven UI — do not hardcode the patient forms

This is the part most easily missed, and it's structural.

Patient **profile** and **appointment/booking** screens are **not fixed forms**. They
are admin-authored, versioned, draft/publish field configurations, fetched per tenant:

- `GET /api/patient-profile-config/public/patient_profile`
- `GET /api/patient-appointment-config/public/<page_type>` — `patient_appointment_filter`, `patient_appointment_symptoms`
- `GET /api/.../public/data-source/<source>` — resolved option lists (symptoms, languages, …)

Both accept a **`lang`** query param (the platform is multilingual) and a
`user_type` for RBAC field filtering. Admins can add, remove, reorder, and
re-translate fields at runtime, per tenant.

**If the mobile app hardcodes these forms, it silently diverges from the tenant's
configuration the first time an admin publishes a change** — and patient profile data
is exactly where that divergence causes validation failures and lost fields.

**Recommendation:** build a small **dynamic form renderer** for the MVP —
a registry mapping backend field types to RN components, driven by the fetched
config, validated with a zod schema generated from that config, cached with a
version/ETag and refreshed on foreground.

Scope control: build the renderer to cover **only the field types the tenants
actually use today**, and fail visibly (a "this field isn't supported in the app yet"
placeholder that still submits untouched data) rather than crashing on an unknown
type. That keeps it a ~2-day component instead of an open-ended framework.

---

## 7. Feature gating

`/auth/me` returns `plan_code`, a flat `feature_paths` list, `plan_limits`,
`plan_addons`, and `tenant_context` — the *same* data the backend's
`@feature_required` decorator enforces, so client and server cannot disagree.

Patient routes are individually gated, e.g. `@feature_required('patient.documents')`.

**Design:** a `useFeature('patient.documents')` hook reading the cached `/auth/me`
payload, used to hide or disable UI. Treat it strictly as **UI gating** — always also
handle the `feature_disabled` 403, since the plan can change mid-session.

`/auth/me` is the app's **bootstrap call**: it establishes user, role, tenant, and
entitlements in one round trip. Fetch it on launch and on foreground-after-idle.

---

## 8. MVP scope

Mapped to endpoints that already exist:

**Phase 1 — core loop**
1. **Auth** — signin (`expected_role: patient`), phone/email OTP
   (`/auth/send-phone-otp`, `/auth/login-via-otp`), forgot/reset password, logout.
2. **Bootstrap** — `/auth/me`, tenant + feature resolution.
3. **Find care** — `/api/patient/doctors`, `/doctors/search`, `/doctors/<id>`, `/symptoms`.
4. **Availability** — `/api/timeslot/doctor/<id>/timeslots` + `/summary`,
   `/api/patient/slot-availability-summary`.
5. **Book** — `POST /api/appointment` (`doctor_id`, `appointment_date` `YYYY-MM-DD`,
   `start_time` `HH:MM`, `appointment_type`, `chief_complaint`, …).
6. **My appointments** — `/api/appointment/patient/upcoming`, `/patient/history`,
   `/<id>/cancel`, `/<id>/reschedule`.
7. **Profile** — dynamic config-driven profile sections.

**Phase 2**
8. **Payments** — Razorpay native SDK against `/api/payment/*`.
9. **Prescriptions & records** — `/api/patient/prescriptions`, `/health-records`, `/vitals`.
10. **Documents** — multipart upload (see §9).

**Phase 3 — deliberately deferred**
11. **Video consults** — Twilio Video RN; significant native work, permissions,
    CallKit/ConnectionService, background audio. Its own project.
12. **Family / house-group**, marketplace, memberships, credits.

**Deferred with a known gap: push notifications.** I checked — there is **no push
infrastructure in the backend at all** (no FCM/APNs/device-token code or
dependencies). Appointment reminders therefore cannot work on mobile without a
backend change, which is out of scope here. For the MVP: use Socket.IO while the app
is foregrounded, plus refetch-on-foreground. Flag push as the first backend ask
after the MVO — for a patient appointment app it's close to table stakes, and it's
better raised now than discovered at launch.

---

## 9. File uploads

Uploads are **multipart to the backend**, which pushes to S3 itself and returns a
**signed URL** (`app/api/service_reciever/patient/routes.py:1026-1072`) — not
browser-side presigned PUTs. So RN sends `FormData` with a file URI; straightforward.

Two mobile-specific notes:

- **Signed URLs expire.** Don't persist them in a long-lived cache as if permanent —
  re-fetch the parent resource to get a fresh URL, and let image caching key off a
  stable id rather than the signed URL string.
- Compress images client-side before upload; phone camera output is large and the
  upload path is synchronous through the API server.

---

## 10. Security posture (PHI)

- Tokens in **SecureStore** only.
- **Never log** request/response bodies in release builds — the API returns PHI, and
  the backend encrypts email/phone at rest precisely because this data is sensitive.
  Strip the web client's verbose `[API →]` logging pattern from production paths.
- **Biometric/PIN app lock** on foreground — worth having in the MVP for a health app.
- **Auto-logout** aligned with the 30-day absolute session cap.
- Clear SecureStore + all query caches on logout, and on any refresh failure.
- Consider `expo-screen-capture` on prescription/record screens.
- Certificate pinning: reasonable later, unnecessary in the MVP.

---

## 11. Proposed structure

```
patient-mobile/
├─ app/                        # expo-router routes
│  ├─ (auth)/                  # signin, otp, forgot-password
│  ├─ (tabs)/                  # home, appointments, records, profile
│  ├─ doctor/[id].tsx
│  └─ booking/[doctorId].tsx
├─ src/
│  ├─ api/
│  │  ├─ client.ts             # axios instance + interceptors
│  │  ├─ refreshManager.ts     # single-flight mutex (§2.1)
│  │  ├─ envelope.ts           # unwrap + typed error codes
│  │  └─ endpoints/            # auth, patient, appointment, timeslot, config
│  ├─ auth/                    # session store, secure storage, bootstrap
│  ├─ tenant/                  # tenant config + headers
│  ├─ features/                # mirrors web feature naming
│  ├─ forms/                   # dynamic renderer (§6)
│  ├─ components/
│  └─ theme/
└─ types/api.ts                # shared response/domain types
```

Mirror the web's **feature naming** (`service-receiver` → patient features) so the
two codebases stay navigable by the same people.

---

## 12. Summary of key decisions

1. **Bearer-only auth.** Already supported; no cookies, no CSRF. No backend change.
2. **Single-flight refresh with persisted rotation** — non-negotiable, given
   single-use refresh tokens. The #1 source of mystery logouts if skipped.
3. **Tenant via `X-Tenant-Host`**, baked per build; must always agree with the JWT's
   tenant or everything 401s.
4. **Expo + custom dev client from day one** — Razorpay and Twilio need native modules.
5. **TanStack Query** for server state; share contracts with web, not state libraries.
6. **Dynamic form renderer** for profile/booking — the backend's config-driven UI
   makes hardcoding a correctness bug, not just a maintenance one.
7. **Defer video to its own phase**; **flag push notifications as a backend gap**
   that blocks appointment reminders.
