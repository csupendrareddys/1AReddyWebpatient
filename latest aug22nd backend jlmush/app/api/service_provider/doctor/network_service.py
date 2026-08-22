"""
Doctor Care Network service.

Backs two surfaces with one connection mechanism (invite code / phone+name /
directory discover + request->accept), distinguished by ``context``:

  * context='network' — My Network (care/referral), classified by referral_type
    (A|B|C).
  * context='link'    — My Link (professional affiliation), classified by
    relationship_type (partner|associate|employee).

Doctor<->doctor connections require the peer to accept and are stored as a
reciprocal pair. Hospital/clinic connections are added directly. The Discover
directory (browse-and-request all providers of a type) is gated by a per-tenant
super-admin visibility toggle stored in ``Tenant.settings['provider_visibility']``.

Same-tenant only. tenant_id on new rows is stamped by the shared before_flush
hook from request context.
"""
import secrets
from datetime import datetime

from sqlalchemy import or_

from app.extensions import db
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    User, Doctor, Hospital, Clinic, Tenant,
    CareNetworkConnection, CareNetworkRequest, HouseGroupRequestStatus,
)

VALID_TYPES = ('doctor', 'hospital', 'clinic')
_VIS_KEY = {'doctor': 'doctors', 'hospital': 'hospitals', 'clinic': 'clinics'}

# Membership tiers cap how many My Link affiliations a member may hold
# (``max_link_connections``). Only ``context='link'`` is capped — My Network is
# the same table and a different relationship, and capping referrals because
# someone bought a small affiliation tier would be a surprise nobody asked for.
_CAPPED_CONTEXT = 'link'


