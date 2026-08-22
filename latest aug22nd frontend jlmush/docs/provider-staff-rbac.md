# Provider staff & RBAC — what was built, and what it does not do yet

A record of the support-staff system: the people who work for a doctor, clinic
or hospital but are not registered practitioners — a receptionist, a practice
manager, a billing clerk.

---

## 1. The problem this solves

My Link already recorded professional affiliations, classified Partner /
Associate / **Employee**. But every one of those is a link between two accounts
that already exist on the platform. A receptionist has no account, so she could
not be recorded at all, and "Employee" quietly meant *employee who happens to be
a registered doctor*.

So: a staff entity, roles that say what a staff member may do, a sign-in, and —
the part that took the longest — actually enforcing it.

---

## 2. The three walls (and why the third one mattered)

Staff could sign in and read a list of their own permissions. Nothing else.
Asha Menon held "Manage Doctors: view" and could not see a doctor. Three
separate reasons, stacked:

1. **No route.** The sidebar link went back to the same read-only list,
   filtered. Nothing to click into.
2. **The role gate.** `GET /api/affiliation/facility/doctors` was
   `@role_required([HOSPITAL, CLINIC])`. A `PROVIDER_STAFF` caller was refused
   before anything else ran.
3. **Identity ≠ authority.** Every provider service finds the practice by asking
   *who is signed in* — `Clinic.query.filter_by(admin_user_id=current_user.id)`.
   Asha is not any clinic's admin user, so even with the role gate removed she
   resolves to **no clinic at all**.

The third is the real one. The codebase had no notion of *acting on behalf of*
a practice; being the clinic and being allowed to act for it were the same fact.
That is why the grants could only ever be decorative.

---

## 3. How it works now

### `app/common/provider_access.py`

`resolve_principal()` answers **"whose data is this request about"** and returns
the practice's own admin `User`. For an owner that is simply themselves; for
staff it is their employer. Everything underneath keeps taking a `User` and is
untouched — rewriting every provider service to take a practice row would have
been a far larger diff with many more places to get the scoping subtly wrong.

Borrowing a practice's identity is an impersonation primitive, so four tools
wrap it, in decreasing order of strictness:

| Tool | Use it when | Behaviour |
|---|---|---|
| `@provider_access(module, action, verticals)` | A providers-only route, decorated one at a time | Owner passes; staff need the grant; **no module = staff refused** |
| `staff_prefix_gate(base, rules, vertical)` | A blueprint too large to decorate (the doctor API is ~129 rules) | One `before_request` over a path-prefix table; **unlisted = denied** |
| `delegated_user(modules, action)` | The route also serves patients | Everyone else unchanged; only staff are redirected |
| `current_principal()` | Inside a handler that branches by role | Raw resolution; you do the check |

**Deny by default is the point.** A route that declares no module cannot be
reached by staff. New routes appear faster than catalog entries, so the failure
mode has to be a locked door.

### How the gate matches

On the route **pattern**, not the request path. Flask has already matched the
URL by the time a `before_request` runs, so `request.url_rule` gives
`<doctor_id>/metrics` rather than a particular uuid — an id-bearing segment
becomes ordinary matchable text instead of something a rule has to recognise by
shape. Longest prefix wins, so `profile/bank-accounts` sits beside a plain
`profile` catch-all without the shorter one swallowing it.

`role_required` carries one extra clause for this: a request the gate has
already cleared presents as the practice's role. Without it, every delegated
route would have to name `PROVIDER_STAFF` — and naming it would *also* admit
the routes no gate ever checked.

### What staff can never do, whatever the grant

Four escalation paths are closed at the server regardless of what a role says:

- **Assigning roles.** Someone who can set roles can set their own.
- **Creating or editing roles.** Same, one step removed.
- **Setting or revoking a sign-in.** Reset a colleague's password → become them.
- **Changing the login email of someone who has a login.** A password reset with
  an extra step.

