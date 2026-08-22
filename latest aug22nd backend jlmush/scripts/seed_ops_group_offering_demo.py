"""Seed a plan TEAM + plan BOOKINGS on the default tenant so the doctor's
"My Group Offering" bucket has something in it.

Why this exists
---------------
The bucket lists plan bookings on teams the doctor LEADS, across their
lifecycle, and offers Accept / Reject on the ``pending_acceptance`` ones. On a
fresh dev database ``group_offering_bookings`` is empty, so the panel renders
its empty state and neither the doctor's own page nor the Operations copy of it
can actually be exercised — the accept path in particular, which opens the
team's chat channels and writes the payout rows.

Unlike ``reseed_group_offering_demo.py`` (a generic row snapshot of whatever
happened to exist, captured from a tenant that no longer has matching doctors),
this builds the graph from scratch against real rows on THIS database, through
the ORM, so the FKs and the shapes the accept path reads are correct by
construction.

What it creates (idempotent — re-running updates in place, never duplicates):

    MarketplaceServiceGroup            one team, approved + active, fulfilling
      ├─ member: LEAD  (accepted)      an existing published GroupOffering
      │    └─ 2 payout installments
      ├─ member: co-doctor (accepted)
      │    └─ 1 payout installment
      └─ GroupOfferingBooking × 3      one per lifecycle bucket, each with a
                                       paid booking installment

The three bookings sit in ``pending_acceptance`` / ``active`` / ``completed``
so every tab of the panel has a row and the To Review one still has its
Accept + Reject buttons live.

Usage (inside the backend container):

    docker compose exec backend python scripts/seed_ops_group_offering_demo.py

Pass ``--reset`` to delete the seeded team + bookings instead.
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import g  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models._base import set_tenant_context  # noqa: E402
from app.models import (  # noqa: E402
    Tenant, Doctor, Patient, User,
    GroupOffering, GroupOfferingMember,
    GroupOfferingBooking, GroupOfferingBookingInstallment,
    MarketplaceServiceGroup, MarketplaceServiceGroupMember,
    ServiceGroupMemberInstallment,
)

# Marker on the team's description — how a re-run finds what it made last time
# instead of creating a second identical team.
MARKER = '[ops-demo] '

# Who leads / joins. Resolved by name so the script survives a reseed that
# hands the same people new ids.
LEAD_NAME = ('Doctor20', 'Platform')
CO_NAME = ('Doctor01', 'Platform')

# One booking per lifecycle bucket the panel tabs on. 'pending_acceptance' is
# the one that matters — it's the only status Accept / Reject act on.
BOOKINGS = [
    ('pending_acceptance', ('Patient01', 'Platform')),
    ('active', ('Patient02', 'Platform')),
    ('completed', ('Patient04', 'Platform')),
]


def _doctor_by_name(tenant_id, first, last):
    return (
        Doctor.query.join(User, User.id == Doctor.user_id)
        .filter(Doctor.tenant_id == tenant_id,
                User.first_name == first, User.last_name == last)
        .first()
    )


def _patient_by_name(tenant_id, first, last):
    return (
        Patient.query.join(User, User.id == Patient.user_id)
        .filter(Patient.tenant_id == tenant_id,
                User.first_name == first, User.last_name == last)
        .first()
    )


def _require(value, what):
    if value is None:
        raise SystemExit(f'seed aborted — no {what} on this database')
    return value


def reset(tenant):
    """Undo a previous run."""
    teams = MarketplaceServiceGroup.query.filter(
        MarketplaceServiceGroup.tenant_id == tenant.id,
        MarketplaceServiceGroup.group_description.like(f'{MARKER}%'),
    ).all()
    for team in teams:
        # Bookings FK to the team with ON DELETE SET NULL, which would leave
        # orphans in the list rather than removing them. Drop them explicitly.
        GroupOfferingBooking.query.filter_by(
            tenant_id=tenant.id, team_id=team.id,
        ).delete(synchronize_session=False)
        db.session.delete(team)
    db.session.commit()
    print(f'removed {len(teams)} seeded team(s) and their bookings')


def seed(tenant):
    lead = _require(_doctor_by_name(tenant.id, *LEAD_NAME), f'doctor {LEAD_NAME}')
    co = _require(_doctor_by_name(tenant.id, *CO_NAME), f'doctor {CO_NAME}')

    # Which plan to hang the team off. Two rules, in order:
    #
    #  1. If a previous run's team is still here, reuse ITS plan. Re-deriving
    #     would silently re-point the fixture whenever the plan catalog
    #     changes — a dev deleting one plan and adding another moved these
    #     bookings from a ₹5000 plan to a ₹10 one between two runs, and left
    #     an orphan team behind. (A deleted plan takes its team with it:
    #     ``marketplace_service_groups.group_offering_id`` is ON DELETE
    #     CASCADE. So "still here" is a real signal, not a stale one.)
    #  2. Otherwise pick the richest published plan, not the oldest — the
    #     doctor budget is what the payout installments divide, and a ₹0
    #     or ₹2 plan makes the money side of the fixture meaningless.
    existing = (
        MarketplaceServiceGroup.query
        .filter(MarketplaceServiceGroup.tenant_id == tenant.id,
                MarketplaceServiceGroup.group_description.like(f'{MARKER}%'),
                MarketplaceServiceGroup.group_offering_id.isnot(None))
        .first()
    )
    offering = None
    if existing is not None:
        offering = GroupOffering.query.filter_by(
            tenant_id=tenant.id, id=existing.group_offering_id, is_deleted=False,
        ).first()
    offering = _require(
        offering or (
            GroupOffering.query.filter_by(
                tenant_id=tenant.id, status='published', is_deleted=False,
            ).order_by(GroupOffering.doctor_budget.desc().nullslast(),
                       GroupOffering.created_at).first()
        ),
        'published group offering',
    )
    slot = GroupOfferingMember.query.filter_by(
        tenant_id=tenant.id, offering_id=offering.id,
    ).order_by(GroupOfferingMember.sort_order).first()

    price = float(offering.patient_price or 0)
    budget = float(offering.doctor_budget or 0) or price / 2
    # Split the plan's doctor budget across the two members. The lead's share
    # is percentage-based and the co-doctor's fixed, so the payout generator
    # exercises both branches of ``resolved_amount``.
    lead_fee = round(budget * 0.6, 2)
    co_fee = round(budget - lead_fee, 2)

    description = f'{MARKER}{offering.name} — {lead.full_name} + {co.full_name}'
    team = MarketplaceServiceGroup.query.filter_by(
        tenant_id=tenant.id, group_offering_id=offering.id,
        created_by_doctor_id=lead.id,
    ).filter(MarketplaceServiceGroup.group_description.like(f'{MARKER}%')).first()
    if team is None:
        team = MarketplaceServiceGroup(
            tenant_id=tenant.id,
            group_offering_id=offering.id,
            created_by_doctor_id=lead.id,
            group_price=price,
            group_description=description,
        )
        db.session.add(team)
        db.session.flush()
    team.group_description = description
    team.group_price = price
    # Approved + active is what makes it bookable; the accept path also
    # backfills ``product_id`` itself when it opens the channels.
    team.approval_status = 'approved'
    team.is_active = True

    now = datetime.now(timezone.utc)
    for doctor, role, fee, installments in (
        (lead, 'lead', lead_fee,
         [dict(installment_no=1, payment_type='percentage', percentage=50,
               period_label='On completion', due_after_days=0),
          dict(installment_no=2, payment_type='percentage', percentage=50,
               period_label='After 30 days', due_after_days=30)]),
        (co, 'member', co_fee,
         [dict(installment_no=1, payment_type='fixed', amount=co_fee,
               period_label='On completion', due_after_days=0)]),
    ):
        member = MarketplaceServiceGroupMember.query.filter_by(
            tenant_id=tenant.id, group_id=team.id, doctor_id=doctor.id,
        ).first()
        if member is None:
            member = MarketplaceServiceGroupMember(
                tenant_id=tenant.id, group_id=team.id, doctor_id=doctor.id,
            )
            db.session.add(member)
            db.session.flush()
        member.role = role
        # Both accepted: an invitation still pending would keep the team out of
        # the bookable set, and the payout generator skips non-accepted members.
        member.status = 'accepted'
        member.responded_at = now
        member.group_offering_member_id = slot.id if slot else None
        member.allocated_fee = fee

        for spec in installments:
            inst = ServiceGroupMemberInstallment.query.filter_by(
                tenant_id=tenant.id, member_id=member.id,
                installment_no=spec['installment_no'],
            ).first()
            if inst is None:
                inst = ServiceGroupMemberInstallment(
                    tenant_id=tenant.id, member_id=member.id,
                    installment_no=spec['installment_no'],
                )
                db.session.add(inst)
            inst.payment_type = spec['payment_type']
            inst.amount = spec.get('amount')
            inst.percentage = spec.get('percentage')
            inst.period_label = spec['period_label']
            inst.due_after_days = spec['due_after_days']

    made = []
    for status, patient_name in BOOKINGS:
        patient = _patient_by_name(tenant.id, *patient_name)
        if patient is None:
            print(f'  skipped {status}: no patient {patient_name}')
            continue
        booking = GroupOfferingBooking.query.filter_by(
            tenant_id=tenant.id, team_id=team.id, patient_id=patient.id,
        ).first()
        if booking is None:
            booking = GroupOfferingBooking(
                tenant_id=tenant.id, team_id=team.id, patient_id=patient.id,
                offering_id=offering.id,
            )
            db.session.add(booking)
            db.session.flush()
        booking.plan_name = offering.name
        booking.plan_price = price
        booking.tax_mode = 'none'
        booking.tax_amount = 0
        booking.total_payable = price
        booking.status = status

        # The lead only ever sees PAID bookings, so the money has to have
        # landed — an unpaid one would be filtered out of the list entirely.
        inst = GroupOfferingBookingInstallment.query.filter_by(
            tenant_id=tenant.id, booking_id=booking.id, installment_no=1,
        ).first()
        if inst is None:
            inst = GroupOfferingBookingInstallment(
                tenant_id=tenant.id, booking_id=booking.id, installment_no=1,
            )
            db.session.add(inst)
        inst.amount = price
        inst.due_after_days = 0
        inst.due_label = 'Full payment'
        inst.is_booking = True
        inst.status = 'paid'
        inst.paid_at = now
        made.append((status, patient.full_name))

    db.session.commit()

    print(f'team   {team.id}  "{team.group_description}"')
    print(f'  lead {lead.full_name} (₹{lead_fee}) + {co.full_name} (₹{co_fee})')
    for status, who in made:
        print(f'  booking [{status:20}] {who}')


if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        tenant = Tenant.query.filter_by(is_default=True).first()
        if tenant is None:
            raise SystemExit('no default tenant')
        g.tenant_id = tenant.id
        set_tenant_context(db.session, tenant.id)
        if '--reset' in sys.argv:
            reset(tenant)
        else:
            seed(tenant)
