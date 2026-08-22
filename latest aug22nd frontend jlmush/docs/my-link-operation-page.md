# My Link — the Operation Page

A clinic or hospital running a doctor it is linked to, with the breadth of
control decided by the **relationship the doctor declared**, not by a role
somebody configured.

---

## 1. Why the relationship is the permission

Support staff (see [provider-staff-rbac.md](provider-staff-rbac.md)) needed a
roles table because "receptionist" is not a fact the platform knows — somebody
has to say what she may touch. A My Link affiliation is different. The doctor
already stated the relationship when they connected, and Partner / Associate /
**Employee** is exactly the sentence *"here is how much of my practice this
facility runs"*. There is nothing left to configure.

That makes consent the load-bearing part, and it holds today:
`relationship_type` is written by the **doctor**. Every path that sets it —
`DoctorNetworkService.send_request`, `generate_invite` — is on the doctor-side
blueprint, and the facility's only move is to accept or reject the request as
sent. **A clinic cannot promote itself to Employee over a doctor who didn't
offer it.** If that ever stops being true, the authority here evaporates and
the ladder has to be re-grounded in something the doctor still controls.

---

## 2. The ladder

A matrix, not a list: each relationship has an access level per **section** of
the doctor's practice. The shipped defaults:

| | Profile & Schedule | Appointments | Services & Availability | Prescriptions & Documents | Service Chats |
|---|---|---|---|---|---|
| **Partner** | View only | View only | — | — | — |
| **Associate** | — | View & manage | View & manage | — | — |
| **Employee** | View & manage | View & manage | View & manage | View & manage | View & manage |

`view` is enforced by intersecting that section's methods with
`GET/HEAD/OPTIONS`, not by hand-writing a second GET-only allowlist — a
hand-written copy is a place for a stray `PUT` to survive a rename. A pattern
left with no verbs (`profile/image` is POST-only) drops out entirely.

### Changing it

**Operations → Manage Roles & Permissions → any vertical → My Link
Relationships.** One matrix per tenant; it reads the same on all three
verticals because a relationship is between a doctor and a facility and there
is nothing to key it by. `SUPER_ADMIN` / `SUB_ADMIN` with `operations_doctor`.

Only cells that differ from the shipped default are stored
(`link_relationship_policies`), so the table above is what an untouched tenant
gets, "what did this tenant change?" is answerable by looking at the rows, and
a later change to the defaults still reaches everyone who hadn't opted out.
Changes take effect on the next request — the matrix is resolved per request
and cached on `g`, never at import.

**The exclusions are not configurable, and that is structural.** A cell picks
an access level for a section; it cannot name an endpoint. Bank accounts,
payouts and joining a live call are on no section's path list, so no
combination of settings can produce them. That is why this is a matrix over
sections rather than a permission editor over routes.

`read_only` is derived, not stored: a relationship is read-only when nothing it
holds can be written. It stays true however the cells are configured, instead
of being a second fact to keep in step.

### What "almost everything" excludes, at every tier

- **Bank accounts and payouts.** `doctor/profile/bank-accounts*` and
  `doctor/payouts*` appear on no tier, and the Bank Details sub-tab is hidden.
  Where a doctor's money lands is not an operational detail an employer settles
  — and this is the line that most needs to hold, because the whole feature is
  an employer acting under the doctor's name.
- **Joining a live consultation.** Same line the admin proxy already draws:
  turning up to a patient's video call is the doctor personally being present.
- **Analytics and Attendance.** Not a policy decision so much as an unanswered
  one — those endpoints take the doctor as a path parameter and admit an admin
  or the doctor, so they were never proxied. Whether an employer should see a
  doctor's own performance metrics deserves an answer before they are.

---

## 3. How it works

### One machine, two authorities

The `current_user` swap and the re-dispatch moved to `app/common/act_as.py`.
The admin Operations proxy and this one share it; they share nothing else. Each
owns its own answer to *who may do this* — the admin desk asks an RBAC
permission, this asks what relationship the doctor recorded — and its own
allowlist. A path unsafe for a platform operator is unsafe here; the reverse
does not hold, which is why the two lists are separate rather than one filtered
from the other.

`source` ('ops' | 'link') is tracked separately from `kind` ('doctor' |
'patient' | …) precisely so they can't be confused. Code that widens behaviour
for platform support asks for the **source**: `/api/patient` relaxes an OTP gate
for the admin proxy, and a clinic must not inherit that by virtue of also being
"a proxy".

### Both checks, independently

1. **May this caller act for the facility?** `@provider_access` — the owner
   passes by construction; their staff need `doctors_network.linked_doctors`.
   A view-only grant reads and cannot write (non-GET is re-checked against
   `can_edit`).
2. **May the facility act on this doctor?** An active `context='link'`
   connection between them, whose `relationship_type` maps to a tier holding
   the requested path.

Neither subsumes the other: the first is about the person, the second about the
two organisations. A doctor who exists but isn't linked 404s exactly like one
who doesn't exist — otherwise a facility could enumerate the tenant's doctors.

### One screen, read from either end

There is no facility-only tab. `ConnectionManager` — the same component that
renders the doctor's Affiliations — serves its **Individual** tab from
`/api/facility/link/doctors` when the viewer is a facility, and puts the
Operation Page and Delink on those rows. "The clinics I'm affiliated with" and
"the doctors affiliated with me" are one list seen from two sides; a separate
tab would teach people that My Link means something different depending on who
signed in.

