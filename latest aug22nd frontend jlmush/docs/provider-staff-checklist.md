# Staff RBAC — minimal check

24 checks. Everything is seeded; nothing to set up.
Sign in at **`/auth/service-provider/login`**. All staff passwords `Staff@1234`.

Checks **1–12** cover support staff (roles a practice grants). Checks
**13–18** cover the My Link Operation Page, where control comes from the
relationship a doctor declared instead — a different mechanism reached from a
different screen. Checks **19–21** are how that control is withdrawn, and
**22–24** are where an administrator defines what each relationship means.

---

### A. It works at all — `asha.frontdesk@seed.test`

**1.** Lands on `/dashboard/staff`, sidebar shows **Manage Doctors, Network
Requests, Practice Profile, Billing**.

**2.** Click **Manage Doctors** → Current (1) → **Anish Doctor**.
*This is the check. It was a 403 before.*

**3.** No **"Add doctor"** button. She has view, not create.

**4.** Click **Network Requests** → a request row with a **"View only"** chip
and no Accept/Reject.

**5.** **Practice Profile** → **City Care Clinic LLP**'s real GST / PAN / CIN.
Two tabs: Entity Details, Account Status.

---

### B. It's her employer's data, not everyone's

**6.** She sees **Anish** and never **Ankita Doctor** — Ankita is on larazen
clinic's roster. Same screen, different practice, correctly scoped.

**7.** Go to `/dashboard/staff/team` directly → **"You don't have access to this
screen."** She has no staff-directory grant.

---

### C. The practice still works — `corp.clinic@seed.test` / `Demo@1234`

**8.** `/dashboard/clinic/doctors` → **"Add doctor"** IS there, same Anish.
`/dashboard/clinic/network-requests` → **Accept / Reject** ARE there.
*Same screens, same endpoints — the owner's path must be unchanged.*

**9.** My Link → **Support Staff** → "Add staff member" opens a form with a
**Sign-in access** box and a **Roles** picker. My Link → **Roles** → **New**
button present.

---

### D. Grants differ per person — `vikram.admin@seed.test`

**10.** Sidebar has **Staff Directory** (Asha's doesn't). Open it: **"Add staff
member"** is there, but the Actions column has **only an edit pencil, no
delete** — he has create and edit, not delete. And `/dashboard/staff/roles`
refuses him.

---

### E. The doctor vertical — `neha.assistant@seed.test`

**11.** Sidebar shows **Profile & Schedule, Appointments & Services, Manage
Services, Prescriptions & Documents, My Patients, My Network, Hospital
Affiliations, Billing & Membership, Support Staff**. Open **Profile & Schedule**
— the tabs are **Profile Details and Working Hours only**, not the eight a
doctor sees. Each tab is its own grant.
`/dashboard/staff/plan-teams` refuses her.

**12.** **Service Chats** → open the **Patient01 Platform** thread. Send a
message. Your bubble is tagged **"Support staff · Neha Iyer"**; the two older
ones are tagged **"Admin staff · Owner Platform"**. That marker is the
condition on which staff get into these threads at all — the patient must be
able to see it wasn't their doctor typing.

---

### F. My Link Operation Page — `corp.clinic@seed.test` / `Demo@1234`

*A different mechanism from A–E: control here comes from the relationship the
doctor declared, not from a role anyone configured. See
[my-link-operation-page.md](my-link-operation-page.md).*

**13.** **My Link → Affiliations → Individual** lists four doctors — the same
tab a doctor uses for their own affiliations, read from the other end. The
Relationship column differs per row: **susmitha sirigala** is *Partner* with a
**View only** chip; **susmitha doctor** is *Associate*; **Anish Doctor** and
**Doctor20 Platform** are *Employee*. Each row has an **Operation Page**
button; hovering it says which sections it opens.

**14.** **Anish Doctor → Operation Page.** A full-screen dialog over the list.
Five tabs; Profile & Schedule shows **Anish's** details (Reg. MCI-1235), not
the clinic's. **Close** returns to the list.
*Inside Profile Details there is no **Bank Details** sub-tab, and no
**Analytics** or **Attendance** top-tab. Those are the deliberate exclusions.*

**15.** **susmitha sirigala (Partner) → Operation Page.** Two tabs, a blue
"read-only" banner, and **no Save button anywhere**. Every field is greyed out.

**16.** **Doctor20 Platform → Operation Page → Service Chats →** the
**Patient01 Platform** thread. Send a message. It's tagged **"Employer ·
CityCare"**, alongside **"Admin staff · Owner Platform"** and **"Support staff
· Neha Iyer"** on the older ones. *Three different authorities in one thread,
each named.*

**17.** Still as the clinic, in the console:

```js
const t = localStorage.getItem('auth.access_token');
const hit = (u, m = 'GET') => fetch('http://localhost:5000' + u,
  { method: m, headers: { Authorization: `Bearer ${t}` } }).then(r => r.status);
const A = '1666b8cd-8a5d-4215-a04e-a2a2d72b3937';   // Anish  — Employee
const P = '39722a8c-98fc-437c-9406-3e8e62816c13';   // susmitha sirigala — Partner
const act = (id, p) => `/api/facility/link/doctors/${id}/act/${p}`;

await hit(act(A, 'doctor/profile'));                 // 200 — Employee holds profile
await hit(act(A, 'doctor/profile/bank-accounts'));   // 403 — no tier, ever
await hit(act(A, 'doctor/payouts'));                 // 403 — no tier, ever
await hit(act(P, 'doctor/profile'));                 // 200 — Partner may read
await hit(act(P, 'doctor/profile'), 'PUT');          // 403 — Partner may not write
await hit(act(P, 'doctor/prescriptions'));           // 403 — not in a Partner relationship
await hit(act('00000000-0000-0000-0000-000000000001', 'doctor/profile')); // 404 — not linked
```

