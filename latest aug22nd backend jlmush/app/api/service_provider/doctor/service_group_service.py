"""
Group Service Offering service.

A lead doctor offers a catalog product together with co-doctors picked from
their care network (accepted doctor connections). The group requires admin
approval before patients can book it. Every member sees orders placed against
the group.
"""
from datetime import datetime, timezone

from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    DoctorProduct, MarketplaceServiceGroup, MarketplaceServiceGroupMember,
    CareNetworkConnection,
)


class ServiceGroupService:

    # ── Specialization coverage + status promotion (Item 3D) ──────────────
    @staticmethod
    def _member_specialization_ids(group):
        """All specialization category ids held by the group's ACCEPTED members."""
        from app.models import ProfileEducationSpecialization
        tid = current_tenant_id_strict()
        doc_ids = [m.doctor_id for m in group.members if m.status == 'accepted']
        if not doc_ids:
            return set()
        rows = ProfileEducationSpecialization.query.filter(
            ProfileEducationSpecialization.tenant_id == tid,
            ProfileEducationSpecialization.doctor_id.in_(doc_ids),
        ).all()
        return {str(r.category_id) for r in rows}

    @staticmethod
    def _specs_covered(group):
        req = group.required_specialization_ids or []
        if not req:
            return True
        held = ServiceGroupService._member_specialization_ids(group)
        return all(str(s) in held for s in req)

    @staticmethod
    def _refresh_status(group):
        """Promote awaiting_members → pending once every member has accepted AND
        the required specializations are covered. Leaves approved/rejected alone.

        A group built by a senior admin from Operations lands on ``approved``
        instead of ``pending`` — the submitter holds the approval right, so
        queuing it would only send them to a second screen. It still has to
        clear ``awaiting_members`` first: an admin acting for the lead doctor
        cannot accept on the *co-doctors'* behalf, and approving a group whose
        members haven't agreed to be in it would make them bookable for work
        they never took on.
        """
        if group.approval_status in ('approved', 'rejected'):
            return
        all_accepted = all(m.status == 'accepted' for m in group.members)
        if all_accepted and ServiceGroupService._specs_covered(group):
            from app.common.profile_audit import listing_approval_status_on_submit
            from app.models import Doctor
            lead = Doctor.query.get(group.created_by_doctor_id) if group.created_by_doctor_id else None
            group.approval_status = listing_approval_status_on_submit(lead, 'group_plan')
        else:
            group.approval_status = 'awaiting_members'

    @staticmethod
    def get_groups_for_doctor(doctor_id):
        """Groups the doctor leads OR is a member of."""
        tid = current_tenant_id_strict()
        member_group_ids = db.session.query(MarketplaceServiceGroupMember.group_id).filter_by(
            tenant_id=tid, doctor_id=doctor_id,
        ).subquery()
        groups = MarketplaceServiceGroup.query.filter(
            MarketplaceServiceGroup.tenant_id == tid,
            db.or_(
                MarketplaceServiceGroup.created_by_doctor_id == doctor_id,
                MarketplaceServiceGroup.id.in_(db.session.query(member_group_ids)),
            ),
        ).order_by(MarketplaceServiceGroup.created_at.desc()).all()
        return groups

    @staticmethod
    def _validate_network_members(doctor_id, member_ids):
        """Every member must be an accepted doctor connection of the creator."""
        if not member_ids:
            return []
        tid = current_tenant_id_strict()
        # De-dup, drop blanks, and drop the creator if present.
        member_ids = [m for m in dict.fromkeys(member_ids) if m and str(m) != str(doctor_id)]
        if not member_ids:
            return []
        connected = {
            str(c.target_doctor_id)
            for c in CareNetworkConnection.query.filter(
                CareNetworkConnection.tenant_id == tid,
                CareNetworkConnection.doctor_id == doctor_id,
                CareNetworkConnection.connection_type == 'doctor',
                CareNetworkConnection.status == 'active',
                CareNetworkConnection.target_doctor_id.in_(member_ids),
            ).all()
        }
        missing = [m for m in member_ids if str(m) not in connected]
        if missing:
            raise ValueError('All co-doctors must be connections in your care network')
        return member_ids

    @staticmethod
    def _validate_product_price(product_id, group_price):
        tid = current_tenant_id_strict()
        product = DoctorProduct.query.filter_by(
            tenant_id=tid, id=product_id, is_active=True, is_deleted=False,
        ).first()
        if not product:
            raise ValueError('Invalid or inactive product')
        try:
            price = float(group_price)
        except (TypeError, ValueError):
            raise ValueError('Price must be a number')
        if price < float(product.min_price) or price > float(product.max_price):
            raise ValueError(f'Price must be between {product.min_price} and {product.max_price}')
        return product, price

    @staticmethod
    def create_group(doctor, data):
        product_id = data.get('product_id')
        if not product_id:
            raise ValueError('product_id is required')
        _, price = ServiceGroupService._validate_product_price(product_id, data.get('group_price'))
        member_ids = ServiceGroupService._validate_network_members(
            doctor.id, data.get('member_doctor_ids') or [],
        )

        product = DoctorProduct.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=product_id,
        ).first()
        # Required specs: explicit → the product's allowed specializations.
        required = data.get('required_specialization_ids')
        if required is None:
            required = (product.allowed_specialization_ids or None) if product else None

        group = MarketplaceServiceGroup(
            product_id=product_id,
            created_by_doctor_id=doctor.id,
            group_price=price,
            group_description=(data.get('group_description') or '').strip() or None,
            required_specialization_ids=required,
            approval_status='awaiting_members',
            is_active=True,
        )
        db.session.add(group)
        db.session.flush()  # get group.id

        # Lead is auto-accepted; invited co-doctors must accept (Item 3D).
        db.session.add(MarketplaceServiceGroupMember(
            group_id=group.id, doctor_id=doctor.id, role='lead',
            status='accepted', responded_at=datetime.now(timezone.utc)))
        for mid in member_ids:
            db.session.add(MarketplaceServiceGroupMember(
                group_id=group.id, doctor_id=mid, role='member', status='invited'))

        db.session.flush()
        ServiceGroupService._refresh_status(group)  # pending now if no invites + specs ok
        db.session.commit()
        return group

    # ── Member consent + admin assignment (Item 3D) ───────────────────────
    @staticmethod
    def get_invitations_for_doctor(doctor_id):
        """Groups where this doctor is an invited (not-yet-responded) member."""
        tid = current_tenant_id_strict()
        rows = MarketplaceServiceGroupMember.query.filter_by(
            tenant_id=tid, doctor_id=doctor_id, status='invited', role='member',
        ).all()
        groups = []
        for m in rows:
            if m.group and m.group.approval_status not in ('rejected',):
                groups.append(m.group)
        return groups

    @staticmethod
    def respond_to_invite(doctor_id, group_id, accept):
        tid = current_tenant_id_strict()
        member = MarketplaceServiceGroupMember.query.filter_by(
            tenant_id=tid, group_id=group_id, doctor_id=doctor_id,
        ).first()
        if not member:
            raise ValueError('You are not a member of this group')
        if member.role == 'lead':
            raise ValueError('The lead does not respond to their own group')
        member.status = 'accepted' if accept else 'declined'
        member.responded_at = datetime.now(timezone.utc)
        group = member.group
        ServiceGroupService._refresh_status(group)
        db.session.commit()
        return group

    @staticmethod
    def admin_assign_member(group_id, doctor_id):
        """Admin fills a missing specialty by assigning a doctor (auto-accepted)."""
        tid = current_tenant_id_strict()
        group = MarketplaceServiceGroup.query.filter_by(tenant_id=tid, id=group_id).first()
        if not group:
            raise ValueError('Group not found')
        existing = MarketplaceServiceGroupMember.query.filter_by(
            tenant_id=tid, group_id=group_id, doctor_id=doctor_id,
        ).first()
        if existing:
            existing.status = 'accepted'
            existing.responded_at = datetime.now(timezone.utc)
        else:
            db.session.add(MarketplaceServiceGroupMember(
                group_id=group_id, doctor_id=doctor_id, role='member',
                status='accepted', responded_at=datetime.now(timezone.utc)))
        db.session.flush()
        ServiceGroupService._refresh_status(group)
        db.session.commit()
        return group

    @staticmethod
    def update_group(doctor_id, group_id, data):
        tid = current_tenant_id_strict()
        group = MarketplaceServiceGroup.query.filter_by(
            tenant_id=tid, id=group_id, created_by_doctor_id=doctor_id,
        ).first()
        if not group:
            return None

        if 'group_price' in data:
            _, price = ServiceGroupService._validate_product_price(group.product_id, data['group_price'])
            group.group_price = price
        if 'group_description' in data:
            group.group_description = (data['group_description'] or '').strip() or None

        if 'member_doctor_ids' in data:
            member_ids = ServiceGroupService._validate_network_members(
                doctor_id, data.get('member_doctor_ids') or [],
            )
            # Replace non-lead members (new ones must re-consent).
            MarketplaceServiceGroupMember.query.filter(
                MarketplaceServiceGroupMember.group_id == group.id,
                MarketplaceServiceGroupMember.role != 'lead',
            ).delete(synchronize_session=False)
            for mid in member_ids:
                db.session.add(MarketplaceServiceGroupMember(
                    group_id=group.id, doctor_id=mid, role='member', status='invited'))

        group.rejection_reason = None
        db.session.flush()
        ServiceGroupService._refresh_status(group)  # awaiting_members until all accept
        db.session.commit()
        return group

    @staticmethod
    def delete_group(doctor_id, group_id):
        tid = current_tenant_id_strict()
        group = MarketplaceServiceGroup.query.filter_by(
            tenant_id=tid, id=group_id, created_by_doctor_id=doctor_id,
        ).first()
        if not group:
            return False
        db.session.delete(group)
        db.session.commit()
        return True
