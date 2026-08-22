"""Service Communication — business logic.

Two responsibilities today:

  * ``ConfigService``    — the admin's per-product communication terms.
  * ``ActivationService`` — turning a purchase into a live channel.

Isolation contract: this module must not import or mutate appointment /
consultation models. Provider resolution goes through Doctor / Clinic /
Hospital only to find the owning ``User`` for participant rows.
"""
import logging
from datetime import timedelta

from app.extensions import db
from app.models import (
    ChannelEvent, ChannelEventType, ChannelParticipant, ChannelParticipantRole,
    DoctorProduct, MarketplaceServiceGroup, MembershipVertical, Patient,
    PurchasedService, PurchasedServiceKind, PurchasedServiceStatus,
    ServiceChannel, ServiceChannelKind, ServiceChannelStatus,
    ServiceCommunicationConfig,
)
from app.models._base import utcnow

logger = logging.getLogger(__name__)


class ServiceCommunicationError(Exception):
    """Domain error carrying an HTTP status for the route layer."""

    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _on_behalf():
    """``(user_id, kind)`` for a message someone typed on a participant's
    behalf, or ``(None, None)`` when the participant typed it themselves.

    Three ways a message gets here without its participant writing it:

    * a platform operator through the Operations act-on-behalf proxy,
    * a practice's own support staff writing in their doctor's thread, and
    * a clinic or hospital operating a doctor it employs, through the My Link
      Operation Page.

    All three are the same fact to a reader — *this is not the person you think
    you are talking to* — so all three are stamped, and ``kind`` says which.
    Recording it is the entire condition on which anyone but the participant
    was let into these threads: a patient must be able to see that the
    receptionist, or the clinic, and not the doctor, wrote this.

    The two proxies are told apart by SOURCE rather than by "a proxy is
    running". They share one machine (``app.common.act_as``) but not one
    authority, and an employer must not be labelled as platform support.

    Imported inside the function on purpose: ``app.api.admin.operations``
    imports service-layer modules, so a module-level import here closes the
    cycle. ``acting_admin()`` is reliable inside the swapped block because both
    proxies resolve the real caller BEFORE swapping ``current_user``.
    """
    from flask_jwt_extended import current_user
    from app.common.act_as import acting_on_behalf
    from app.common.profile_audit import acting_admin
    from app.models import UserRole

    # No ``kind`` argument on either — a message is marked however the proxy
    # was entered, not by what sort of member it was entered against.
    for source, label in (('ops', 'admin'), ('link', 'employer')):
        if acting_on_behalf(source=source):
            actor = acting_admin()
            actor_id = getattr(actor, 'id', None) if actor is not None else None
            if actor_id:
                return actor_id, label

    # The staff member is the real author; the participant row they post
    # through belongs to their employer.
    if getattr(current_user, 'role', None) == UserRole.PROVIDER_STAFF:
        return current_user.id, 'staff'

    return None, None


def _on_behalf_fields():
    """``_on_behalf()`` as the ChannelMessage kwargs it stamps."""
    author_id, kind = _on_behalf()
    return {'sent_by_admin_id': author_id, 'sent_on_behalf_kind': kind}


# ---------------------------------------------------------------------------
# Provider resolution
# ---------------------------------------------------------------------------
# ``provider_type``/``provider_id`` are polymorphic (no FK is possible across
# three tables), so the mapping to a concrete row + its owning User lives here
# and is the single place that knows the shape of each vertical.
_PROVIDER_USER_ATTR = {
    MembershipVertical.DOCTOR: ('Doctor', 'user_id'),
    MembershipVertical.CLINIC: ('Clinic', 'admin_user_id'),
    MembershipVertical.HOSPITAL: ('Hospital', 'admin_user_id'),
}


def resolve_provider_user_id(provider_type, provider_id, tenant_id):
    """The ``users.user_id`` behind a polymorphic provider reference.

    Returns None when the provider row is missing or has no owning user (a
    clinic/hospital can exist before its admin account is attached) — the
    caller decides whether that is fatal.
    """
    import app.models as models

    mapping = _PROVIDER_USER_ATTR.get(provider_type)
    if not mapping:
        return None
    model_name, attr = mapping
    model = getattr(models, model_name, None)
    if model is None:
        return None
    row = model.query.filter_by(id=provider_id, tenant_id=tenant_id).first()
    if row is None:
        return None
    return getattr(row, attr, None)


# ---------------------------------------------------------------------------
# Admin config
# ---------------------------------------------------------------------------

_CONFIG_BOOL_FIELDS = (
    'is_enabled', 'chat_enabled', 'audio_enabled', 'video_enabled',
    'documents_enabled', 'forms_enabled',
)
# (field, minimum, nullable) — quotas are nullable (None = unlimited).
_CONFIG_INT_FIELDS = (
    ('validity_days', 1, False),
    ('retention_days', 0, False),
    ('max_attachment_mb', 1, False),
    ('audio_minutes_quota', 0, True),
    ('video_minutes_quota', 0, True),
)