Without these, "can edit the staff directory" would silently be a grant of every
other permission.

### Roles are two-tier

Roles were tenant-wide. Letting a practice edit them meant one clinic renaming
"Front Desk" would re-scope *every other clinic's* receptionist. So a role with
no owner is **shared** (admin-curated, read-only to providers); a role with an
owner belongs to one practice.

---

## 4. Coverage — what is actually wired

### Clinic & hospital: complete

| Catalog leaf | Screen |
|---|---|
| `doctors_network.manage_doctors.{roster, invitations, affiliation_requests}` | `/dashboard/staff/doctors` |
| `doctors_network.network_requests` | `/dashboard/staff/network-requests` |
| `entity_profile.entity_details.*` (4 leaves) | `/dashboard/staff/practice` → Entity Details |
| `entity_profile.account_status` | `/dashboard/staff/practice` → Account Status |
| `entity_profile.verification` | **No screen for anyone** — not built for the practice either |
| `billing.membership` | `/dashboard/staff/billing` → Membership |
| `billing.bills.{invoices, payments}` | `/dashboard/staff/billing` → Bills *(same placeholder the practice gets)* |
| `staff.staff_directory` | `/dashboard/staff/team` |
| `staff.staff_roles` | `/dashboard/staff/roles` *(read-only)* |
| `overview.dashboard` | the dashboard itself |

### Doctor: complete, bar one deliberate exclusion

| Catalog leaf | Screen |
|---|---|
| `profile.profile_details.*` (6) + `account_status`, `slot_visibility`, `working_hours`, `consultation_pricing`, `analytics`, `attendance`, `treatable_symptoms` | `/dashboard/staff/doctor-profile` — one tab per leaf, filtered by grant |
| `appointments.my_appointments.*` (3) | `/dashboard/staff/appointments` |
| `appointments.manage.*` (3) | `/dashboard/staff/manage` |
| `records.prescriptions_documents.*` (2) | `/dashboard/staff/records` |
| `records.service_chats.*` (3) | `/dashboard/staff/service-chats` — **attributed**, see below |
| `practice.patients` | `/dashboard/staff/patients` |
| `practice.my_network` | `/dashboard/staff/network` |
| `practice.affiliations` | `/dashboard/staff/affiliations` |
| `practice.plan_teams` | `/dashboard/staff/plan-teams` |
| `practice.billing` + `practice.membership` | `/dashboard/staff/billing` |
| `practice.my_link` | `/dashboard/staff/team` |
| `practice.dashboard` | the dashboard itself |

### Service chats: delegated, but never anonymous

A channel is the one place where borrowing the practice's identity isn't
enough on its own. Access is a *participant row* and staff have none, so a
delegated request speaks through the doctor's row — which would make a
receptionist indistinguishable from the doctor to the patient reading it.

So the delegation is paired with attribution, and the pair is the feature:

| Who typed it | Marker on the bubble |
|---|---|
| The participant | *(none)* |
| A platform operator, via the Operations proxy | **Admin staff · <name>** |
| The practice's own staff | **Support staff · <name>** |

`_channel_user_id()` buys access to the conversation; `_on_behalf()` stamps the
real author. **Neither half is optional** — delegating without the stamp is the
thing that was originally declined.

`sent_on_behalf_kind` is *stored*, not derived from the author's current role:
a role can change, and that must not silently relabel what someone said months
ago. Rows predating the column read as `admin`, which is what they were —
nothing else could write it.

One serializer feeds the history GET, the POST response and the socket
broadcast, so the marker reaches everyone who reads the thread. Verified
through the patient's own read path, which is where it matters.

### The screens are the practice's own

`/dashboard/staff/doctors` mounts the very same `ManageDoctors` a clinic admin
sees. A forked "staff version" of each screen would drift within a release.

One exception: a facility's Entity Details lives inside the *doctor profile
page*, which fetches a doctor id and a doctor's analytics config — mounting that
for a receptionist asks the server for a doctor who does not exist. There the
section is mounted directly. Same component, without the page hosting it.

