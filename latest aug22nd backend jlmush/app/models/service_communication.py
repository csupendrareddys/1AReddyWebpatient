"""Service Communication module — models.

A patient buys an admin-authored Service/Product that *includes* ongoing
communication (nutrition package, mental-wellness plan, chronic-disease
management, legal document assistance...). That purchase gets a dedicated
channel carrying chat, provider-scheduled calls, forms, documents, an audit
timeline and its own call quotas.

ISOLATION CONTRACT — read before adding anything here
-----------------------------------------------------
This module is deliberately independent of the appointment/consultation
system. Nothing in this file may reference ``appointments``, ``time_slots``,
``consultations`` or ``doctor_services``. The existing doctor appointment
flow, the audio/video consultation flow, booking logic, consultation types,
doctor availability and consultation quotas must keep behaving exactly as
they do today.

We reuse *generic* infrastructure (auth, S3, notifications, Twilio, rate
limiting, the FeatureGate/UsageGate patterns) but never the appointment
domain models. This mirrors the precedent set by ``DoctorDocument``
(``app/api/service_provider/doctor/document_routes.py``), which was built as
a prescription sibling without touching prescriptions.

Note we do NOT reuse ``Consultation`` / ``ConsultationMessage``
(``app/models/consultation.py``). They look attractive — tenant-scoped, RLS'd,
attachments + read receipts already modelled — but ``Consultation`` carries a
1:1 FK to ``appointments`` and an appointment-workflow status enum, so reusing
them would couple this module to the very system it must stay clear of. They
are also dead code (zero routes, zero queries).

Shape of the world::

    DoctorProduct (admin catalog, untouched)
        └── ServiceCommunicationConfig   validity / toggles / quotas / retention
                    │  (snapshotted at purchase)
                    ▼
        PurchasedService                 the entitlement + its validity window
                    │
                    ▼
        ServiceChannel                   the container
            ├── ChannelParticipant       2 rows today; group-ready
            ├── ChannelMessage
            ├── ScheduledCall            provider-created only
            ├── CallSession              join/leave → real connected minutes
            ├── ChannelDocument          S3; never a prescription
            ├── ChannelFormResponse
            └── ChannelEvent             audit timeline
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, utcnow,
)
from app.models._enums import (
    ChannelDocumentCategory, ChannelEventType, ChannelMessageKind,
    ChannelParticipantRole, MembershipVertical, PurchasedServiceKind,
    PurchasedServiceStatus, ScheduledCallMode, ScheduledCallStatus,
    ServiceChannelKind, ServiceChannelStatus,
)

# Store the enum ``.value`` (lowercase) rather than the member NAME, matching
# ``doctor_billing.py`` — keeps DB values readable and stable if members move.
_enum_values = lambda e: [x.value for x in e]  # noqa: E731


class ServiceCommunicationConfig(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """Per-product communication terms, authored by the admin.

    One row per ``DoctorProduct`` that is communication-enabled; a product
    without a row simply has no channel. These values are SNAPSHOTTED onto
    ``PurchasedService`` at purchase time, so editing a product later never
    retroactively changes the terms of something already sold.
    """
    __tablename__ = 'service_communication_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    is_enabled = db.Column(db.Boolean, nullable=False, default=False,
                           server_default=db.text('false'), index=True)

    # How long the channel stays writable after activation.
    validity_days = db.Column(db.Integer, nullable=False, default=30,
                              server_default=db.text('30'))

    chat_enabled = db.Column(db.Boolean, nullable=False, default=True,
                             server_default=db.text('true'))
    audio_enabled = db.Column(db.Boolean, nullable=False, default=False,
                              server_default=db.text('false'))
    video_enabled = db.Column(db.Boolean, nullable=False, default=False,
                              server_default=db.text('false'))
    documents_enabled = db.Column(db.Boolean, nullable=False, default=True,
                                  server_default=db.text('true'))
    forms_enabled = db.Column(db.Boolean, nullable=False, default=False,
                              server_default=db.text('false'))

    # Minute budgets. NULL = unlimited; 0 = disabled. Deducted by ACTUAL
    # connected duration (see ``CallSession``), never by scheduled length.
    audio_minutes_quota = db.Column(db.Integer, nullable=True)
    video_minutes_quota = db.Column(db.Integer, nullable=True)

    max_attachment_mb = db.Column(db.Integer, nullable=False, default=5,
                                  server_default=db.text('5'))

    # Days after archival before messages + S3 objects are purged.
    retention_days = db.Column(db.Integer, nullable=False, default=365,
                               server_default=db.text('365'))

    product = db.relationship('DoctorProduct', foreign_keys=[product_id])

    __table_args__ = (
        db.Index(
            'ux_service_comm_config_product', 'tenant_id', 'product_id',
            unique=True, postgresql_where=db.text('is_deleted = false'),
        ),
        db.CheckConstraint('validity_days > 0',
                           name='ck_service_comm_validity_positive'),
        db.CheckConstraint(
            '(audio_minutes_quota IS NULL) OR (audio_minutes_quota >= 0)',
            name='ck_service_comm_audio_quota_nonneg'),
        db.CheckConstraint(
            '(video_minutes_quota IS NULL) OR (video_minutes_quota >= 0)',
            name='ck_service_comm_video_quota_nonneg'),
        db.CheckConstraint('retention_days >= 0',
                           name='ck_service_comm_retention_nonneg'),
        db.CheckConstraint('max_attachment_mb > 0',
                           name='ck_service_comm_attachment_positive'),
    )

    def snapshot(self):
        """The subset copied onto a purchase, so later edits don't rewrite history."""
        return {
            'validity_days': self.validity_days,
            'chat_enabled': self.chat_enabled,
            'audio_enabled': self.audio_enabled,
            'video_enabled': self.video_enabled,
            'documents_enabled': self.documents_enabled,
            'forms_enabled': self.forms_enabled,
            'audio_minutes_quota': self.audio_minutes_quota,
            'video_minutes_quota': self.video_minutes_quota,
            'max_attachment_mb': self.max_attachment_mb,
            'retention_days': self.retention_days,
        }

    def to_dict(self):
        data = {
            'id': str(self.id),
            'product_id': str(self.product_id),
            'is_enabled': self.is_enabled,
        }
        data.update(self.snapshot())
        return data

    def __repr__(self):
        return f'<ServiceCommunicationConfig product={self.product_id}>'