class ConfigService:
    """Per-product communication terms, authored by the admin."""

    @staticmethod
    def get_for_product(product_id, tenant_id):
        return ServiceCommunicationConfig.query.filter_by(
            tenant_id=tenant_id, product_id=product_id, is_deleted=False,
        ).first()

    @staticmethod
    def upsert(product_id, tenant_id, data, actor_id=None):
        """Create or update the config for one product.

        Upsert rather than separate POST/PUT: a product either has terms or it
        doesn't, and the admin UI is a single form either way.
        """
        product = DoctorProduct.query.filter_by(
            id=product_id, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if product is None:
            raise ServiceCommunicationError('Product not found', 404)

        errors = ConfigService.validate(data)
        if errors:
            raise ServiceCommunicationError('; '.join(errors), 400)

        config = ConfigService.get_for_product(product_id, tenant_id)
        if config is None:
            config = ServiceCommunicationConfig(
                tenant_id=tenant_id, product_id=product_id,
                created_by_id=actor_id,
            )
            db.session.add(config)

        for field in _CONFIG_BOOL_FIELDS:
            if field in data:
                setattr(config, field, bool(data[field]))
        for field, _minimum, nullable in _CONFIG_INT_FIELDS:
            if field in data:
                value = data[field]
                if value in (None, '') and nullable:
                    setattr(config, field, None)
                else:
                    setattr(config, field, int(value))

        config.updated_by_id = actor_id
        db.session.commit()
        return config

    @staticmethod
    def validate(data):
        """Shape-check an admin payload. Returns a list of messages ([] = ok)."""
        errors = []
        if not isinstance(data, dict):
            return ['Body must be a JSON object.']

        for field in _CONFIG_BOOL_FIELDS:
            if field in data and not isinstance(data[field], bool):
                errors.append(f'{field} must be a boolean.')

        for field, minimum, nullable in _CONFIG_INT_FIELDS:
            if field not in data:
                continue
            value = data[field]
            if value in (None, ''):
                if not nullable:
                    errors.append(f'{field} is required.')
                continue
            if isinstance(value, bool) or not isinstance(value, int):
                errors.append(f'{field} must be an integer.')
                continue
            if value < minimum:
                errors.append(f'{field} must be >= {minimum}.')
        return errors


# ---------------------------------------------------------------------------
# Activation
# ---------------------------------------------------------------------------

class ActivationService:
    """Turns a purchase into a live channel.

    Exposed as an explicit admin/manual action as well as a hook the payment
    flow can call, because the marketplace purchase route is still a stub
    (`"Please wait for payment integration."`) — the module has to be usable
    and testable before that lands.
    """

    @staticmethod
    def _build_entitlement_and_channel(
        *, product, config, tenant_id, patient, provider_type, provider_id,
        provider_user_ids, order_id=None, actor_id=None,
        service_group_id=None, kind=PurchasedServiceKind.INDIVIDUAL,
        channel_kind=ServiceChannelKind.SINGLE,
    ):
        """Create one entitlement + its channel + participants + events.

        Flush-only (NO commit) so it can be composed: a group activation builds
        several of these inside one transaction. ``provider_user_ids`` are the
        users added as PROVIDER participants — a single id for a 1:1 channel, N
        for a group channel; the caller resolves and de-duplicates them. The
        patient is always added as the sole PATIENT participant.

        Returns ``(purchase, channel)``.
        """
        now = utcnow()
        snapshot = config.snapshot()

        purchase = PurchasedService(
            tenant_id=tenant_id,
            product_id=product.id,
            patient_id=patient.id,
            provider_type=provider_type,
            provider_id=provider_id,
            order_id=order_id,
            service_group_id=service_group_id,
            kind=kind,
            status=PurchasedServiceStatus.ACTIVE,
            valid_from=now,
            valid_until=now + timedelta(days=snapshot['validity_days']),
            activated_at=now,
            created_by_id=actor_id,
            **snapshot,
        )
        db.session.add(purchase)
        db.session.flush()

        channel = ServiceChannel(
            tenant_id=tenant_id,
            purchased_service_id=purchase.id,
            status=ServiceChannelStatus.ACTIVE,
            kind=channel_kind,
            created_by_id=actor_id,
        )
        db.session.add(channel)
        db.session.flush()

        participants = [ChannelParticipant(
            tenant_id=tenant_id, channel_id=channel.id,
            user_id=patient.user_id, role=ChannelParticipantRole.PATIENT,
            created_by_id=actor_id,
        )]
        for uid in provider_user_ids:
            participants.append(ChannelParticipant(
                tenant_id=tenant_id, channel_id=channel.id,
                user_id=uid, role=ChannelParticipantRole.PROVIDER,
                created_by_id=actor_id,
            ))
        db.session.add_all(participants)
        db.session.flush()

        record_event(
            channel, ChannelEventType.SERVICE_BOOKED,
            payload={
                'product_id': str(product.id),
                'product_name': product.name,
                'valid_until': purchase.valid_until.isoformat(),
            },
        )
        record_event(
            channel, ChannelEventType.CHANNEL_CREATED,
            payload={'participants': len(participants)},
        )
        return purchase, channel

    @staticmethod
    def activate(
        *, product_id, patient_id, provider_type, provider_id,
        tenant_id, order_id=None, actor_id=None,
    ):
        """Create the entitlement + its channel. Idempotent per (patient, product, order).

        Returns ``(purchased_service, channel, created)`` — ``created`` is
        False when a live entitlement already existed, so a double-click or a
        retried webhook doesn't mint a second channel.
        """
        product = DoctorProduct.query.filter_by(
            id=product_id, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if product is None:
            raise ServiceCommunicationError('Product not found', 404)

        config = ConfigService.get_for_product(product_id, tenant_id)
        if config is None or not config.is_enabled:
            raise ServiceCommunicationError(
                'This product does not include communication. Enable it on the '
                'product first.', 400,
            )

        if isinstance(provider_type, str):
            try:
                provider_type = MembershipVertical(provider_type)
            except ValueError:
                raise ServiceCommunicationError(
                    'provider_type must be one of doctor / clinic / hospital.', 400,
                )

        patient = Patient.query.filter_by(
            id=patient_id, tenant_id=tenant_id,
        ).first()
        if patient is None:
            raise ServiceCommunicationError('Patient not found', 404)

        provider_user_id = resolve_provider_user_id(
            provider_type, provider_id, tenant_id,
        )
        if provider_user_id is None:
            raise ServiceCommunicationError(
                f'No {provider_type.value} found for that provider_id, or it has '
                'no linked user account.', 404,
            )

        # Don't mint a second live INDIVIDUAL entitlement for the same thing.
        # Scoped to ``service_group_id IS NULL`` so a group leg for the same
        # (product, patient, provider) is treated as a distinct entitlement.
        existing = PurchasedService.query.filter_by(
            tenant_id=tenant_id, product_id=product_id, patient_id=patient_id,
            provider_id=provider_id, service_group_id=None,
            status=PurchasedServiceStatus.ACTIVE, is_deleted=False,
        ).first()
        if existing is not None:
            channel = ServiceChannel.query.filter_by(
                purchased_service_id=existing.id, is_deleted=False,
            ).first()
            return existing, channel, False

        purchase, channel = ActivationService._build_entitlement_and_channel(
            product=product, config=config, tenant_id=tenant_id, patient=patient,
            provider_type=provider_type, provider_id=provider_id,
            provider_user_ids=[provider_user_id], order_id=order_id,
            actor_id=actor_id,
        )

        # The pre-check above is racy — two concurrent/retried activations can
        # both pass it. ``ux_purchased_services_active_individual`` is the real
        # guard: the loser's commit raises, and we return the winner's channel
        # instead of a duplicate.
        from sqlalchemy.exc import IntegrityError
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            existing = PurchasedService.query.filter_by(
                tenant_id=tenant_id, product_id=product_id, patient_id=patient_id,
                provider_id=provider_id, service_group_id=None,
                status=PurchasedServiceStatus.ACTIVE, is_deleted=False,
            ).first()
            if existing is not None:
                ch = ServiceChannel.query.filter_by(
                    purchased_service_id=existing.id, is_deleted=False,
                ).first()
                return existing, ch, False
            raise
        logger.info(
            '[SERVICE-COMM] activated purchase=%s channel=%s product=%s patient=%s',
            purchase.id, channel.id, product_id, patient_id,
        )
        return purchase, channel, True

    @staticmethod
    def activate_group(
        *, group_id, patient_id, tenant_id, order_id=None, actor_id=None,
    ):
        """Activate a group service offering for a patient.

        Mints, in ONE transaction (all-or-nothing):
          * a GROUP_PER_DOCTOR entitlement + 1:1 channel for EACH serving doctor
            (patient ↔ that doctor), each with its own quota/validity; and
          * one GROUP_SHARED entitlement + group channel holding the patient +
            EVERY serving doctor.

        Idempotent: re-invocation returns the existing channels rather than
        minting duplicates, and a partial re-run after a crash finds nothing
        committed (single commit at the end) so there is no half-built state.

        Returns ``(member_channels, group_channel, group)`` where
        ``member_channels`` is a list of ``(purchase, channel)`` — one per doctor.
        """
        group = MarketplaceServiceGroup.query.filter_by(
            id=group_id, tenant_id=tenant_id,
            approval_status='approved', is_active=True,
        ).first()
        if group is None:
            raise ServiceCommunicationError(
                'Group offering not found or not approved', 404,
            )

        product = DoctorProduct.query.filter_by(
            id=group.product_id, tenant_id=tenant_id, is_deleted=False,
        ).first()
        if product is None:
            raise ServiceCommunicationError('Product not found', 404)

        config = ConfigService.get_for_product(group.product_id, tenant_id)
        if config is None or not config.is_enabled:
            raise ServiceCommunicationError(
                'This product does not include communication. Enable it on the '
                'product first.', 400,
            )

        patient = Patient.query.filter_by(
            id=patient_id, tenant_id=tenant_id,
        ).first()
        if patient is None:
            raise ServiceCommunicationError('Patient not found', 404)

        # Serving doctors = accepted members (the lead is an accepted member).
        # Resolve each to its owning user, skipping any without a linked account
        # and de-duplicating so one user never lands in a channel twice.
        accepted = [m for m in group.members if m.status == 'accepted']
        resolved = []  # [(doctor_id, provider_user_id)]
        seen_uids = set()
        for m in accepted:
            uid = resolve_provider_user_id(
                MembershipVertical.DOCTOR, m.doctor_id, tenant_id,
            )
            if uid is None or uid in seen_uids:
                continue
            seen_uids.add(uid)
            resolved.append((m.doctor_id, uid))
        if not resolved:
            raise ServiceCommunicationError(
                'No group doctor has a linked user account to serve this '
                'channel.', 400,
            )

        from sqlalchemy.exc import IntegrityError

        def _get_or_build(*, filter_kwargs, build_kwargs):
            """Idempotent, race-safe create-or-return within the open txn.

            The unique pre-check is racy, so the INSERT runs in a SAVEPOINT
            (``begin_nested``): a raced duplicate hits
            ``ux_purchased_services_active_group``, we roll the savepoint back
            (outer txn survives) and return the winner's row.
            """
            existing = PurchasedService.query.filter_by(**filter_kwargs).first()
            if existing is not None:
                ch = ServiceChannel.query.filter_by(
                    purchased_service_id=existing.id, is_deleted=False,
                ).first()
                return existing, ch
            try:
                with db.session.begin_nested():
                    purchase, channel = (
                        ActivationService._build_entitlement_and_channel(
                            **build_kwargs)
                    )
                return purchase, channel
            except IntegrityError:
                existing = PurchasedService.query.filter_by(**filter_kwargs).first()
                ch = ServiceChannel.query.filter_by(
                    purchased_service_id=existing.id, is_deleted=False,
                ).first() if existing is not None else None
                return existing, ch

        base = dict(
            tenant_id=tenant_id, patient_id=patient.id,
            service_group_id=group.id,
            status=PurchasedServiceStatus.ACTIVE, is_deleted=False,
        )

        # ── N per-doctor 1:1 legs ────────────────────────────────────────
        member_channels = []
        for doctor_id, uid in resolved:
            purchase, channel = _get_or_build(
                filter_kwargs=dict(
                    base, product_id=product.id, provider_id=doctor_id,
                    kind=PurchasedServiceKind.GROUP_PER_DOCTOR,
                ),
                build_kwargs=dict(
                    product=product, config=config, tenant_id=tenant_id,
                    patient=patient, provider_type=MembershipVertical.DOCTOR,
                    provider_id=doctor_id, provider_user_ids=[uid],
                    order_id=order_id, actor_id=actor_id,
                    service_group_id=group.id,
                    kind=PurchasedServiceKind.GROUP_PER_DOCTOR,
                    channel_kind=ServiceChannelKind.SINGLE,
                ),
            )
            if purchase is not None and channel is not None:
                member_channels.append((purchase, channel))

        # ── One shared group channel (patient + all serving doctors) ─────
        # Nominal owner = the lead doctor; ``kind=GROUP_SHARED`` keeps this row
        # from colliding with the lead's own per-doctor leg.
        group_purchase, group_channel = _get_or_build(
            filter_kwargs=dict(
                base, kind=PurchasedServiceKind.GROUP_SHARED,
            ),
            build_kwargs=dict(
                product=product, config=config, tenant_id=tenant_id,
                patient=patient, provider_type=MembershipVertical.DOCTOR,
                provider_id=group.created_by_doctor_id,
                provider_user_ids=[uid for _, uid in resolved],
                order_id=order_id, actor_id=actor_id,
                service_group_id=group.id,
                kind=PurchasedServiceKind.GROUP_SHARED,
                channel_kind=ServiceChannelKind.GROUP,
            ),
        )

        db.session.commit()
        logger.info(
            '[SERVICE-COMM] activated group=%s patient=%s legs=%d group_channel=%s',
            group.id, patient.id, len(member_channels),
            group_channel.id if group_channel else None,
        )
        return member_channels, group_channel, group

    @staticmethod
    def expire_if_due(purchase, channel=None):
        """Flip an elapsed entitlement to expired + its channel to read-only.

        Called lazily on read so behaviour is correct even when the background
        job isn't running (APScheduler is an optional import), and by the job
        itself. Returns True when something changed.
        """
        if purchase.status != PurchasedServiceStatus.ACTIVE:
            return False
        if purchase.valid_until is None or purchase.valid_until > utcnow():
            return False

        now = utcnow()
        purchase.status = PurchasedServiceStatus.EXPIRED
        purchase.expired_at = now

        channel = channel or ServiceChannel.query.filter_by(
            purchased_service_id=purchase.id, is_deleted=False,
        ).first()
        if channel is not None and channel.status == ServiceChannelStatus.ACTIVE:
            channel.status = ServiceChannelStatus.READ_ONLY
            channel.read_only_at = now
            record_event(channel, ChannelEventType.SERVICE_EXPIRED, payload={})
        return True


def record_event(channel, event_type, payload=None, actor_participant_id=None):
    """Append a system entry to the channel's audit timeline.

    Deliberately a plain function: every phase (calls, documents, forms,
    retention) writes events, and routing them all through one helper is what
    keeps the timeline complete.
    """
    event = ChannelEvent(
        tenant_id=channel.tenant_id,
        channel_id=channel.id,
        actor_participant_id=actor_participant_id,
        event_type=event_type,
        payload=payload or {},
    )
    db.session.add(event)
    return event


def participant_for_user(channel_id, user_id, tenant_id):
    """The caller's participant row in a channel, or None if they aren't in it.

    Authorization for every channel-scoped endpoint keys off this: membership
    in the channel is the permission.
    """
    return ChannelParticipant.query.filter_by(
        tenant_id=tenant_id, channel_id=channel_id, user_id=user_id,
        is_deleted=False,
    ).first()


def load_channel_context(channel_id, user_id, tenant_id):
    """Resolve (channel, participant, purchase) for a channel-scoped request.

    Central gate every message/call/document endpoint calls first. Raises
    ``ServiceCommunicationError`` with the right status:
      * 404 when the caller isn't a participant (existence is itself private).
      * expires the entitlement lazily so state is correct without the job.

    Returns the trio; callers apply the feature-specific checks (chat_enabled,
    can_send, ...) on top.
    """
    participant = participant_for_user(channel_id, user_id, tenant_id)
    if participant is None:
        raise ServiceCommunicationError('Channel not found', 404)

    channel = ServiceChannel.query.filter_by(
        id=channel_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if channel is None:
        raise ServiceCommunicationError('Channel not found', 404)

    purchase = PurchasedService.query.filter_by(
        id=channel.purchased_service_id,
    ).first()
    if purchase is not None and ActivationService.expire_if_due(purchase, channel):
        db.session.commit()

    return channel, participant, purchase


class HoldingChannelService:
    """The vendor "holding" channel — a non-purchase ServiceChannel between a
    held vendor (trial-ended / inactive / pending verification) and the tenant
    admins. Chat + documents flow both ways; only the ADMIN can schedule calls.
    """

    @staticmethod
    def _tenant_admin_user_ids(tenant_id):
        from app.models import User, UserRole
        rows = User.query.filter(
            User.tenant_id == tenant_id,
            User.role.in_([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]),
        ).all()
        return [u.id for u in rows]

    @staticmethod
    def get_or_create(tenant_id, doctor):
        """Return (creating never fails on a re-run) the doctor's holding
        channel, minting it + its participants on first call. Idempotent."""
        from app.models import (
            ServiceChannel, ChannelParticipant, ChannelParticipantRole,
            ServiceChannelKind, ServiceChannelStatus,
        )
        channel = ServiceChannel.query.filter_by(
            tenant_id=tenant_id, held_doctor_id=doctor.id, is_deleted=False,
        ).first()
        if channel is None:
            channel = ServiceChannel(
                tenant_id=tenant_id, held_doctor_id=doctor.id,
                purchased_service_id=None,
                kind=ServiceChannelKind.SINGLE,
                status=ServiceChannelStatus.ACTIVE,
            )
            db.session.add(channel)
            db.session.flush()

        # Vendor participant (PROVIDER — they can chat/send docs, never call).
        HoldingChannelService._ensure_participant(
            channel, doctor.user_id, ChannelParticipantRole.PROVIDER, tenant_id,
        )
        # Admin participants (ADMIN — the only ones who may schedule a call).
        for admin_uid in HoldingChannelService._tenant_admin_user_ids(tenant_id):
            HoldingChannelService._ensure_participant(
                channel, admin_uid, ChannelParticipantRole.ADMIN, tenant_id,
            )
        db.session.flush()
        return channel

    @staticmethod
    def get_or_create_for_user(tenant_id, user):
        """Holding channel for ANY held user (patient, sub-admin, …) that has no
        doctors row. Keyed on held_user_id. Idempotent."""
        from app.models import (
            ServiceChannel, ChannelParticipantRole,
            ServiceChannelKind, ServiceChannelStatus,
        )
        channel = ServiceChannel.query.filter_by(
            tenant_id=tenant_id, held_user_id=user.id, is_deleted=False,
        ).first()
        if channel is None:
            channel = ServiceChannel(
                tenant_id=tenant_id, held_user_id=user.id,
                purchased_service_id=None,
                kind=ServiceChannelKind.SINGLE,
                status=ServiceChannelStatus.ACTIVE,
            )
            db.session.add(channel)
            db.session.flush()
        HoldingChannelService._ensure_participant(
            channel, user.id, ChannelParticipantRole.PROVIDER, tenant_id,
        )
        for admin_uid in HoldingChannelService._tenant_admin_user_ids(tenant_id):
            HoldingChannelService._ensure_participant(
                channel, admin_uid, ChannelParticipantRole.ADMIN, tenant_id,
            )
        db.session.flush()
        return channel

    @staticmethod
    def _ensure_participant(channel, user_id, role, tenant_id):
        from app.models import ChannelParticipant
        if not user_id:
            return
        existing = ChannelParticipant.query.filter_by(
            tenant_id=tenant_id, channel_id=channel.id, user_id=user_id,
            is_deleted=False,
        ).first()
        if existing is None:
            db.session.add(ChannelParticipant(
                tenant_id=tenant_id, channel_id=channel.id,
                user_id=user_id, role=role, can_send=True,
            ))


class SellerSupportChannelService:
    """The seller-support channel — the tenant's admins talking to their
    SELLER (vendor, or parent apex) over the full channel stack: chat,
    documents, scheduled video/audio calls. One channel per tenant,
    anchored on ``support_seller_tenant_id``; counts as a holding
    channel, with the SELLER staff in the operator (ADMIN) seat and the
    tenant's admins as PROVIDER participants.

    The seller's participant rows are CROSS-TENANT on purpose: user_id
    belongs to the seller tenant while tenant_id is stamped with the
    channel's (customer) tenant, so ``participant_for_user`` under the
    customer's request context finds them like any other member.
    """

    @staticmethod
    def seller_tenant_for(tenant):
        from app.models import Tenant
        if tenant is not None and tenant.parent_tenant_id:
            seller = Tenant.query.filter_by(
                id=tenant.parent_tenant_id, is_deleted=False).first()
            if seller is not None:
                return seller
        return Tenant.query.filter_by(
            is_platform=True, is_deleted=False).first()

    @classmethod
    def get_or_create(cls, tenant):
        """The tenant's support channel, minted on first use. Adds the
        tenant's admins (PROVIDER seats); seller staff join lazily via
        ``ensure_seller_participant``. Idempotent, flush-only."""
        from app.models import (
            ChannelParticipantRole, ServiceChannel, ServiceChannelKind,
            ServiceChannelStatus,
        )
        seller = cls.seller_tenant_for(tenant)
        if seller is None:
            raise ServiceCommunicationError('No seller found', 500)
        channel = ServiceChannel.query.filter(
            ServiceChannel.tenant_id == tenant.id,
            ServiceChannel.support_seller_tenant_id.isnot(None),
            ServiceChannel.is_deleted.is_(False),
        ).first()
        if channel is None:
            channel = ServiceChannel(
                tenant_id=tenant.id,
                support_seller_tenant_id=seller.id,
                purchased_service_id=None,
                kind=ServiceChannelKind.SINGLE,
                status=ServiceChannelStatus.ACTIVE,
            )
            db.session.add(channel)
            db.session.flush()
        for uid in HoldingChannelService._tenant_admin_user_ids(tenant.id):
            HoldingChannelService._ensure_participant(
                channel, uid, ChannelParticipantRole.PROVIDER, tenant.id,
            )
        db.session.flush()
        return channel

    @staticmethod
    def ensure_seller_participant(channel, seller_user_id):
        """Seat one seller staff user on the channel (operator/ADMIN).
        tenant_id is the CHANNEL's tenant — see the class docstring."""
        from app.models import ChannelParticipantRole
        HoldingChannelService._ensure_participant(
            channel, seller_user_id, ChannelParticipantRole.ADMIN,
            channel.tenant_id,
        )
        db.session.flush()


class SecondOpinionService:
    """Family-doctor "second opinion" channel — a purchase-less, holding-less
    ServiceChannel keyed on a prescription, between the patient's family doctor
    and the patient. Capped at 5 messages and 5-minute calls. Reuses the whole
    Service Communication chat/call stack (message + scheduled-call endpoints)."""

    MAX_MESSAGES = 5
    MAX_CALL_SECONDS = 300

    @staticmethod
    def get_or_create(tenant_id, doctor, patient, prescription):
        from app.models import (
            ServiceChannel, ChannelParticipantRole,
            ServiceChannelKind, ServiceChannelStatus,
        )
        channel = ServiceChannel.query.filter_by(
            tenant_id=tenant_id, prescription_id=prescription.id, is_deleted=False,
        ).first()
        if channel is None:
            channel = ServiceChannel(
                tenant_id=tenant_id,
                purchased_service_id=None,
                prescription_id=prescription.id,
                kind=ServiceChannelKind.SINGLE,
                status=ServiceChannelStatus.ACTIVE,
                max_messages=SecondOpinionService.MAX_MESSAGES,
                max_call_seconds=SecondOpinionService.MAX_CALL_SECONDS,
            )
            db.session.add(channel)
            db.session.flush()
        # The family doctor (PROVIDER — may chat + schedule calls) and the
        # patient (PATIENT — may chat + join calls).
        HoldingChannelService._ensure_participant(
            channel, doctor.user_id, ChannelParticipantRole.PROVIDER, tenant_id,
        )
        HoldingChannelService._ensure_participant(
            channel, patient.user_id, ChannelParticipantRole.PATIENT, tenant_id,
        )
        db.session.commit()
        return channel


class MessageService:
    """Persisted chat. DB is the source of truth (a realtime transport, when
    added, only broadcasts what is written here first)."""

    # ``body`` cap — long enough for a real message, short enough that a single
    # request can't be used to dump megabytes into the table.
    MAX_BODY_CHARS = 8000
    # Flood guard: an identical body from the same sender within this many
    # seconds is rejected as a duplicate (double-tap, copy-paste spam).
    DUP_WINDOW_SECONDS = 10

    @staticmethod
    def _assert_can_send(channel, participant, purchase):
        """Every reason a send is refused, in one place."""
        from app.models import ServiceChannelStatus

        if channel.status != ServiceChannelStatus.ACTIVE:
            raise ServiceCommunicationError(
                'This conversation is read-only — the service has ended.', 403,
            )
        # A holding channel (admin ↔ held vendor) and a family-doctor
        # second-opinion channel (keyed on a prescription) have no purchase —
        # chat is always on; only membership + the per-participant mute apply.
        if not channel.is_holding and channel.prescription_id is None:
            if purchase is None or not purchase.is_live():
                raise ServiceCommunicationError(
                    'This conversation is read-only — the service has ended.', 403,
                )
            if not purchase.chat_enabled:
                raise ServiceCommunicationError(
                    'Chat is not included in this service.', 403,
                )
        if not participant.can_send:
            raise ServiceCommunicationError(
                'You do not have permission to send messages here.', 403,
            )

    @staticmethod
    def send(channel_id, user_id, tenant_id, body, client_msg_id=None):
        """Persist one message and return it. Idempotent on ``client_msg_id``.

        Ordering is deliberate: validate → dedup → persist → stamp the channel.
        A realtime layer broadcasts the returned row; it never originates one.
        """
        from app.models import ChannelMessage, ChannelMessageKind

        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        MessageService._assert_can_send(channel, participant, purchase)

        # Second-opinion channels are capped (5 messages). When the cap is hit
        # the channel is flipped read-only so both sides see it end.
        if channel.max_messages is not None:
            sent = ChannelMessage.query.filter_by(
                tenant_id=tenant_id, channel_id=channel_id, is_deleted=False,
            ).count()
            if sent >= channel.max_messages:
                if channel.read_only_at is None:
                    channel.read_only_at = utcnow()
                    db.session.commit()
                raise ServiceCommunicationError(
                    f'This second-opinion chat is limited to {channel.max_messages} '
                    'messages, which have been used.', 403,
                )

        body = (body or '').strip()
        if not body:
            raise ServiceCommunicationError('Message cannot be empty.', 400)
        if len(body) > MessageService.MAX_BODY_CHARS:
            raise ServiceCommunicationError(
                f'Message is too long (max {MessageService.MAX_BODY_CHARS} '
                'characters).', 400,
            )

        # Idempotency: a retried send (flaky client) returns the original row
        # rather than duplicating it.
        if client_msg_id:
            existing = ChannelMessage.query.filter_by(
                tenant_id=tenant_id, channel_id=channel_id,
                client_msg_id=client_msg_id, is_deleted=False,
            ).first()
            if existing is not None:
                return existing, False

        # Flood guard — same sender, same text, within the window.
        window_start = utcnow() - timedelta(seconds=MessageService.DUP_WINDOW_SECONDS)
        dup = ChannelMessage.query.filter(
            ChannelMessage.tenant_id == tenant_id,
            ChannelMessage.channel_id == channel_id,
            ChannelMessage.sender_participant_id == participant.id,
            ChannelMessage.body == body,
            ChannelMessage.created_at >= window_start,
            ChannelMessage.is_deleted.is_(False),
        ).first()
        if dup is not None:
            raise ServiceCommunicationError(
                'You just sent that — please wait before repeating a message.', 429,
            )

        message = ChannelMessage(
            tenant_id=tenant_id,
            channel_id=channel_id,
            sender_participant_id=participant.id,
            kind=ChannelMessageKind.TEXT,
            body=body,
            client_msg_id=client_msg_id,
            **_on_behalf_fields(),
        )
        db.session.add(message)

        channel.last_message_at = utcnow()
        db.session.commit()
        return message, True

    @staticmethod
    def history(channel_id, user_id, tenant_id, before=None, limit=50):
        """A page of messages, newest-first, for infinite-scroll-up.

        ``before`` is a message ``created_at`` ISO string — pass the oldest
        message you have to page further back. Returned oldest-first so the UI
        can append without re-sorting.
        """
        from app.models import ChannelMessage

        # Authorization only — expiry doesn't block reads (history stays
        # visible forever until retention).
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)

        limit = max(1, min(int(limit or 50), 100))
        query = ChannelMessage.query.filter_by(
            tenant_id=tenant_id, channel_id=channel_id, is_deleted=False,
        )
        if before:
            from datetime import datetime
            try:
                cutoff = datetime.fromisoformat(before)
                query = query.filter(ChannelMessage.created_at < cutoff)
            except (ValueError, TypeError):
                pass

        rows = (
            query.order_by(ChannelMessage.created_at.desc()).limit(limit + 1).all()
        )
        has_more = len(rows) > limit
        rows = rows[:limit]
        rows.reverse()  # oldest-first for the UI
        return rows, has_more

    @staticmethod
    def mark_read(channel_id, user_id, tenant_id):
        """Stamp the caller's ``last_read_at`` = now. Cheap unread-count basis."""
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)
        participant.last_read_at = utcnow()
        db.session.commit()
        return participant


def _connected_seconds(sessions, call_end):
    """Seconds during which at least TWO participants were simultaneously present.

    This is the billable quantity — "actual connected duration", not scheduled
    length. For the canonical example (provider joins 10:02, patient 10:07,
    call ends 10:20) the answer is 13 min = the window both were on the call,
    not the 30-minute booking.

    Sessions are first collapsed PER PARTICIPANT into their presence union, so
    a single human with two overlapping sessions (a double-clicked / raced
    join) counts as one present participant, never two — otherwise one person
    alone on the call would be billed as if two were connected. Then an
    interval sweep counts wall-clock time whenever >= 2 *distinct* participants
    are present, which also stays correct for a future group call.

    Sessions without a ``participant_id`` (e.g. bare test doubles) each count as
    a distinct participant via their object identity.
    """
    from collections import defaultdict

    by_participant = defaultdict(list)
    for s in sessions:
        start = s.joined_at
        end = s.left_at or call_end or utcnow()
        if not start or end <= start:
            continue
        key = getattr(s, 'participant_id', None) or id(s)
        by_participant[key].append((start, end))

    events = []
    for intervals in by_participant.values():
        # Merge this participant's own overlapping intervals into a union so
        # their presence contributes at most +1 at any instant.
        intervals.sort(key=lambda iv: iv[0])
        merged_start, merged_end = intervals[0]
        for st, en in intervals[1:]:
            if st <= merged_end:
                merged_end = max(merged_end, en)
            else:
                events.append((merged_start, 1))
                events.append((merged_end, -1))
                merged_start, merged_end = st, en
        events.append((merged_start, 1))
        events.append((merged_end, -1))

    if not events:
        return 0
    # Joins before leaves at an identical timestamp so a hand-off doesn't
    # momentarily drop below 2.
    events.sort(key=lambda e: (e[0], -e[1]))
    present = 0
    connected = 0.0
    prev_t = None
    for t, delta in events:
        if prev_t is not None and present >= 2:
            connected += (t - prev_t).total_seconds()
        present += delta
        prev_t = t
    return int(connected)


class CallService:
    """Scheduled audio/video calls inside a channel.

    Scheduling is PROVIDER-only (a patient may propose a time and accept, but
    never schedule — the clinic-appointment model). Quota is metered on real
    connected duration via ``CallSession`` join/leave, finalized when the call
    ends. The Twilio room is a thin add-on: when Twilio is configured a join
    returns a token, but the scheduling + duration + quota logic all work
    without it, which is also what makes them testable in dev.
    """

    ROOM_PREFIX = 'svc'  # never collides with the appointment system's 'appt-'

    @staticmethod
    def _mode_enabled(purchase, mode):
        from app.models import ScheduledCallMode
        if mode == ScheduledCallMode.AUDIO:
            return bool(purchase.audio_enabled)
        if mode == ScheduledCallMode.VIDEO:
            return bool(purchase.video_enabled)
        return False

    @staticmethod
    def _quota_for(purchase, mode):
        from app.models import ScheduledCallMode
        if mode == ScheduledCallMode.AUDIO:
            return purchase.audio_minutes_quota, purchase.audio_minutes_used
        return purchase.video_minutes_quota, purchase.video_minutes_used

    @staticmethod
    def _quota_exhausted(purchase, mode):
        quota, used = CallService._quota_for(purchase, mode)
        return quota is not None and used >= quota

    @staticmethod
    def _require_scheduler(channel, participant):
        """Who may schedule a call. Normal channels: the PROVIDER. Holding
        channels: only the ADMIN (the held vendor can chat but never call)."""
        from app.models import ChannelParticipantRole
        if getattr(channel, 'is_holding', False):
            if participant.role != ChannelParticipantRole.ADMIN:
                raise ServiceCommunicationError(
                    'Only the admin can schedule calls on this channel.', 403,
                )
            return
        if participant.role != ChannelParticipantRole.PROVIDER:
            raise ServiceCommunicationError(
                'Only the provider can schedule calls. You can propose a time '
                'in the chat and the provider will set it up.', 403,
            )

    @staticmethod
    def schedule(channel_id, user_id, tenant_id, mode, start, end):
        """Provider (or, on a holding channel, admin) schedules a call."""
        from datetime import datetime
        from app.models import (
            ScheduledCall, ScheduledCallMode, ScheduledCallStatus,
            ServiceChannelStatus, ChannelEventType,
        )

        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        CallService._require_scheduler(channel, participant)

        if channel.status != ServiceChannelStatus.ACTIVE:
            raise ServiceCommunicationError(
                'The service has ended — no new calls can be scheduled.', 403,
            )

        try:
            mode = ScheduledCallMode(mode)
        except (ValueError, TypeError):
            raise ServiceCommunicationError('mode must be audio or video.', 400)

        # Holding channels and family-doctor second-opinion channels have no
        # purchase → no mode gating / plan quota. Normal channels enforce the
        # purchased service's terms.
        if not channel.is_holding and channel.prescription_id is None:
            if purchase is None or not purchase.is_live():
                raise ServiceCommunicationError(
                    'The service has ended — no new calls can be scheduled.', 403,
                )
            if not CallService._mode_enabled(purchase, mode):
                raise ServiceCommunicationError(
                    f'{mode.value.title()} calls are not included in this service.', 403,
                )
            if CallService._quota_exhausted(purchase, mode):
                raise ServiceCommunicationError(
                    f'The {mode.value} call minutes for this service are used up.', 403,
                )

        def _parse(ts):
            if isinstance(ts, datetime):
                return ts
            try:
                return datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
            except (ValueError, TypeError):
                raise ServiceCommunicationError(
                    'scheduled_start / scheduled_end must be ISO timestamps.', 400,
                )

        start_dt, end_dt = _parse(start), _parse(end)
        if end_dt <= start_dt:
            raise ServiceCommunicationError(
                'The call end time must be after its start time.', 400,
            )
        # Second-opinion calls are capped (5 minutes): clamp the window.
        if channel.max_call_seconds:
            max_end = start_dt + timedelta(seconds=channel.max_call_seconds)
            if end_dt > max_end:
                end_dt = max_end

        # The serving doctor(s) must be free then — no overlap with their
        # consultations or other scheduled calls (and vice versa).
        from app.common.scheduling_conflicts import find_conflict, serving_doctor_ids
        for did in serving_doctor_ids(channel, tenant_id):
            conflict = find_conflict(did, tenant_id, start_dt, end_dt)
            if conflict:
                raise ServiceCommunicationError(conflict, 409)

        call = ScheduledCall(
            tenant_id=tenant_id, channel_id=channel_id,
            created_by_participant_id=participant.id,
            mode=mode, status=ScheduledCallStatus.SCHEDULED,
            scheduled_start=start_dt, scheduled_end=end_dt,
            created_by_id=user_id,
        )
        db.session.add(call)
        db.session.flush()
        record_event(
            channel, ChannelEventType.CALL_SCHEDULED,
            payload={'call_id': str(call.id), 'mode': mode.value,
                     'scheduled_start': start_dt.isoformat()},
            actor_participant_id=participant.id,
        )
        db.session.commit()
        return call

    @staticmethod
    def propose(channel_id, user_id, tenant_id, suggested_time, note=None):
        """Patient proposes a time — a chat message the provider acts on.

        The patient can't create a real ScheduledCall (that stays
        provider-only), so a proposal is a first-class chat message of kind
        ``proposal`` carrying the suggested slot.
        """
        from app.models import (
            ChannelMessage, ChannelMessageKind, ServiceChannelStatus,
        )
        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        if channel.status != ServiceChannelStatus.ACTIVE:
            raise ServiceCommunicationError('The service has ended.', 403)
        # Holding + family-doctor second-opinion channels have no purchase, so
        # the purchase-liveness gate only applies to normal purchased services
        # (mirrors send / schedule). The patient can still propose a call time.
        if not channel.is_holding and channel.prescription_id is None:
            if purchase is None or not purchase.is_live():
                raise ServiceCommunicationError('The service has ended.', 403)
        # A proposal writes a persisted message, so it must clear the same
        # gates a chat send does — otherwise a muted participant, or one on a
        # calls-only/chat-disabled service, could inject messages this way.
        if not participant.can_send:
            raise ServiceCommunicationError(
                'You do not have permission to post here.', 403,
            )
        # And it only makes sense when the service actually offers calls. Holding
        # + second-opinion channels have no purchase and always offer calls, so
        # this gate applies only to normal purchased services.
        if purchase is not None and not (purchase.audio_enabled or purchase.video_enabled):
            raise ServiceCommunicationError(
                'This service does not include calls.', 403,
            )

        body = f'📅 Proposed call time: {suggested_time}'
        if note:
            body += f'\n{note}'
        message = ChannelMessage(
            tenant_id=tenant_id, channel_id=channel_id,
            sender_participant_id=participant.id,
            kind=ChannelMessageKind.PROPOSAL, body=body,
            **_on_behalf_fields(),
        )
        db.session.add(message)
        channel.last_message_at = utcnow()
        db.session.commit()
        return message

    @staticmethod
    def list_calls(channel_id, user_id, tenant_id):
        from app.models import ScheduledCall
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)
        return (
            ScheduledCall.query
            .filter_by(tenant_id=tenant_id, channel_id=channel_id, is_deleted=False)
            .order_by(ScheduledCall.scheduled_start.desc())
            .all()
        )

    @staticmethod
    def _load_call(channel_id, call_id, user_id, tenant_id):
        from app.models import ScheduledCall
        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        call = ScheduledCall.query.filter_by(
            id=call_id, tenant_id=tenant_id, channel_id=channel_id,
            is_deleted=False,
        ).first()
        if call is None:
            raise ServiceCommunicationError('Call not found', 404)
        return channel, participant, purchase, call

    @staticmethod
    def accept(channel_id, call_id, user_id, tenant_id):
        """Patient accepts a scheduled call."""
        from app.models import (
            ChannelParticipantRole, ScheduledCallStatus, ChannelEventType,
        )
        channel, participant, _purchase, call = CallService._load_call(
            channel_id, call_id, user_id, tenant_id,
        )
        # On a holding channel the admin schedules and the held user accepts —
        # there is no patient. Elsewhere, only the patient accepts.
        if not channel.is_holding and participant.role != ChannelParticipantRole.PATIENT:
            raise ServiceCommunicationError('Only the patient accepts a call.', 403)
        if call.status not in (ScheduledCallStatus.SCHEDULED,):
            raise ServiceCommunicationError(
                'This call can no longer be accepted.', 409,
            )
        call.status = ScheduledCallStatus.ACCEPTED
        call.patient_accepted_at = utcnow()
        record_event(channel, ChannelEventType.CALL_ACCEPTED,
                     payload={'call_id': str(call.id)},
                     actor_participant_id=participant.id)
        db.session.commit()
        return call

    @staticmethod
    def cancel(channel_id, call_id, user_id, tenant_id):
        """Cancel a call that hasn't started. An in-progress call must be ENDED,
        not cancelled — cancelling would drop the minutes already consumed
        without billing them."""
        from app.models import ScheduledCallStatus, ChannelEventType
        channel, participant, _purchase, call = CallService._load_call(
            channel_id, call_id, user_id, tenant_id,
        )
        if call.status in (ScheduledCallStatus.COMPLETED,
                           ScheduledCallStatus.CANCELLED,
                           ScheduledCallStatus.NO_SHOW):
            raise ServiceCommunicationError('This call is already closed.', 409)
        if call.status == ScheduledCallStatus.IN_PROGRESS:
            raise ServiceCommunicationError(
                'This call is in progress — end it instead of cancelling.', 409,
            )
        call.status = ScheduledCallStatus.CANCELLED
        record_event(channel, ChannelEventType.CALL_CANCELLED,
                     payload={'call_id': str(call.id)},
                     actor_participant_id=participant.id)
        db.session.commit()
        return call

    @staticmethod
    def join(channel_id, call_id, user_id, tenant_id):
        """A participant joins a call.

        Opens a ``CallSession`` (join stamped now), flips the call to
        IN_PROGRESS on first join, and returns a Twilio token WHEN Twilio is
        configured. When it isn't (dev), everything still happens except the
        token — so scheduling + duration + quota remain fully exercisable.
        Blocks the join outright when the minute quota is already exhausted.
        """
        from app.models import (
            CallSession, ScheduledCallStatus, ScheduledCallMode,
            ServiceChannelStatus, ChannelEventType,
        )
        channel, participant, purchase, call = CallService._load_call(
            channel_id, call_id, user_id, tenant_id,
        )
        if channel.status != ServiceChannelStatus.ACTIVE:
            raise ServiceCommunicationError('The service has ended.', 403)
        # A holding channel has no purchase → no service-liveness / quota gate.
        if not channel.is_holding:
            if purchase is None or not purchase.is_live():
                raise ServiceCommunicationError('The service has ended.', 403)
        if call.status in (ScheduledCallStatus.CANCELLED,
                           ScheduledCallStatus.COMPLETED,
                           ScheduledCallStatus.NO_SHOW):
            raise ServiceCommunicationError('This call is not joinable.', 409)
        if not channel.is_holding and CallService._quota_exhausted(purchase, call.mode):
            raise ServiceCommunicationError(
                f'The {call.mode.value} call minutes for this service are used '
                'up.', 403,
            )

        now = utcnow()
        # Reuse an already-open session (double-join / reconnect) rather than
        # stacking rows, so duration math stays honest. The ``ux_call_sessions
        # _open`` partial-unique index makes this safe under a raced double-
        # join: the second INSERT hits the constraint, we roll back to a
        # SAVEPOINT and reuse the row the winner created.
        session = CallSession.query.filter_by(
            tenant_id=tenant_id, scheduled_call_id=call.id,
            participant_id=participant.id, left_at=None,
        ).first()
        if session is None:
            from sqlalchemy.exc import IntegrityError
            try:
                with db.session.begin_nested():
                    session = CallSession(
                        tenant_id=tenant_id, scheduled_call_id=call.id,
                        participant_id=participant.id, joined_at=now,
                    )
                    db.session.add(session)
            except IntegrityError:
                session = CallSession.query.filter_by(
                    tenant_id=tenant_id, scheduled_call_id=call.id,
                    participant_id=participant.id, left_at=None,
                ).first()

        if call.status in (ScheduledCallStatus.SCHEDULED,
                           ScheduledCallStatus.ACCEPTED):
            call.status = ScheduledCallStatus.IN_PROGRESS
            if call.started_at is None:
                call.started_at = now

        if not call.twilio_room_name:
            call.twilio_room_name = f'{CallService.ROOM_PREFIX}-{call.channel_id}-{call.id}'

        record_event(channel, ChannelEventType.PARTICIPANT_JOINED,
                     payload={'call_id': str(call.id)},
                     actor_participant_id=participant.id)
        db.session.commit()

        token, room_configured = CallService._maybe_token(call, participant)
        return call, {
            'room_name': call.twilio_room_name,
            'mode': call.mode.value,
            'token': token,
            'calling_configured': room_configured,
        }

    @staticmethod
    def _maybe_token(call, participant):
        """A Twilio access token when Twilio is configured, else (None, False).

        Reuses the existing ``VideoService`` — the same token/room helper the
        appointment flow uses — but NEVER its ``join_appointment`` (that path
        is appointment-coupled and must stay untouched). Room creation +
        token minting are generic and safe to share.
        """
        try:
            from app.api.common.video.service import VideoService
            name = getattr(participant.user, 'first_name', None) or 'Participant'
            VideoService.create_room(call.twilio_room_name)
            token = VideoService.generate_token(
                f'{name}-{str(participant.id)[:8]}', call.twilio_room_name,
            )
            if call.twilio_room_sid is None:
                # best-effort; room_sid isn't required for the flow
                pass
            return token, True
        except Exception:  # Twilio unconfigured / transient — degrade cleanly
            return None, False

    @staticmethod
    def leave(channel_id, call_id, user_id, tenant_id):
        """A participant leaves. Stamps the session and, if nobody is left,
        finalizes the call (duration + quota).

        The call row is locked FOR UPDATE up front so two participants leaving
        at the same instant serialize: without it, each transaction would still
        see the other's session open, both compute ``still_in == 1``, and the
        call would never finalize — the elapsed minutes silently un-billed and
        the call stuck IN_PROGRESS.
        """
        from app.models import CallSession, ScheduledCall, ScheduledCallStatus
        _channel, participant, _purchase, call = CallService._load_call(
            channel_id, call_id, user_id, tenant_id,
        )
        # Serialize concurrent leaves of the same call.
        locked = ScheduledCall.query.filter_by(id=call.id).with_for_update().first()
        call = locked or call

        now = utcnow()
        session = CallSession.query.filter_by(
            tenant_id=tenant_id, scheduled_call_id=call.id,
            participant_id=participant.id, left_at=None,
        ).first()
        if session is not None:
            session.left_at = now
            session.duration_seconds = int((now - session.joined_at).total_seconds())
        db.session.flush()

        still_in = CallSession.query.filter_by(
            tenant_id=tenant_id, scheduled_call_id=call.id, left_at=None,
        ).count()
        if still_in == 0 and call.status == ScheduledCallStatus.IN_PROGRESS:
            CallService._finalize(call, tenant_id, call_end=now)
        db.session.commit()
        return call

    @staticmethod
    def end(channel_id, call_id, user_id, tenant_id):
        """Scheduler-side party ends the call for everyone → finalize now.

        Uses the same authority check as schedule(): the
        ``_require_provider`` → ``_require_scheduler`` rename (admins
        may run holding-channel calls) missed this call site, leaving
        end() raising AttributeError — every end-call request 500'd.
        """
        channel, participant, _purchase, call = CallService._load_call(
            channel_id, call_id, user_id, tenant_id,
        )
        CallService._require_scheduler(channel, participant)
        CallService._close_open_sessions_and_finalize(call, tenant_id)
        db.session.commit()
        return call

    @staticmethod
    def _close_open_sessions_and_finalize(call, tenant_id, call_end=None):
        from app.models import CallSession, ScheduledCallStatus
        call_end = call_end or utcnow()
        for s in CallSession.query.filter_by(
            tenant_id=tenant_id, scheduled_call_id=call.id, left_at=None,
        ).all():
            s.left_at = call_end
            s.duration_seconds = int((call_end - s.joined_at).total_seconds())
        if call.status not in (ScheduledCallStatus.COMPLETED,
                               ScheduledCallStatus.CANCELLED):
            CallService._finalize(call, tenant_id, call_end=call_end)

    @staticmethod
    def _finalize(call, tenant_id, call_end):
        """Compute connected duration, mark COMPLETED, decrement the quota.

        Idempotent: a second finalize (webhook + leave racing) is a no-op
        because the status guard already flipped to COMPLETED.
        """
        import math
        from app.models import (
            CallSession, PurchasedService, ScheduledCall, ScheduledCallStatus,
            ScheduledCallMode, ServiceChannel, ChannelEventType,
        )
        if call.status == ScheduledCallStatus.COMPLETED:
            return

        sessions = CallSession.query.filter_by(
            tenant_id=tenant_id, scheduled_call_id=call.id,
        ).all()
        connected = _connected_seconds(sessions, call_end)
        call.connected_seconds = connected
        call.ended_at = call_end
        # A call nobody really connected on is a no-show, not a completion.
        call.status = (ScheduledCallStatus.COMPLETED if connected > 0
                       else ScheduledCallStatus.NO_SHOW)

        minutes = int(math.ceil(connected / 60.0)) if connected > 0 else 0
        if minutes > 0:
            channel = ServiceChannel.query.filter_by(id=call.channel_id).first()
            purchase = PurchasedService.query.filter_by(
                id=channel.purchased_service_id,
            ).first() if channel else None
            if purchase is not None:
                if call.mode == ScheduledCallMode.AUDIO:
                    purchase.audio_minutes_used = (purchase.audio_minutes_used or 0) + minutes
                else:
                    purchase.video_minutes_used = (purchase.video_minutes_used or 0) + minutes
            if channel is not None:
                record_event(
                    channel, ChannelEventType.CALL_COMPLETED,
                    payload={'call_id': str(call.id), 'mode': call.mode.value,
                             'connected_seconds': connected,
                             'minutes_charged': minutes},
                )
        return call