A facility gets no Connect / Invite / Join / Discover controls, and they are
absent rather than disabled: every path that creates one of these rows is on
the doctor's blueprint, so there is nothing a facility could do to earn them.
Its Hospital and Clinic tabs are always empty for the same reason.

### It's a dialog on a real route

`/dashboard/<vertical>/my-link/operate/:doctorId/*`. It looks like a modal and
closes back to the list, but the URL is load-bearing: half the doctor profile
predates RTK Query and those thunks read their scope from `window.location` at
request time. A modal held in state has no URL, so every one of those sections
would call `/api/doctor/...` as the clinic and 403. Closing navigates back,
which is also what un-scopes them.

### Everything written is attributed

- **Profile edits go to the doctor's field-approval queue**, not straight in.
  The facility owner has no `admin_profile`, so `profile_audit`'s
  self-approve check fails closed — the doctor reviews and can reject.
- **Every non-GET writes an `OperationsAuditLog` row** naming the facility, the
  doctor, the path and the relationship it was done under.
- **Chat messages are stamped `employer`** and render **"Employer · <name>"**.
  Three author kinds now share one thread: `admin` → "Admin staff",
  `staff` → "Support staff", `employer` → "Employer". Stored, not derived from
  the sender's current role, so a relationship ending can't relabel what was
  said.

---

## 4. Delinking

Consent to *start* is not consent to *continue*, so either party can end the
affiliation alone and neither needs the other's agreement to do it.

| Who | Where | Endpoint |
|---|---|---|
| The doctor | My Link → Affiliations → Clinic → **Delink** | `DELETE /api/doctor/network/connections/<id>` |
| The facility | My Link → Affiliations → Individual → **Delink** | `DELETE /api/facility/link/doctors/<doctor_id>` |

**The doctor's button is the revocation.** A My Link relationship is what lets
a clinic operate their practice; until this existed there was consent to start
that and no way to withdraw it, and revoking meant asking an admin.

**It bites immediately and cannot be undone from the facility's side.** The
proxy resolves against the connection on every request, so the moment it stops
being active the facility's next call 404s — reads, writes, the tab strip, all
of it. And every path that *creates* a My Link row runs on the doctor's
blueprint, so a facility can drop a doctor but can never re-add one. A doctor
who delinks stays delinked until they choose otherwise.

Two details worth knowing:

- **Doctor↔doctor links drop both directions.** Those are a reciprocal pair
  (`_link_doctors`), so removing only the caller's row would leave the other
  party still listing them — each side would get a different answer to whether
  they are connected.
- **It is a soft delete** (`status='removed'`). Every read already filters on
  `status='active'`, the history survives, and re-linking works because
  `_ensure_connection` finds the row and flips it back rather than tripping the
  unique constraint.

Deleting is scoped to rows the caller is a party to — a doctor gets 404 on
someone else's row, and a facility gets 404 for a doctor it isn't linked to.
The doctor's route additionally re-checks the module by **context**: the
endpoint serves both My Network and My Link, and a staff member granted
"My Network" must not thereby be able to end the practice's employment
affiliations.

---

## 5. Known gaps

- **A facility's Hospital and Clinic tabs are always empty.** Connections are
  stored doctor-side, so a facility is only ever the target of a doctor's row —
  it can have practitioners and nothing else. The tabs stay in the strip with
  an honest empty state rather than being hidden, because the entity strip is
  what makes the two ends of My Link recognisably the same screen.
- **Nobody is told they were delinked.** No notification either way; the other
  side finds out by looking. For the doctor severing an employer that is fine,
  arguably preferable. For a facility dropping a doctor it is not.
- **The approval queue credits the doctor as submitter.** The field-approval
  row records the swapped `current_user`; only the ops audit row names the
  clinic. Same as the admin proxy, and worth fixing in both at once rather than
  diverging.
- **Grants are per-relationship, not per-record.** An Employee-linked facility
  sees all of that doctor's patients and prescriptions, not a subset.

---

## 6. Where things live

**Backend**
- `app/common/act_as.py` — the swap, the re-dispatch, `source` vs `kind`
- `app/api/provider_link/authority.py` — **the ladder** (defaults + resolution)
- `app/models/care_network.py` — `LinkRelationshipPolicy`, the admin overrides
- `app/api/admin/provider_rbac/link_policy_routes.py` — the admin API
- `app/api/provider_link/routes.py` — the facility's linked-doctor list + proxy
- `app/api/admin/operations/act_on_behalf.py` — the admin proxy, now a caller

**Frontend**
- `src/features/service-provider/api/doctorScope.js` — scope tokens, both proxies
- `src/features/service-provider/MyLink/components/LinkOperationDialog.jsx`
- `src/features/service-provider/MyLink/components/LinkedDoctorsSection.jsx`
- `src/features/service-provider/MyLink/api/providerLinkEndpoints.js`
- `src/features/service-provider/MyNetwork/components/ConnectionManager.jsx` —
  both ends of My Link, the Operation Page entry and Delink
- `src/features/admin/Operations/permissions/components/LinkRelationshipPanel/` —
  the admin matrix
