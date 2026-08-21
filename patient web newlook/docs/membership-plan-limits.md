# Membership plan limits — support staff and My Link

A membership tier can cap two things a member accumulates: how many **support
staff** they employ, and how many **My Link affiliations** they hold. Set per
plan under **Membership Plans → edit a plan → Plan limits**.

---

## 1. What the numbers mean

| Value | Meaning |
|---|---|
| blank | Unlimited |
| `0` | This tier grants none at all |
| `N` | Hard cap of N |
| `-1` | Accepted on the way in, stored as blank |

Two columns on `membership_plans` — `max_support_staff` and
`max_link_connections` — rather than keys inside `features`, for the same reason
`Plan.max_*` are columns: every staff-create and every link-accept runs a
count-vs-limit check.

**Blank means unlimited, not "not backfilled yet."** This is the opposite
reading from `Plan.max_provider_*`, deliberately. Those columns cap a tenant and
were introduced with a backfill step; these arrived on a table whose rows
already had subscribers, and reading an un-backfilled NULL as 0 would have taken
support staff away from every existing member on deploy.

`-1` normalises to NULL on write so "unlimited" has exactly one stored spelling.
A `CHECK` constraint blocks any other negative, for anything that skips the
route.

---

## 2. Three properties worth keeping

**No membership means no cap.** A provider without a PENDING / TRIAL / ACTIVE
subscription is unlimited. Most practices in dev are in exactly that state, and
reading "no plan" as "no staff" would make shipping this a mass revocation. A
cap is a property of a tier somebody bought.

**A cap refuses the next one; it never severs.** Usage is counted, never
enforced retroactively, so a member moved to a smaller tier — or one whose tier
is re-tuned under them — can sit legitimately over their limit. They keep
everything: the meter reads `5 / 1`, every existing affiliation still resolves,
every Operation Page still opens, and only *adding* is closed. Editing and
removing stay open, or an over-limit practice could never get back under.
Anything else would let an admin editing a plan silently delete another
practice's staff.

**One module answers both questions.** `app/api/membership/limits.py` owns the
ceiling and the count. The provider's meter, the button that greys out, and the
request that gets refused all read it. A meter computed separately would
eventually say 4 of 5 while the server said no, and the number on screen is what
people stop trusting.

---

## 3. My Link is counted on both ends

A My Link row is owned by the doctor and points at the facility, so the doctor
counts rows they own and a facility counts rows aimed at it. Doctor↔doctor links
are a reciprocal pair, so each doctor counts their own half.

Both ends are checked, because a link is one row that lands in two rosters:

| Moment | Whose cap |
|---|---|
| Doctor sends a request | the doctor's |
| …to a named facility | the facility's too, reported early rather than after a doomed wait |
| Doctor generates an invite code | the doctor's — refusing to mint a code that can't be redeemed |
| **Anyone accepts** | **both**, re-counted |
| Doctor joins by code | both |

Accepting matters most: every path that *creates* one of these rows is on the
doctor's blueprint, so a facility never adds a link — it only ever agrees to
one, and accept is the only moment its own ceiling can be reached. A request
refused on capacity stays `PENDING`; nothing is consumed.

Only `context='link'` is capped. My Network is the same table and a different
relationship, and capping referrals because someone bought a small affiliation
tier would be a surprise nobody asked for.

---

## 4. What a refusal looks like

`403` with `code: "plan_limit_exceeded"` and `data: {metric, limit, used,
plan_name}` — shaped like `feature_required`'s deny, so an upgrade prompt
doesn't have to parse English out of the message.

```
You have used all 1 My Link affiliations included on the Essential Care plan
(1 of 1). Upgrade the membership to add more.
```

When the ceiling isn't the caller's, it is named:

```
City Care Clinic LLP has used all 5 My Link affiliations included on the
Clinic Essential plan (5 of 5). Upgrade the membership to add more.
```

A doctor told only that "the limit" was reached would go looking at their own
plan. `PlanLimitExceeded` subclasses `ValueError` so a route that hasn't been
taught about limits still refuses politely with the message instead of 500ing.

---

## 5. Where the numbers show

**As features, derived — never authored.** `utils/planLimits.js` turns the two
columns into one sentence each and appends them to the plan card's bullets:
admin table, `/join`, the apex pricing grid, and the member's own tier card. The
pinned-number bullets in `fixedFeatures.js` bake their number into a stored
string at save time, which is fine for a commission; a cap is the thing being
enforced, and a card promising "5 support staff" while the server allows 3 is
worse than no card.

A tier that caps neither shows nothing rather than two "Unlimited" lines — the
absence of a limit is not a feature anyone shopped for.

**As meters, in the provider view.** `GET /api/membership/me/limits` returns
both, resolved through `current_principal` so a practice's staff see the
*practice's* capacity. My Link shows the count and closes Send Request /
Generate Invite / Join by Code at the cap; Support Staff shows the seats and
closes the add form. Uncapped practices see no meter at all.

---

## 6. Check it in five minutes

Signed in as `owner@platform.test` / `Owner@1234`:

**1.** **Membership Plans** → the **Limits** column reads "Up to 8 support
staff / Up to 5 My Link affiliations" on Clinic Essential and **—** on any
uncapped plan. Edit it: the **Plan limits** section shows both numbers.

**2.** As `corp.clinic@seed.test` / `Demo@1234` (City Care, on Clinic
Essential): **My Link → Support Staff** reads **8 / 8 staff seats used** and
has no "Add staff member" button; the 8 rows are all still there and still
removable. **Affiliations** reads **5 / 5 My Link affiliations used**.

**3.** In the console as the clinic:

```js
const t = localStorage.getItem('auth.access_token');
const hit = (u, m = 'GET', b) => fetch('http://localhost:5000' + u, {
  method: m,
  headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
  body: b && JSON.stringify(b),
}).then(async (r) => [r.status, await r.json()]);

await hit('/api/membership/me/limits');                    // both meters
await hit('/api/provider-staff', 'POST', { first_name: 'Over' });
// 403 plan_limit_exceeded — "used all 8 support staff … (8 of 8)"
```

**4.** As `susmitha.doctor@seed.test` / `Doctor@1234` (Essential Care, 1 My Link
affiliation, cap 1): **My Link** shows **1 / 1** and all three of Send Request,
Generate Invite and Join by Code are **disabled** — while **My Network** has no
meter and all three enabled. *Same component, different context; referrals
aren't capped.*

**5.** As `doctor19.platform@seed.test` / `Doctor@1234` (no subscription, so no
cap of her own), send a My Link request to City Care: refused, and the message
**names City Care**, not her.

---

## 7. Known gaps

- **Nobody is warned before a downgrade puts them over.** An admin can move a
  member to a smaller tier, or re-tune a tier, with no indication of who it
  strands over their cap. Safe — nothing is severed — but silent.
- **The cap counts rows, not seats in use.** Support staff counts every
  non-deleted row, matching what the directory lists, so an inactive staff
  member still occupies a seat. That is deliberate: a screen showing eight
  people above "4 of 8 used" reads as a bug however defensible the distinction
  is.
- **A plan's caps are not shown to the admin who assigns it.** Moving a
  subscriber between tiers on the roster doesn't display what each tier allows.