class DocumentService:
    """Files uploaded into a channel by either side (S3-backed).

    Explicitly NOT prescriptions — those keep their own untouched flow. Uploads
    are blocked once the service expires (channel read-only), but downloads of
    existing files stay available until retention deletes them.
    """

    ASSET_TYPE = 'medical_document'   # keys the S3 5 MB cap + type allowlist
    FOLDER = 'service-communication/documents'

    @staticmethod
    def upload(channel_id, user_id, tenant_id, file_obj, description=None,
               category=None):
        from app.models import (
            ChannelDocument, ChannelDocumentCategory, ChannelEventType,
            ServiceChannelStatus,
        )
        from app.services.s3_service import S3Service

        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        if channel.status != ServiceChannelStatus.ACTIVE:
            raise ServiceCommunicationError(
                'The service has ended — you can view files but not upload new '
                'ones.', 403,
            )
        # Holding channels always allow document sharing both ways; normal
        # channels enforce the purchased service's terms.
        if not channel.is_holding:
            if purchase is None or not purchase.is_live():
                raise ServiceCommunicationError(
                    'The service has ended — you can view files but not upload new '
                    'ones.', 403,
                )
            if not purchase.documents_enabled:
                raise ServiceCommunicationError(
                    'Document sharing is not included in this service.', 403,
                )
        if file_obj is None or not getattr(file_obj, 'filename', None):
            raise ServiceCommunicationError('No file provided.', 400)

        # Category is admin-facing metadata; patients/providers only ever
        # UPLOAD (never as 'prescription' — that's a different, untouched flow).
        try:
            cat = (ChannelDocumentCategory(category) if category
                   else ChannelDocumentCategory.UPLOADED)
        except ValueError:
            cat = ChannelDocumentCategory.UPLOADED

        try:
            result = S3Service.upload_file(
                file_obj=file_obj,
                asset_type=DocumentService.ASSET_TYPE,
                original_filename=file_obj.filename,
                is_private=True,
                folder=DocumentService.FOLDER,
            )
        except ValueError as exc:   # size / extension rejection
            raise ServiceCommunicationError(str(exc), 400)

        doc = ChannelDocument(
            tenant_id=tenant_id, channel_id=channel_id,
            uploaded_by_participant_id=participant.id,
            category=cat,
            original_filename=file_obj.filename,
            s3_bucket=result['s3_bucket'], s3_key=result['s3_key'],
            s3_region=result.get('s3_region'),
            content_type=result.get('content_type'),
            file_size_bytes=result.get('file_size_bytes'),
            description=description,
            created_by_id=user_id,
        )
        db.session.add(doc)
        record_event(
            channel, ChannelEventType.DOCUMENT_UPLOADED,
            payload={'filename': file_obj.filename, 'category': cat.value},
            actor_participant_id=participant.id,
        )
        db.session.commit()
        return doc

    @staticmethod
    def list(channel_id, user_id, tenant_id):
        from app.models import ChannelDocument
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)
        return (
            ChannelDocument.query
            .filter_by(tenant_id=tenant_id, channel_id=channel_id, is_deleted=False)
            .order_by(ChannelDocument.created_at.desc())
            .all()
        )

    @staticmethod
    def list_mine(user_id, tenant_id):
        """Every document across ALL channels the caller participates in.

        Backs the unified "My Prescriptions / My Documents" page (patient and
        doctor alike): one flat list, each row annotated with the service it
        belongs to and who uploaded it, so the page needs no per-channel
        drill-down. Authorization stays participant-membership — the join IS
        the filter.
        """
        from app.models import (
            ChannelDocument, ChannelParticipant, PurchasedService, ServiceChannel,
        )
        rows = (
            db.session.query(ChannelDocument, PurchasedService, ChannelParticipant)
            .join(ServiceChannel, ServiceChannel.id == ChannelDocument.channel_id)
            .join(PurchasedService,
                  PurchasedService.id == ServiceChannel.purchased_service_id)
            .join(ChannelParticipant,
                  ChannelParticipant.channel_id == ChannelDocument.channel_id)
            .filter(
                ChannelDocument.tenant_id == tenant_id,
                ChannelDocument.is_deleted.is_(False),
                ChannelParticipant.user_id == user_id,
                ChannelParticipant.is_deleted.is_(False),
            )
            .order_by(ChannelDocument.created_at.desc())
            .all()
        )
        out = []
        for doc, purchase, me in rows:
            item = doc.to_dict()
            item['service_name'] = purchase.product.name if purchase.product else None
            item['my_role'] = me.role.value if me.role else None
            item['uploaded_by_me'] = doc.uploaded_by_participant_id == me.id
            out.append(item)
        return out

    @staticmethod
    def download_url(channel_id, doc_id, user_id, tenant_id):
        """A short-lived presigned URL for one document (participants only)."""
        from app.models import ChannelDocument
        from app.services.s3_service import S3Service
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)
        doc = ChannelDocument.query.filter_by(
            id=doc_id, tenant_id=tenant_id, channel_id=channel_id, is_deleted=False,
        ).first()
        if doc is None:
            raise ServiceCommunicationError('Document not found', 404)
        url = S3Service.generate_presigned_url(doc.s3_bucket, doc.s3_key)
        if not url:
            raise ServiceCommunicationError('Could not generate a download link.', 502)
        return doc, url