### Controls are asked for, not assumed

`useProviderCan()` short-circuits to `true` for an owner (no round trip) and
consults grants otherwise. Asha reads the network inbox and gets a **"View
only"** chip where the admin gets Accept/Reject. This governs what is *offered*;
the endpoint is what *allows*.

---

## 5. Known limitations

- **OTP login is unreachable for staff.** `users._phone_hash` is `NOT NULL`, so
  staff without a mobile get a synthetic `0000…` placeholder that no SMS can
  reach. Email + password works.
- **`entity_profile.verification` has no surface anywhere**, for any role.
- **Data ranges are stored but not applied.** A grant carries `data_range`
  (`ALL`, `LAST_30_DAYS`, …); it is displayed, and nothing filters a query by it
  yet. This is the largest remaining gap: a role that says "last 30 days" is
  today a role that says "all of it".
- **Grants are per-module, not per-record.** A staff member granted
  `practice.patients` sees every one of the doctor's patients, not a subset.
- **`current_user.id` still means "the actor"** inside delegated handlers, which
  is correct for audit columns (`submitted_by_id` and friends record the
  assistant, not the doctor) — but it means any *new* code that resolves a
  provider from `current_user.id` will silently break for staff. Resolve
  through `acting_doctor()` / `acting_user()`.

---

## 6. Test accounts

All passwords `Staff@1234`. Sign in at **`/auth/service-provider/login`** — the
same door their practice uses.

| Login | Person | Practice | Holds |
|---|---|---|---|
| `asha.frontdesk@seed.test` | Asha Menon | City Care Clinic LLP | 7 modules — roster, network requests, entity details *(+edit)*, account status, membership, verification, dashboard |
| `vikram.admin@seed.test` | Vikram Rao | My Hospital | 7 modules — roster + invitations *(+create/edit)*, network requests *(+edit)*, entity details, invoices, staff directory *(+create/edit, no delete)*, dashboard |
| `neha.assistant@seed.test` | Neha Iyer | Dr Doctor20 Platform | 12 modules across all four groups — working hours *(+edit)*, personal details, consultations, appointment requests *(+edit)*, prescriptions, patients, network, affiliations, membership, my link, dashboard, and service chats *(withheld)* |

Practice owners, for comparing the same screen: `corp.clinic@seed.test` /
`corp.hospital@seed.test`, password `Demo@1234`. Admin:
`owner@platform.test` / `Owner@1234`.

Data created while verifying (left in place deliberately): Anish Doctor →
City Care roster, Ankita Doctor → larazen clinic roster, one pending network
request to City Care, City Care's trade name set to "Front Desk Wrote This",
and four extra grants on the Front Desk role.

---

## 7. Where things live

**Backend**
- `app/common/provider_access.py` — principal resolution, the decorator, the prefix gate, `delegated_user`, `acting_doctor`
- `app/api/service_provider/doctor/staff_access.py` — **the doctor rule table**
- `app/models/provider_staff.py` — `ProviderStaff`, `ProviderRole`, `ProviderRolePermission`, `ProviderStaffRole`
- `app/api/admin/provider_rbac/` — module catalog, services, admin routes
- `app/api/provider_staff/routes.py` — a practice managing its own staff
- `app/api/staff/routes.py` — `GET /api/staff/me`, change password
- `app/common/staff_credentials.py` — minting and revoking staff logins

**Frontend**
- `src/features/staff/constants/staffModules.js` — **the module→screen map**
- `src/features/staff/hooks/useStaffAccess.js` — `/me` shaped into groups, grants, screens
- `src/features/staff/hooks/useProviderCan.js` — "may this viewer do X", owner or staff
- `src/features/staff/pages/` — dashboard, team, roles, practice, billing
- `src/features/service-provider/MyLink/` — the practice's own staff + roles tabs
- `src/features/admin/Operations/permissions/` — the admin matrix