class PurchasedService(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """A patient's entitlement to one purchased service, with its validity window.

    Nothing like this existed before: ``DoctorService`` is a price-list row and
    ``MarketplaceOrder`` carries no dates at all. The order (if any) records the
    *transaction*; this row records the *entitlement*.

    ``provider_type`` / ``provider_id`` are polymorphic — mirroring
    ``MembershipSubscription`` — because a communication service is not always
    doctor-delivered (nutrition, legal assistance, wellness may be clinic- or
    hospital-delivered). No FK is possible across the three target tables, so
    the service layer validates it.
    """
    __tablename__ = 'purchased_services'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='RESTRICT'),
        nullable=False, index=True,
    )
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    provider_type = db.Column(
        db.Enum(MembershipVertical, name='membershipvertical'), nullable=False,
    )
    # Polymorphic — target table varies by provider_type, so no DB-level FK.
    provider_id = db.Column(UUID(as_uuid=True), nullable=False)

    # The transaction this came from, when it came through the marketplace.
    # Nullable because admin can grant/activate a service directly (and the
    # marketplace purchase route is still a stub).
    order_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_orders.order_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    # Set when this entitlement is one leg of a group service purchase (a
    # ``MarketplaceServiceGroup``). NULL for an ordinary individual purchase.
    # ``SET NULL`` so deleting the group definition never orphans a live
    # entitlement — the channel keeps working, it just loses its group tag.
    service_group_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_service_groups.group_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    kind = db.Column(
        db.Enum(PurchasedServiceKind, values_callable=_enum_values),
        nullable=False, default=PurchasedServiceKind.INDIVIDUAL,
        server_default=PurchasedServiceKind.INDIVIDUAL.value, index=True,
    )

    status = db.Column(
        db.Enum(PurchasedServiceStatus, values_callable=_enum_values),
        nullable=False, default=PurchasedServiceStatus.PENDING, index=True,
    )

    valid_from = db.Column(db.DateTime(timezone=True), nullable=True)
    valid_until = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    activated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    expired_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # ── Snapshot of ServiceCommunicationConfig, taken at activation ──────
    # Duplicated on purpose: the terms someone bought must not change when an
    # admin later edits the product.
    validity_days = db.Column(db.Integer, nullable=False, default=30)
    chat_enabled = db.Column(db.Boolean, nullable=False, default=True)
    audio_enabled = db.Column(db.Boolean, nullable=False, default=False)
    video_enabled = db.Column(db.Boolean, nullable=False, default=False)
    documents_enabled = db.Column(db.Boolean, nullable=False, default=True)
    forms_enabled = db.Column(db.Boolean, nullable=False, default=False)
    audio_minutes_quota = db.Column(db.Integer, nullable=True)
    video_minutes_quota = db.Column(db.Integer, nullable=True)
    max_attachment_mb = db.Column(db.Integer, nullable=False, default=5)
    retention_days = db.Column(db.Integer, nullable=False, default=365)

    # Running totals of ACTUAL connected minutes (see CallSession).
    audio_minutes_used = db.Column(db.Integer, nullable=False, default=0,
                                   server_default=db.text('0'))
    video_minutes_used = db.Column(db.Integer, nullable=False, default=0,
                                   server_default=db.text('0'))

    product = db.relationship('DoctorProduct', foreign_keys=[product_id])
    patient = db.relationship('Patient', foreign_keys=[patient_id])

    __table_args__ = (
        db.Index('ix_purchased_services_patient', 'tenant_id', 'patient_id'),
        db.Index('ix_purchased_services_provider',
                 'tenant_id', 'provider_type', 'provider_id'),
        db.Index('ix_purchased_services_expiry', 'status', 'valid_until'),
        # At most ONE active INDIVIDUAL entitlement per (patient, product,
        # provider). The activation service also checks this, but the
        # check-then-insert is racy under concurrent/retried activation — this
        # partial-unique index is the real guard against a duplicate channel.
        # Scoped to ``service_group_id IS NULL`` so it only governs ordinary
        # purchases; group legs are governed by the sibling index below.
        db.Index(
            'ux_purchased_services_active_individual',
            'tenant_id', 'product_id', 'patient_id', 'provider_id',
            unique=True,
            postgresql_where=db.text(
                "status = 'active' AND is_deleted = false "
                "AND service_group_id IS NULL"),
        ),
        # At most ONE active entitlement per (group, patient, kind, provider).
        # ``kind`` is in the key on purpose: the lead doctor holds both a
        # GROUP_PER_DOCTOR leg (provider_id=lead) and the GROUP_SHARED row
        # (also provider_id=lead) for the same group — same provider, different
        # kind, so they coexist instead of colliding. A separate partial index
        # (rather than folding ``service_group_id`` into the one above) is
        # required because Postgres treats each NULL as distinct, which would
        # otherwise silently defeat the individual guard.
        db.Index(
            'ux_purchased_services_active_group',
            'tenant_id', 'service_group_id', 'patient_id', 'kind', 'provider_id',
            unique=True,
            postgresql_where=db.text(
                "status = 'active' AND is_deleted = false "
                "AND service_group_id IS NOT NULL"),
        ),
    )

    def is_live(self, now=None):
        """True when the entitlement is active AND inside its window."""
        if self.status != PurchasedServiceStatus.ACTIVE:
            return False
        now = now or utcnow()
        if self.valid_until is not None and self.valid_until <= now:
            return False
        return True

    def to_dict(self):
        return {
            'id': str(self.id),
            'product_id': str(self.product_id),
            'product_name': self.product.name if self.product else None,
            'patient_id': str(self.patient_id),
            'provider_type': self.provider_type.value if self.provider_type else None,
            'provider_id': str(self.provider_id) if self.provider_id else None,
            'order_id': str(self.order_id) if self.order_id else None,
            'service_group_id': str(self.service_group_id) if self.service_group_id else None,
            'kind': self.kind.value if self.kind else None,
            'status': self.status.value if self.status else None,
            'valid_from': self.valid_from.isoformat() if self.valid_from else None,
            'valid_until': self.valid_until.isoformat() if self.valid_until else None,
            'chat_enabled': self.chat_enabled,
            'audio_enabled': self.audio_enabled,
            'video_enabled': self.video_enabled,
            'documents_enabled': self.documents_enabled,
            'forms_enabled': self.forms_enabled,
            'audio_minutes_quota': self.audio_minutes_quota,
            'video_minutes_quota': self.video_minutes_quota,
            'audio_minutes_used': self.audio_minutes_used,
            'video_minutes_used': self.video_minutes_used,
            'max_attachment_mb': self.max_attachment_mb,
        }

    def __repr__(self):
        return f'<PurchasedService {self.id} patient={self.patient_id} {self.status.value}>'