class FormService:
    """Structured forms submitted inside a channel."""

    @staticmethod
    def submit(channel_id, user_id, tenant_id, form_key, answers,
               schema_version=1):
        from app.models import (
            ChannelFormResponse, ChannelEventType, ServiceChannelStatus,
        )
        channel, participant, purchase = load_channel_context(
            channel_id, user_id, tenant_id,
        )
        if channel.status != ServiceChannelStatus.ACTIVE or purchase is None \
                or not purchase.is_live():
            raise ServiceCommunicationError('The service has ended.', 403)
        if not purchase.forms_enabled:
            raise ServiceCommunicationError(
                'Forms are not included in this service.', 403,
            )
        if not form_key:
            raise ServiceCommunicationError('form_key is required.', 400)
        if not isinstance(answers, dict):
            raise ServiceCommunicationError('answers must be an object.', 400)

        response = ChannelFormResponse(
            tenant_id=tenant_id, channel_id=channel_id,
            submitted_by_participant_id=participant.id,
            form_key=form_key, schema_version=int(schema_version or 1),
            answers=answers,
        )
        db.session.add(response)
        record_event(
            channel, ChannelEventType.FORM_SUBMITTED,
            payload={'form_key': form_key},
            actor_participant_id=participant.id,
        )
        db.session.commit()
        return response

    @staticmethod
    def list(channel_id, user_id, tenant_id):
        from app.models import ChannelFormResponse
        participant = participant_for_user(channel_id, user_id, tenant_id)
        if participant is None:
            raise ServiceCommunicationError('Channel not found', 404)
        return (
            ChannelFormResponse.query
            .filter_by(tenant_id=tenant_id, channel_id=channel_id, is_deleted=False)
            .order_by(ChannelFormResponse.submitted_at.desc())
            .all()
        )


def channel_timeline(channel_id, user_id, tenant_id):
    """The system audit timeline for a channel (participants only).

    Just the ``ChannelEvent`` rows — the frontend interleaves them with chat
    messages by timestamp so the reader sees "service booked → call scheduled →
    joined → form submitted → expired" inline with the conversation, visually
    distinct from messages.
    """
    from app.models import ChannelEvent
    participant = participant_for_user(channel_id, user_id, tenant_id)
    if participant is None:
        raise ServiceCommunicationError('Channel not found', 404)
    return (
        ChannelEvent.query
        .filter_by(tenant_id=tenant_id, channel_id=channel_id)
        .order_by(ChannelEvent.occurred_at.asc())
        .all()
    )
