# Group Offering — Demo Walkthrough

A presenter's script for demoing the multidisciplinary **Group Offering** feature
(admin-authored plan → team of doctors → patient booking → shared care channels →
completion documents → doctor payouts).

---

## Credentials

Log in at the tenant host **`localhost`**. Password for all seeded accounts below
is `Demo@1234` (the platform owner differs).

| Role | Login | Password |
|---|---|---|
| Super Admin | `super_admin01@platform-seed.test` … `05@…` | `Demo@1234` |
| Doctor | `doctor01@platform-seed.test` … `doctor05@…` | `Demo@1234` |
| Patient | `patient01@platform-seed.test` … | `Demo@1234` |
| Platform Owner | `owner@platform-seed.test` | `Owner@1234` |

> **Session cap** is 5 per account. If login says "Maximum 5 sessions", switch to a
> different NN (e.g. `doctor02`).

---

## Seeded demo data

- **"Heart & Wellness 90-Day Plan"** — published; team **Doctor01 + Doctor05**
  (approved); an **active booking by Patient03** with no documents yet, ready for a
  live completion-document demo; group chat seeded with messages.
- **"Longevity Team Plan"** — a **completed** booking, to show the finished state.

If the Docker volume is ever wiped, restore this scaffolding with:

```bash
docker compose exec backend python scripts/reseed_group_offering_demo.py
```

(Chat messages and completion documents are runtime artefacts — recreate them by
driving the flow below.)

---

## Presentation flow

Route prefixes: admin `/dashboard/admin/*`, doctor `/dashboard/doctor/*`,
patient `/dashboard/patient/*`.

### 1. Admin builds the plan — `/dashboard/admin/group-offerings`
- **Section 1:** name, **Category** (type a new one to create it), duration,
  patient price, and the plan's GST mode (CGST/SGST or IGST).
- **Section 2:** qualification slots — per slot set the fee, **Voice / Video / Chat
  toggles** (each optional), and consultation limits. Call-duration fields appear
  only for the modes you enable.
- Set the plan's **working hours**, then **Publish**.
- Open **Teams** → assemble a team (Doctor01 + Doctor05), set each doctor's fee and
  payout installments, and **Approve** the team.

### 2. Admin sets a service's terms — `/dashboard/admin/products`
- Services tab → edit a service → **"Service terms — fixed by admin"**: consultation
  limits and tax (GST). Point out the doctor cannot change these.

### 3. Doctor lists a service — Doctor → Services
- Add/edit a service: the doctor sets **only price + description**, with a note that
  the admin fixes the rest.

### 4. Doctor accepts the plan team — `/dashboard/doctor/plan-teams`
- The doctor sees **only their own fee + payout schedule** (never other members'),
  and accepts the invitation.

### 5. Patient books — `/dashboard/patient/health-plans`
- Pick the plan → choose a team → **pay the full price once** (there are no patient
  installments; installments are doctor-payout only).

### 6. Care delivery
- The group chat + per-doctor 1:1 channels open. Calls and chat are bounded by the
  plan's **working hours**.

### 7. Completion documents — **the shared approval flow** ⭐ (updated)

The completion document uses the **same DoctorDocument flow as marketplace-service
documents** — it is not a separate mechanism. It goes through admin approval before
the patient sees it, and the booking completes only when **every** team doctor has
delivered.

Per team doctor, on `/dashboard/doctor/plan-teams` (or from the **My Documents** hub):

1. **Upload document** (PDF) — or generate one from the document builder. It lands
   as a **Draft**.
2. **Submit for approval** → status becomes **Awaiting admin approval**.
3. **Admin approves** it — `/dashboard/admin/document-config` (Super/Sub Admin);
   status becomes **Approved**.
4. Doctor clicks **Push to patient** → status **Delivered** (ACTIVE). The patient can
   now see it.
5. When **both** Doctor01 and Doctor05 have pushed their documents, the booking flips
   to **Completed** automatically.

The document appears in the doctor's **My Documents** hub alongside service documents,
and the patient sees it on **Health Plans** and in their unified **Documents** list
(tagged as a group-offering document).

> Demo tip: have Doctor05 push first (booking stays *active*, 1 of 2), then Doctor01
> push to show the booking flip to *completed* live.

### 8. Payouts — `/dashboard/admin/payout-management`
- Plan installment payouts flow through the **same** claim / Cashfree lifecycle as
  service and appointment payouts, filterable by source type.

---

## Notes for the presenter

- Admin list tables (products, payouts) render reliably in a real Chrome; the
  in-app preview browser has a known RTK render quirk on list pages.
- The completion-document step now has an admin-approval gate (step 7) — this is
  deliberate: it is the **same** governed flow every doctor-authored patient
  document goes through.
