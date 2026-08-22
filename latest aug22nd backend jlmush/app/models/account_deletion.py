"""AccountDeletionRecord — the durable deletion register (DPDP 2023).

One permanent row per account deletion. The Digital Personal Data
Protection Act, 2023 obliges a data fiduciary to honour erasure (s.12)
YET retain what other law requires, and to be able to account for what
it did. A log line satisfies neither an auditor nor a dispute — this
table does:

  * WHO — ``user_id`` (the soft-deleted, anonymized row) + the one-way
    search hashes of the erased email/phone. The hashes let support
    answer "was the account with this number deleted, and when?" without
    the register itself re-storing the contact data we promised to erase.
  * WHAT — ``scrubbed_fields`` (exactly which attributes were wiped) and
    ``identity_snapshot`` (the statutory record identity: legal name /
    DOB / gender — NEVER contact channels). Clinical and financial
    records must stay identifiable to keep their evidentiary value under
    the retention regimes; contact data has no such requirement.
  * WHY — the user's stated ``reason`` and the ``legal_basis`` the
    deletion was performed under.
  * WHEN — ``performed_at``.

Rows are intentionally NOT soft-deletable: a deletion register that can
itself be deleted proves nothing.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, utcnow

# The standing legal basis stamped on every register row. Retention
# statutes vary by the tenant's vertical (healthcare vs CA/CS etc.), so
# the record cites the family of them rather than guessing per tenant.
LEGAL_BASIS = (
    'Erasure under Digital Personal Data Protection Act, 2023 (s.12), '
    'limited by statutory retention of records: NMC/MCI Code of Ethics '
    'Regulations 2002 (reg. 1.3, medical records), Companies Act 2013 '
    '(s.128(5), books of account), CGST Act 2017 (s.36), Income-tax Act '
    '1961 / Rule 6F, and ICAI SQC-1 (working papers), as applicable to '
    'the tenant. Contact identifiers erased; record identity retained.'
)


class AccountDeletionRecord(TenantMixin, db.Model):
    __tablename__ = 'account_deletion_records'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    role = db.Column(db.String(30), nullable=False)

    # One-way HMAC search hashes (same primitive as User's) of the ERASED
    # identifiers — pseudonymous lookup keys, not the data itself.
    email_hash = db.Column(db.String(64), nullable=True, index=True)
    phone_hash = db.Column(db.String(64), nullable=True, index=True)

    # {full_name, first_name, middle_name, last_name, gender, dob} — the
    # same snapshot sealed onto the patient/doctor profile rows.
    identity_snapshot = db.Column(JSONB, nullable=True)
    scrubbed_fields = db.Column(JSONB, nullable=False)

    reason = db.Column(db.Text, nullable=True)
    legal_basis = db.Column(db.Text, nullable=False)
    performed_at = db.Column(db.DateTime(timezone=True), nullable=False,
                             default=utcnow)

    # Stamped by the retention-expiry purge (scripts/purge_expired_records)
    # once the statutory window lapsed and the clinical set was
    # irreversibly purged. NULL = records still inside their retention
    # period. The register row itself is never removed.
    purged_at = db.Column(db.DateTime(timezone=True), nullable=True)
    purge_note = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            'id': str(self.id),
            'user_id': str(self.user_id) if self.user_id else None,
            'role': self.role,
            'identity_snapshot': self.identity_snapshot,
            'scrubbed_fields': self.scrubbed_fields or [],
            'reason': self.reason,
            'legal_basis': self.legal_basis,
            'performed_at': (
                self.performed_at.isoformat() if self.performed_at else None
            ),
            'purged_at': self.purged_at.isoformat() if self.purged_at else None,
            'purge_note': self.purge_note,
        }

    def __repr__(self):
        return f"<AccountDeletionRecord user={self.user_id} at={self.performed_at}>"