class ServiceChannel(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """The communication container for one purchased service (1:1)."""
    __tablename__ = 'service_channels'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable: a normal channel hangs off a PurchasedService, but a vendor
    # "holding" channel (admin ↔ held vendor) has no purchase — it is keyed on
    # ``held_doctor_id`` instead. Exactly one of the two is set.
    purchased_service_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('purchased_services.id', ondelete='CASCADE'),
        nullable=True, unique=True, index=True,
    )
    # Set only on a holding channel: the vendor being held. Its presence marks
    # the channel as a holding channel (chat + docs both ways, admin-only calls).
    held_doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, unique=True, index=True,
    )
    # A holding channel for ANY held user (patient, sub-admin, …) that is not a
    # doctor. Either held_doctor_id or held_user_id marks a holding channel.
    held_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=True, unique=True, index=True,
    )
    # Seller-support channel: the tenant's admins talking to their SELLER
    # (the vendor, or the parent apex). One per tenant; the column records
    # who the seller is. Counts as a holding channel — same no-purchase
    # unlocks (chat + docs both ways, seller-scheduled calls). The seller's
    # staff join as cross-tenant participant rows stamped with THIS
    # channel's tenant, so the participant gate stays a same-tenant lookup.
    support_seller_tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    status = db.Column(
        db.Enum(ServiceChannelStatus, values_callable=_enum_values),
        nullable=False, default=ServiceChannelStatus.ACTIVE, index=True,
    )
    # SINGLE (patient + one provider) or GROUP (patient + every group doctor).
    # A render/routing hint only — membership still lives in participants.
    kind = db.Column(
        db.Enum(ServiceChannelKind, values_callable=_enum_values),
        nullable=False, default=ServiceChannelKind.SINGLE,
        server_default=ServiceChannelKind.SINGLE.value, index=True,
    )
    read_only_at = db.Column(db.DateTime(timezone=True), nullable=True)
    archived_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    last_message_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # ── Family-doctor "second opinion" channels ──────────────────────────
    # A second-opinion channel has NO purchase and NO held_* anchor; it is
    # keyed on the prescription it discusses. ``max_messages`` /
    # ``max_call_seconds`` cap the conversation (5 messages / 5-minute calls);
    # NULL on every normal channel, so the caps are a no-op elsewhere.
    prescription_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('prescriptions.prescription_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    max_messages = db.Column(db.Integer, nullable=True)
    max_call_seconds = db.Column(db.Integer, nullable=True)

    purchased_service = db.relationship(
        'PurchasedService', foreign_keys=[purchased_service_id],
        backref=db.backref('channel', uselist=False),
    )
    __table_args__ = (
        db.Index('ux_service_channels_support_per_tenant', 'tenant_id',
                 unique=True,
                 postgresql_where=db.text(
                     'support_seller_tenant_id IS NOT NULL'
                     ' AND is_deleted = false')),
    )

    participants = db.relationship(
        'ChannelParticipant', back_populates='channel',
        cascade='all, delete-orphan', lazy='selectin',
    )

    @property
    def is_holding(self):
        """A no-purchase operator channel: admin ↔ held user, or the
        seller-support channel. All three unlock the same behavior —
        chat and documents always on, calls scheduled by the operator
        seat (participant role ADMIN on holding/support)."""
        return (self.held_doctor_id is not None
                or self.held_user_id is not None
                or self.support_seller_tenant_id is not None)

    @property
    def is_support(self):
        return self.support_seller_tenant_id is not None

    def to_dict(self):
        return {
            'id': str(self.id),
            'purchased_service_id': str(self.purchased_service_id) if self.purchased_service_id else None,
            'held_doctor_id': str(self.held_doctor_id) if self.held_doctor_id else None,
            'is_holding': self.is_holding,
            'is_support': self.is_support,
            'status': self.status.value if self.status else None,
            'kind': self.kind.value if self.kind else None,
            'read_only_at': self.read_only_at.isoformat() if self.read_only_at else None,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'last_message_at': (
                self.last_message_at.isoformat() if self.last_message_at else None
            ),
        }

    def __repr__(self):
        return f'<ServiceChannel {self.id} {self.status.value}>'


class ChannelParticipant(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """Who is in a channel.

    Exactly two rows are created today (patient + provider), but the table
    exists from day one so group consultations — nurse, family member, second
    opinion — become an INSERT instead of a migration. Every message, call,
    document and event references a participant rather than a raw user, which
    is what makes that future cheap.
    """
    __tablename__ = 'channel_participants'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    role = db.Column(
        db.Enum(ChannelParticipantRole, values_callable=_enum_values),
        nullable=False,
    )

    # Per-participant mute/read-only, independent of the channel's own status.
    can_send = db.Column(db.Boolean, nullable=False, default=True,
                         server_default=db.text('true'))

    joined_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    left_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_read_at = db.Column(db.DateTime(timezone=True), nullable=True)

    channel = db.relationship('ServiceChannel', back_populates='participants')
    user = db.relationship('User', foreign_keys=[user_id])

    __table_args__ = (
        db.Index(
            'ux_channel_participant_user', 'channel_id', 'user_id',
            unique=True, postgresql_where=db.text('is_deleted = false'),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'user_id': str(self.user_id),
            # Who this participant is, for group channels where a bubble/roster
            # must name the sender (a 1:1 never needed it). Resolved via the
            # ``user`` relationship; falls back gracefully if it isn't loaded.
            'display_name': (self.user.full_name if self.user else None) or None,
            'role': self.role.value if self.role else None,
            'can_send': self.can_send,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'left_at': self.left_at.isoformat() if self.left_at else None,
            'last_read_at': self.last_read_at.isoformat() if self.last_read_at else None,
        }

    def __repr__(self):
        return f'<ChannelParticipant {self.role.value} channel={self.channel_id}>'


class ChannelMessage(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """One chat message. Persisted FIRST, then broadcast over the socket.

    Postgres is the source of truth; the websocket is transport only. That
    ordering is what gives this module the auditable, asynchronous history the
    existing in-call DataTrack chat never had.
    """
    __tablename__ = 'channel_messages'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    sender_participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    kind = db.Column(
        db.Enum(ChannelMessageKind, values_callable=_enum_values),
        nullable=False, default=ChannelMessageKind.TEXT,
    )
    body = db.Column(db.Text, nullable=True)

    document_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_documents.id', ondelete='SET NULL'),
        nullable=True,
    )

    # Client-generated id so a retried send (flaky socket) doesn't duplicate.
    client_msg_id = db.Column(db.String(64), nullable=True)

    read_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Set when someone posted this on behalf of the participant, rather than
    # the participant posting it themselves. Two ways that happens: a platform
    # operator through the Operations act-on-behalf proxy, or a practice's own
    # support staff writing in their doctor's thread. The message still belongs
    # to the member whose participant row sent it — that's the point — but both
    # sides of the conversation get to see who actually typed it.
    #
    # Deliberately NOT the inherited ``created_by_id``: that means "who created
    # the row", which for an ordinary message is just the sender, so overloading
    # it would be ambiguous.
    #
    # The name says "admin" for history; ``sent_on_behalf_kind`` is what
    # distinguishes the two. Renaming the column would rewrite a FK on a table
    # that already has rows, for no gain a reader of this comment doesn't get.
    sent_by_admin_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )

    # 'admin' | 'staff'. Stored rather than derived from the sender's current
    # role, because a role can change and that must not silently relabel what
    # someone said months ago. NULL means the participant posted it themselves.
    sent_on_behalf_kind = db.Column(db.String(16), nullable=True)

    sender = db.relationship('ChannelParticipant', foreign_keys=[sender_participant_id])
    sent_by_admin = db.relationship('User', foreign_keys=[sent_by_admin_id])

    __table_args__ = (
        db.Index('ix_channel_messages_history', 'channel_id', 'created_at'),
        db.Index(
            'ux_channel_messages_client_id', 'channel_id', 'client_msg_id',
            unique=True,
            postgresql_where=db.text('client_msg_id IS NOT NULL AND is_deleted = false'),
        ),
    )

    def _admin_display_name(self):
        """Name of whoever posted this on the participant's behalf, or ``None``.

        Best-effort: a deleted or unloadable user must degrade to an unnamed
        marker, never break serialization of the thread.
        """
        if not self.sent_by_admin_id:
            return None
        try:
            author = self.sent_by_admin
            if author is None:
                return None
            # Names only — ``User.email`` is encrypted and can raise on a bad
            # key, which is not something a chat render should ever hit.
            return (author.full_name or '').strip() or None
        except Exception:  # noqa: BLE001 — a name is never worth a 500
            return None

    def _on_behalf_kind(self):
        """'admin' | 'staff' | None.

        Rows written before ``sent_on_behalf_kind`` existed only ever came from
        the Operations proxy, so a stamped author with no kind is an admin.
        """
        if not self.sent_by_admin_id:
            return None
        return self.sent_on_behalf_kind or 'admin'

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'sender_participant_id': (
                str(self.sender_participant_id) if self.sender_participant_id else None
            ),
            'kind': self.kind.value if self.kind else None,
            'body': self.body,
            'document_id': str(self.document_id) if self.document_id else None,
            'client_msg_id': self.client_msg_id,
            'read_at': self.read_at.isoformat() if self.read_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            # Provenance — this one serializer feeds the GET history, the POST
            # response AND the socket broadcast, so everyone in the thread sees
            # the marker wherever they read it.
            'sent_on_behalf': bool(self.sent_by_admin_id),
            'sent_on_behalf_kind': self._on_behalf_kind(),
            'sent_on_behalf_name': self._admin_display_name(),
            # Kept so a client mid-flight (an open tab, a cached socket
            # payload) doesn't lose the marker on deploy. New code reads the
            # three fields above.
            'sent_by_admin': bool(self.sent_by_admin_id),
            'sent_by_admin_name': self._admin_display_name(),
        }

    def __repr__(self):
        return f'<ChannelMessage {self.id} channel={self.channel_id}>'


class ScheduledCall(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """A scheduled audio/video consultation inside a channel.

    Only the PROVIDER may create one (enforced in the service layer, mirroring
    a clinic appointment). A patient can PROPOSE a time — which lands as a
    ``ChannelMessage`` of kind ``proposal`` and optionally a row in state
    ``PROPOSED`` — and can ACCEPT and JOIN, but never schedule.

    ``twilio_room_name`` uses an ``svc-`` prefix so it can never collide with
    the appointment system's ``appt-{id}`` rooms.
    """
    __tablename__ = 'scheduled_calls'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    created_by_participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True,
    )

    mode = db.Column(
        db.Enum(ScheduledCallMode, values_callable=_enum_values), nullable=False,
    )
    status = db.Column(
        db.Enum(ScheduledCallStatus, values_callable=_enum_values),
        nullable=False, default=ScheduledCallStatus.SCHEDULED, index=True,
    )

    scheduled_start = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    scheduled_end = db.Column(db.DateTime(timezone=True), nullable=False)

    patient_accepted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    ended_at = db.Column(db.DateTime(timezone=True), nullable=True)

    twilio_room_sid = db.Column(db.String(64), nullable=True)
    twilio_room_name = db.Column(db.String(128), nullable=True, index=True)

    # Billed minutes = overlap of participant sessions, not scheduled length.
    connected_seconds = db.Column(db.Integer, nullable=False, default=0,
                                  server_default=db.text('0'))

    channel = db.relationship('ServiceChannel', foreign_keys=[channel_id])
    sessions = db.relationship(
        'CallSession', back_populates='scheduled_call',
        cascade='all, delete-orphan', lazy='selectin',
    )

    __table_args__ = (
        db.Index('ix_scheduled_calls_upcoming', 'status', 'scheduled_start'),
        db.CheckConstraint('scheduled_end > scheduled_start',
                           name='ck_scheduled_call_window_valid'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'mode': self.mode.value if self.mode else None,
            'status': self.status.value if self.status else None,
            'scheduled_start': (
                self.scheduled_start.isoformat() if self.scheduled_start else None
            ),
            'scheduled_end': self.scheduled_end.isoformat() if self.scheduled_end else None,
            'patient_accepted_at': (
                self.patient_accepted_at.isoformat() if self.patient_accepted_at else None
            ),
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'ended_at': self.ended_at.isoformat() if self.ended_at else None,
            'connected_seconds': self.connected_seconds,
        }

    def __repr__(self):
        return f'<ScheduledCall {self.id} {self.mode.value} {self.status.value}>'


class CallSession(TenantMixin, TimestampMixin, db.Model):
    """One participant's presence in one call — the raw material for billing.

    Quota is deducted from ACTUAL connected duration, not scheduled duration:
    a 10:00-10:30 booking where the doctor joins 10:02, the patient 10:07 and
    the call ends 10:20 consumes 13 minutes, not 30. The overlap is computed
    across sessions and written to ``ScheduledCall.connected_seconds``.

    No soft-delete: this is a billing audit record.
    """
    __tablename__ = 'call_sessions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scheduled_call_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('scheduled_calls.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    joined_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    left_at = db.Column(db.DateTime(timezone=True), nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)

    # Twilio's own identifiers, so the status-callback webhook can reconcile.
    twilio_participant_sid = db.Column(db.String(64), nullable=True, index=True)

    scheduled_call = db.relationship('ScheduledCall', back_populates='sessions')

    __table_args__ = (
        # At most ONE open session per participant per call. The join path
        # dedups in Python, but that read-then-insert is racy under a
        # double-clicked / retried join; this partial-unique index makes the
        # duplicate INSERT fail instead — which would otherwise let one human's
        # two overlapping sessions be counted as two present participants and
        # over-bill the call.
        db.Index(
            'ux_call_sessions_open',
            'scheduled_call_id', 'participant_id',
            unique=True,
            postgresql_where=db.text('left_at IS NULL'),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'scheduled_call_id': str(self.scheduled_call_id),
            'participant_id': str(self.participant_id) if self.participant_id else None,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'left_at': self.left_at.isoformat() if self.left_at else None,
            'duration_seconds': self.duration_seconds,
        }

    def __repr__(self):
        return f'<CallSession call={self.scheduled_call_id} participant={self.participant_id}>'


class ChannelDocument(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """A file uploaded into a channel by either side.

    Explicitly NOT prescriptions. Prescriptions are generated by the existing
    untouched workflow (``app/services/prescription_pdf_service.py`` →
    ``Prescription.pdf_link``) and are never uploaded here — which is why
    ``ChannelDocumentCategory`` has no ``prescription`` member. "My Medical
    Records" surfaces both, but only this table accepts uploads.

    Column shape follows ``PageConfigAsset`` (the cleanest existing S3 row).
    ``S3Service.upload_file`` renames to a UUID, so ``original_filename`` is
    stored here or the name is lost.
    """
    __tablename__ = 'channel_documents'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    uploaded_by_participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True,
    )

    category = db.Column(
        db.Enum(ChannelDocumentCategory, values_callable=_enum_values),
        nullable=False, default=ChannelDocumentCategory.UPLOADED, index=True,
    )

    original_filename = db.Column(db.String(300), nullable=False)
    s3_bucket = db.Column(db.String(200), nullable=False)
    s3_key = db.Column(db.String(500), nullable=False)
    s3_region = db.Column(db.String(50), nullable=True)
    content_type = db.Column(db.String(120), nullable=True)
    file_size_bytes = db.Column(db.BigInteger, nullable=True)

    description = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.Index('ix_channel_documents_listing', 'channel_id', 'category', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'uploaded_by_participant_id': (
                str(self.uploaded_by_participant_id)
                if self.uploaded_by_participant_id else None
            ),
            'category': self.category.value if self.category else None,
            'filename': self.original_filename,
            'content_type': self.content_type,
            'file_size_bytes': self.file_size_bytes,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<ChannelDocument {self.original_filename} channel={self.channel_id}>'


class ChannelFormResponse(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """A submitted form inside a channel.

    ``answers`` is free-form JSONB keyed by ``form_key`` + ``schema_version``
    so a form definition can evolve without migrating historical submissions.
    """
    __tablename__ = 'channel_form_responses'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    submitted_by_participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True,
    )

    form_key = db.Column(db.String(100), nullable=False, index=True)
    schema_version = db.Column(db.Integer, nullable=False, default=1)
    answers = db.Column(JSONB, nullable=False, default=dict)
    submitted_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'form_key': self.form_key,
            'schema_version': self.schema_version,
            'answers': self.answers or {},
            'submitted_at': self.submitted_at.isoformat() if self.submitted_at else None,
        }

    def __repr__(self):
        return f'<ChannelFormResponse {self.form_key} channel={self.channel_id}>'


class ChannelEvent(TenantMixin, TimestampMixin, db.Model):
    """A system timeline entry — the channel's audit trail.

    Rendered inline with messages but visually distinct, so both users and
    administrators can reconstruct the whole lifetime of a service ("service
    booked → call scheduled → patient joined → form submitted → expired")
    without opening a separate activity log.

    No soft-delete: an audit trail that can be quietly removed isn't one.
    """
    __tablename__ = 'channel_events'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('service_channels.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # NULL for system-generated events (expiry, archival).
    actor_participant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('channel_participants.id', ondelete='SET NULL'),
        nullable=True,
    )

    event_type = db.Column(
        db.Enum(ChannelEventType, values_callable=_enum_values),
        nullable=False, index=True,
    )
    payload = db.Column(JSONB, nullable=True)
    occurred_at = db.Column(db.DateTime(timezone=True), nullable=False,
                            default=utcnow, index=True)

    __table_args__ = (
        db.Index('ix_channel_events_timeline', 'channel_id', 'occurred_at'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'channel_id': str(self.channel_id),
            'actor_participant_id': (
                str(self.actor_participant_id) if self.actor_participant_id else None
            ),
            'event_type': self.event_type.value if self.event_type else None,
            'payload': self.payload or {},
            'occurred_at': self.occurred_at.isoformat() if self.occurred_at else None,
        }

    def __repr__(self):
        return f'<ChannelEvent {self.event_type.value} channel={self.channel_id}>'