class DoctorNetworkService:
    """Care-network linking for doctors (doctor / hospital / clinic)."""

    # ── Reads ────────────────────────────────────────────────────────────
    @staticmethod
    def get_connections(doctor_id, connection_type=None, context='network'):
        q = CareNetworkConnection.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor_id, status='active',
        )
        if context:
            q = q.filter_by(context=context)
        if connection_type:
            q = q.filter_by(connection_type=connection_type)
        return q.order_by(CareNetworkConnection.created_at.desc()).all()

    @staticmethod
    def get_sent_requests(doctor_id, context='network'):
        q = CareNetworkRequest.query.filter_by(requester_doctor_id=doctor_id)
        if context:
            q = q.filter_by(context=context)
        return q.order_by(CareNetworkRequest.created_at.desc()).all()

    @staticmethod
    def get_received_requests(user_id, context=None):
        user = User.query.get(user_id)
        if not user:
            return []
        filters = [CareNetworkRequest.target_user_id == user_id]
        if user.phone_number:
            filters.append(CareNetworkRequest.target_phone == user.phone_number)
        q = CareNetworkRequest.query.filter(
            or_(*filters),
            CareNetworkRequest.status == HouseGroupRequestStatus.PENDING,
        )
        if context:
            q = q.filter(CareNetworkRequest.context == context)
        return q.order_by(CareNetworkRequest.created_at.desc()).all()

    # ── Tenant visibility (super-admin toggle) ───────────────────────────
    @staticmethod
    def get_tenant_visibility():
        """{'doctors':bool,'hospitals':bool,'clinics':bool} from Tenant.settings."""
        tenant = Tenant.query.get(current_tenant_id_strict())
        vis = (tenant.settings or {}).get('provider_visibility', {}) if tenant else {}
        return {k: bool(vis.get(k, False)) for k in ('doctors', 'hospitals', 'clinics')}

    @staticmethod
    def discover(doctor, connection_type):
        """Browse all providers of a type in the tenant — gated by visibility.

        Returns items shaped for a "Connect" action: {id, name, contact}.
        Excludes self and already-connected targets (any context).
        """
        if connection_type not in VALID_TYPES:
            raise ValueError('Invalid connection type')
        vis = DoctorNetworkService.get_tenant_visibility()
        if not vis.get(_VIS_KEY[connection_type]):
            raise ValueError('This directory is not enabled by your administrator')

        tid = current_tenant_id_strict()
        # ids already connected (across contexts) so the directory stays clean
        connected = {
            str(c.target_doctor_id or c.target_hospital_id or c.target_clinic_id)
            for c in CareNetworkConnection.query.filter_by(
                tenant_id=tid, doctor_id=doctor.id, connection_type=connection_type,
            ).all()
        }
        out = []
        if connection_type == 'doctor':
            rows = Doctor.query.filter(Doctor.tenant_id == tid, Doctor.id != doctor.id).all()
            for d in rows:
                if str(d.id) in connected:
                    continue
                out.append({'id': str(d.id), 'name': d.full_name,
                            'contact': d.user.phone_number if d.user else None})
        else:
            Model = Hospital if connection_type == 'hospital' else Clinic
            for f in Model.query.filter_by(tenant_id=tid, is_deleted=False).all():
                if str(f.id) in connected:
                    continue
                out.append({'id': str(f.id), 'name': f.name, 'contact': f.phone})
        return out

    # ── Connection helpers ───────────────────────────────────────────────
    @staticmethod
    def _ensure_connection(doctor_id, connection_type, *, target_doctor_id=None,
                           target_hospital_id=None, target_clinic_id=None,
                           context='network', referral_type=None, relationship_type=None):
        """Create a connection row if it doesn't already exist (idempotent)."""
        tid = current_tenant_id_strict()
        existing = CareNetworkConnection.query.filter_by(
            tenant_id=tid, doctor_id=doctor_id, connection_type=connection_type,
            context=context, target_doctor_id=target_doctor_id,
            target_hospital_id=target_hospital_id, target_clinic_id=target_clinic_id,
        ).first()
        if existing:
            existing.status = 'active'
            if referral_type is not None:
                existing.referral_type = referral_type
            if relationship_type is not None:
                existing.relationship_type = relationship_type
            return existing
        conn = CareNetworkConnection(
            doctor_id=doctor_id, connection_type=connection_type,
            target_doctor_id=target_doctor_id, target_hospital_id=target_hospital_id,
            target_clinic_id=target_clinic_id, status='active',
            context=context, referral_type=referral_type, relationship_type=relationship_type,
        )
        db.session.add(conn)
        return conn

    @staticmethod
    def _link_doctors(doctor_a_id, doctor_b_id, *, context='network',
                      referral_type=None, relationship_type=None):
        """Create the reciprocal doctor<->doctor connection pair."""
        for a, b in ((doctor_a_id, doctor_b_id), (doctor_b_id, doctor_a_id)):
            DoctorNetworkService._ensure_connection(
                a, 'doctor', target_doctor_id=b, context=context,
                referral_type=referral_type, relationship_type=relationship_type,
            )

    @staticmethod
    def remove_connection(conn):
        """Sever ``conn``, and the peer's mirror of it when there is one.

        The exact inverse of the two creation paths. A doctor<->doctor link is
        a reciprocal PAIR (:meth:`_link_doctors`), so removing only the row the
        caller happens to hold would leave the other party still listing them —
        each side would see a different answer to whether they are connected.
        A doctor->facility link is a single row and has no mirror.

        Soft, not a delete: ``status='removed'`` keeps the history, and every
        read already filters on ``status='active'``. It also makes re-linking
        work, because ``_ensure_connection`` finds the row and flips it back to
        active rather than tripping the unique constraint.

        **Who may call this is the route's business, not this method's** — a
        My Link affiliation is what lets a facility operate a doctor, so
        severing it is a revocation, and both sides can do it unilaterally.
        Consent is needed to START a relationship, not to end one.
        """
        removed = [conn]
        conn.status = 'removed'
        conn.updated_at = datetime.utcnow()

        if conn.connection_type == 'doctor' and conn.target_doctor_id:
            mirror = CareNetworkConnection.query.filter_by(
                tenant_id=conn.tenant_id, doctor_id=conn.target_doctor_id,
                connection_type='doctor', context=conn.context,
                target_doctor_id=conn.doctor_id,
            ).first()
            if mirror is not None and mirror.status == 'active':
                mirror.status = 'removed'
                mirror.updated_at = datetime.utcnow()
                removed.append(mirror)

        db.session.commit()
        return removed

    # ── Plan capacity ────────────────────────────────────────────────────
    @staticmethod
    def _check_link_capacity(context, *parties):
        """Refuse if any party to a ``context='link'`` connection is at their cap.

        ``parties`` are ``(kind, id, name)`` triples — see
        ``app.api.membership.limits.require_link_capacity`` for why both ends
        are checked rather than just whoever made the request.

        Checked at the moments a link is CREATED, and again where it is
        ACCEPTED: a request can sit pending for weeks, and the roster it lands
        in is not the one that existed when it was sent.
        """
        if context != _CAPPED_CONTEXT:
            return
        from app.api.membership import limits
        limits.require_link_capacity(*parties)

    # ── Send request / direct-add ────────────────────────────────────────
    @staticmethod
    def send_request(doctor, data):
        """
        Send a connection request.

        Doctor targets create a pending request (peer accepts). Hospital/clinic
        targets are resolved and connected immediately. A target can be given by
        phone+name OR by target_id (from the Discover directory).

        Returns {'request': <dict>|None, 'connection': <dict>|None}.
        """
        connection_type = (data.get('connection_type') or 'doctor').strip()
        if connection_type not in VALID_TYPES:
            raise ValueError('Invalid connection type')
        context = (data.get('context') or 'network').strip()
        referral_type = data.get('referral_type') or None
        relationship_type = data.get('relationship_type') or None
        target_id = (data.get('target_id') or '').strip()
        target_phone = (data.get('target_phone') or '').strip()
        target_name = (data.get('target_name') or '').strip()
        target_last_name = (data.get('target_last_name') or '').strip()

        # The sender's own cap, before anything is written. The other end is
        # checked when they accept — at this point they may not even be
        # resolved yet (a phone-number request names a user, not a practice).
        DoctorNetworkService._check_link_capacity(
            context, ('doctor', doctor.id, None),
        )

        if connection_type == 'doctor':
            req = DoctorNetworkService._send_doctor_request(
                doctor, target_id, target_phone, target_name, target_last_name,
                context, referral_type, relationship_type,
            )
            return {'request': req.to_dict()}

        # Hospital/clinic — now a PENDING request the facility's owner accepts.
        req = DoctorNetworkService._add_facility(
            doctor, connection_type, target_id, target_phone, target_name,
            context, referral_type, relationship_type,
        )
        db.session.commit()
        return {'request': req.to_dict()}

    @staticmethod
    def _send_doctor_request(doctor, target_id, target_phone, target_name, target_last_name,
                             context='network', referral_type=None, relationship_type=None):
        # Resolve the target doctor either by id (Discover) or phone (manual).
        if target_id:
            target_doctor = Doctor.query.filter_by(
                id=target_id, tenant_id=current_tenant_id_strict(),
            ).first()
            if not target_doctor:
                raise ValueError('Doctor not found in your organisation')
            target_user = target_doctor.user
            target_phone = target_phone or (target_user.phone_number if target_user else None)
            if not target_name:
                target_name = target_doctor.full_name or ''
        else:
            if not target_phone:
                raise ValueError('Phone number is required')
            if not target_name or not target_last_name:
                raise ValueError('First and last name are required')
            target_user = User.query.filter_by(phone_number=target_phone, is_active=True).first()
            if not target_user:
                raise ValueError(
                    f'No registered user found with phone number {target_phone}. '
                    'They must have an account to be connected.'
                )
            target_doctor = Doctor.query.filter_by(user_id=target_user.id).first()
            if not target_doctor:
                raise ValueError('That user is not a doctor')

        if target_user and str(target_user.id) == str(doctor.user_id):
            raise ValueError('You cannot send a request to yourself')
        if target_user and str(target_user.tenant_id) != str(current_tenant_id_strict()):
            raise ValueError('That user is not part of your organisation')

        already = CareNetworkConnection.query.filter_by(
            tenant_id=current_tenant_id_strict(), doctor_id=doctor.id,
            connection_type='doctor', context=context, target_doctor_id=target_doctor.id,
        ).first()
        if already:
            raise ValueError('You are already connected with this doctor')

        existing = CareNetworkRequest.query.filter_by(
            requester_doctor_id=doctor.id, target_user_id=target_user.id if target_user else None,
            context=context, status=HouseGroupRequestStatus.PENDING,
        ).first()
        if existing:
            raise ValueError('A pending request already exists for this doctor')

        req = CareNetworkRequest(
            requester_doctor_id=doctor.id, connection_type='doctor',
            context=context, referral_type=referral_type, relationship_type=relationship_type,
            target_user_id=target_user.id if target_user else None,
            target_phone=target_phone, target_name=target_name, target_last_name=target_last_name,
            invite_code=secrets.token_urlsafe(8),
        )
        db.session.add(req)
        db.session.commit()
        return req

    @staticmethod
    def _add_facility(doctor, connection_type, target_id, target_phone, target_name,
                      context='network', referral_type=None, relationship_type=None):
        """Create a PENDING request to a hospital/clinic. The facility's owner
        account (``admin_user_id``) accepts it, which is what actually creates
        the doctor→facility connection (see ``accept_request``)."""
        Model = Hospital if connection_type == 'hospital' else Clinic
        tid = current_tenant_id_strict()
        facility = None
        if target_id:
            facility = Model.query.filter_by(id=target_id, tenant_id=tid, is_deleted=False).first()
        if not facility and target_phone:
            facility = Model.query.filter_by(tenant_id=tid, is_deleted=False, phone=target_phone).first()
        if not facility and target_name:
            facility = Model.query.filter(
                Model.tenant_id == tid, Model.is_deleted == False,  # noqa: E712
                Model.name.ilike(f'%{target_name}%'),
            ).first()
        if not facility:
            raise ValueError(f'{connection_type.capitalize()} not found in your organisation')

        admin_user_id = getattr(facility, 'admin_user_id', None)
        if not admin_user_id:
            raise ValueError(
                f"This {connection_type} doesn't have an owner account yet, so it "
                f"can't accept a connection request. Ask your administrator to set "
                f"up the {connection_type}'s login first."
            )

        fkw = {'target_hospital_id': facility.id} if connection_type == 'hospital' \
            else {'target_clinic_id': facility.id}

        already = CareNetworkConnection.query.filter_by(
            tenant_id=tid, doctor_id=doctor.id, connection_type=connection_type,
            context=context, status='active', **fkw,
        ).first()
        if already:
            raise ValueError(f'You are already connected with this {connection_type}')

        existing = CareNetworkRequest.query.filter_by(
            requester_doctor_id=doctor.id, connection_type=connection_type,
            context=context, status=HouseGroupRequestStatus.PENDING, **fkw,
        ).first()
        if existing:
            raise ValueError(f'A pending request already exists for this {connection_type}')

        # The facility is resolved by this point, so its cap can be reported
        # now rather than leaving the doctor waiting on an accept that was
        # never going to succeed. Named, because it isn't the doctor's limit
        # and they'd otherwise go looking at their own plan.
        DoctorNetworkService._check_link_capacity(
            context, (connection_type, facility.id, facility.name),
        )

        req = CareNetworkRequest(
            requester_doctor_id=doctor.id, connection_type=connection_type,
            context=context, referral_type=referral_type, relationship_type=relationship_type,
            target_user_id=admin_user_id, target_name=facility.name,
            invite_code=secrets.token_urlsafe(8), **fkw,
        )
        db.session.add(req)
        return req

    # ── Accept / reject / cancel ─────────────────────────────────────────
    @staticmethod
    def accept_request(request_id, user_id, acceptor_doctor=None):
        req = CareNetworkRequest.query.get(request_id)
        if not req:
            raise ValueError('Request not found')
        if req.status != HouseGroupRequestStatus.PENDING:
            raise ValueError('Request is no longer pending')

        is_target = False
        if req.target_user_id and str(req.target_user_id) == str(user_id):
            is_target = True
        elif req.target_phone:
            user = User.query.get(user_id)
            if user and user.phone_number == req.target_phone:
                is_target = True
                req.target_user_id = user_id
        if not is_target:
            raise ValueError('This request is not addressed to you')

        # Both ends, at the moment the link actually becomes real. The sender
        # was checked when they sent it, but a pending request can outlive the
        # roster it was sent against — and this is the only point a FACILITY's
        # own cap is ever reached, since it never creates one of these.
        requester = Doctor.query.get(req.requester_doctor_id)
        DoctorNetworkService._check_link_capacity(
            req.context,
            ('clinic', req.target_clinic_id, None),
            ('hospital', req.target_hospital_id, None),
            ('doctor', getattr(acceptor_doctor, 'id', None), None),
            ('doctor', req.requester_doctor_id,
             requester.full_name if requester else 'The requesting doctor'),
        )

        req.status = HouseGroupRequestStatus.ACCEPTED
        req.updated_at = datetime.utcnow()

        if req.target_clinic_id or req.target_hospital_id:
            # Facility request — one-way doctor → facility connection. The
            # acceptor is the facility's owner account, not a doctor.
            fkw = {'target_hospital_id': req.target_hospital_id} if req.target_hospital_id \
                else {'target_clinic_id': req.target_clinic_id}
            DoctorNetworkService._ensure_connection(
                req.requester_doctor_id, req.connection_type, context=req.context,
                referral_type=req.referral_type, relationship_type=req.relationship_type, **fkw,
            )
        else:
            # Doctor ↔ doctor — reciprocal pair (acceptor must be a doctor).
            if not acceptor_doctor:
                raise ValueError('A doctor profile is required to accept this request')
            DoctorNetworkService._link_doctors(
                req.requester_doctor_id, acceptor_doctor.id, context=req.context,
                referral_type=req.referral_type, relationship_type=req.relationship_type,
            )
        db.session.commit()
        return req

    @staticmethod
    def reject_request(request_id, user_id):
        req = CareNetworkRequest.query.get(request_id)
        if not req:
            raise ValueError('Request not found')
        if req.status != HouseGroupRequestStatus.PENDING:
            raise ValueError('Request is no longer pending')
        if req.target_user_id and str(req.target_user_id) != str(user_id):
            raise ValueError('This request is not addressed to you')
        req.status = HouseGroupRequestStatus.REJECTED
        req.updated_at = datetime.utcnow()
        db.session.commit()
        return req

    @staticmethod
    def cancel_request(request_id, doctor_id):
        req = CareNetworkRequest.query.filter_by(
            id=request_id, requester_doctor_id=doctor_id,
            status=HouseGroupRequestStatus.PENDING,
        ).first()
        if not req:
            raise ValueError('Pending request not found')
        req.status = HouseGroupRequestStatus.CANCELLED
        req.updated_at = datetime.utcnow()
        db.session.commit()
        return req

    # ── Invite code ──────────────────────────────────────────────────────
    @staticmethod
    def generate_invite(doctor, data):
        connection_type = (data.get('connection_type') or 'doctor').strip()
        if connection_type not in VALID_TYPES:
            raise ValueError('Invalid connection type')
        context = (data.get('context') or 'network').strip()
        # Refuse to mint a code that cannot be redeemed. The cap is re-checked
        # on redemption anyway, but handing someone an invite and letting them
        # discover it was dead moves the failure onto the wrong person.
        DoctorNetworkService._check_link_capacity(
            context, ('doctor', doctor.id, None),
        )
        req = CareNetworkRequest(
            requester_doctor_id=doctor.id, connection_type=connection_type,
            context=context,
            referral_type=data.get('referral_type') or None,
            relationship_type=data.get('relationship_type') or None,
            invite_code=secrets.token_urlsafe(8),
        )
        db.session.add(req)
        db.session.commit()
        return req

    @staticmethod
    def join_by_invite_code(invite_code, joiner_doctor):
        req = CareNetworkRequest.query.filter_by(
            invite_code=invite_code, status=HouseGroupRequestStatus.PENDING,
        ).first()
        if not req:
            raise ValueError('Invalid or expired invite code')
        if str(req.requester_doctor_id) == str(joiner_doctor.id):
            raise ValueError('You cannot join your own invite')

        # Both halves of the reciprocal pair land at once, so both caps apply.
        # The inviter's is named: a code can be weeks old, and someone who was
        # handed one has no way to know whose plan filled up.
        inviter = Doctor.query.get(req.requester_doctor_id)
        DoctorNetworkService._check_link_capacity(
            req.context,
            ('doctor', joiner_doctor.id, None),
            ('doctor', req.requester_doctor_id,
             inviter.full_name if inviter else 'The doctor who invited you'),
        )

        req.status = HouseGroupRequestStatus.ACCEPTED
        req.target_user_id = joiner_doctor.user_id
        req.updated_at = datetime.utcnow()
        DoctorNetworkService._link_doctors(
            req.requester_doctor_id, joiner_doctor.id, context=req.context,
            referral_type=req.referral_type, relationship_type=req.relationship_type,
        )
        db.session.commit()
        return DoctorNetworkService.get_connections(joiner_doctor.id, 'doctor', context=req.context)