**18.** **The admin side is unchanged** — `owner@platform.test` / `Owner@1234` →
`/dashboard/admin/operations` → any verified doctor. All six tabs render,
**Analytics included**, and Bank Details IS there. *The two proxies share one
machine and nothing else; an admin reaches paths no relationship does.*

### G. Delinking — the doctor can revoke it

**19.** Sign in as **`anish.doctor@seed.test` / `Doctor@1234`** →
`/dashboard/doctor/my-link` → **Clinic** tab. One row: **City Care Clinic LLP ·
Employee**, with a **Delink** button. Click it — the confirm says *"delinking
immediately ends their access to your practice through their Operation Page.
They cannot re-add you."* Confirm.

**20.** Sign back in as the clinic. **Anish is gone from the Individual tab**,
and in the console:

```js
await hit(act('1666b8cd-8a5d-4215-a04e-a2a2d72b3937', 'doctor/profile'));  // 404
```
*Not 403 — the connection is what the proxy resolves against, so there is
nothing left to refuse.*
**Put it back** by re-sending the affiliation from Anish's My Link (Clinic tab
→ Add Clinic → Employee) and accepting it as the clinic under Network
Requests — the checklist above expects him linked.

**21.** The facility's half: as the clinic, **Affiliations → Individual →
Delink** on any row. The confirm names the exact sections being given up.
Afterwards that doctor is gone from the list and the clinic *cannot add them
back* — only the doctor can send the affiliation again.

### H. Admins define what the relationships mean

**22.** `owner@platform.test` → **Operations → Manage Roles & Permissions →
Doctor → My Link Relationships**. A 3 × 5 grid: Partner / Associate / Employee
against the five sections, each cell **No access / View only / View & manage**.
The same tab and the same grid appear under Clinic and Hospital — one matrix
for the tenant.

**23.** Set **Employee → Prescriptions & Documents** to **No access** and
**Employee → Profile & Schedule** to **View only**. Save. Now, as the clinic
(no re-login needed):

```js
await hit(act(A, 'doctor/prescriptions'));           // 403 — the section is off
await hit(act(A, 'doctor/profile'));                 // 200 — still readable
await hit(act(A, 'doctor/profile'), 'PUT');          // 403 — view only now
await hit(act(A, 'doctor/profile/bank-accounts'));   // 403 — STILL, and not settable
```
And Anish's Operation Page has lost its Prescriptions tab.
*The last line is the point: a cell picks an access level for a section, never
an endpoint, so nothing an operator can tick reaches the exclusions.*

**24.** Back on the admin grid, **Reset to shipped defaults** → **Save**.
Everything in checks 13–18 behaves as written again. *Cells matching the
default aren't stored, so this empties the table rather than filling it.*

---

## Expected to look "wrong" but isn't

| You'll see | Why |
|---|---|
| Three different markers in one chat thread | Correct — a platform operator ("Admin staff"), the practice's own staff ("Support staff"), and the clinic that employs the doctor ("Employer") |
| The clinic's **Hospital** and **Clinic** entity tabs are empty | Connections are stored doctor-side, so a facility is only ever the target of a doctor's row. It can have practitioners and nothing else |
| The clinic has no **Send Request** / **Generate Invite** / **Join by Code** buttons | Every path that creates a My Link row is on the doctor's blueprint. Doctors affiliate themselves with a facility, never the reverse |
| A Partner's Operation Page has no Save button at all | The relationship is read-only. The server refuses the writes too; the missing button is so nobody is invited to try |
| `entity_profile.verification` says **"Not built for anyone yet"** | No screen exists for the practice either |
| Billing → Bills is a placeholder *(facilities only)* | The practice sees the same placeholder. A doctor gets a real bills page |
| Asha's sidebar shows both "Practice Profile" and "Also granted → Clinic Profile" | The group has one leaf (verification) with no screen, so it's still listed as described-only |
| The clinic owner's `/api/membership/me` returns **404** | City Care has no subscription. 404 is this endpoint's "not a member" |

## If you want to see it refuse from the API

Signed in as Asha, in the browser console:

```js
const t = localStorage.getItem('auth.access_token');
const hit = (u, m = 'GET') => fetch('http://localhost:5000' + u,
  { method: m, headers: { Authorization: `Bearer ${t}` } }).then(r => r.status);

await hit('/api/affiliation/facility/doctors');              // 200  — granted
await hit('/api/provider-staff');                            // 403  — no directory grant
await hit('/api/provider-staff/roles', 'POST');              // 403  — never, for any staff
await hit('/api/facility/network/requests/<id>/reject','POST'); // 403 — view, not edit
await hit('/api/doctor/profile');                            // 403  — wrong vertical
```

Or as **Neha**, which exercises the doctor prefix gate:

```js
await hit('/api/doctor/schedule');            // 200  — holds working_hours
await hit('/api/doctor/prescriptions');       // 200  — holds prescriptions
await hit('/api/doctor/profile/bank-accounts');  // 403 — no bank_details grant
await hit('/api/doctor/payouts');                // 403 — no practice.billing
await hit('/api/service-communication/channels'); // 200 — and these are the DOCTOR's
```
