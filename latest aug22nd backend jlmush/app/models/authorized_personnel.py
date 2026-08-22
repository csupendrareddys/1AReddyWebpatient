"""Authorized personnel of a corporate entity.

Captured only when an :class:`EntityProfile`'s ``entity_type`` is not
``INDIVIDUAL``. Each person carries a name + designation and reuses the
existing :class:`ProfileEducation` structure (graduation → other-certification,
each with attachment + verification status) via a widened owner FK — so the
"education details to certification details" sub-form is shared verbatim with
the doctor/admin education UI instead of duplicated.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin


class AuthorizedPersonnel(TenantMixin, TimestampMixin, SoftDeleteMixin, db.Model):
    __tablename__ = 'authorized_personnel'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_profile_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('entity_profiles.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    name = db.Column(db.String(200), nullable=False)
    designation = db.Column(db.String(150), nullable=True)
    display_order = db.Column(db.Integer, nullable=False, default=0)

    # One education→certification record per person (ProfileEducation owns the
    # authorized_personnel_id FK, mirroring how it owns doctor_id / admin_id).
    education = db.relationship(
        'ProfileEducation', backref='authorized_personnel',
        uselist=False, cascade='all, delete-orphan', lazy='joined',
    )

    def to_dict(self, include_education=True):
        data = {
            'id': str(self.id),
            'entity_profile_id': str(self.entity_profile_id),
            'name': self.name,
            'designation': self.designation,
            'display_order': self.display_order,
        }
        if include_education:
            data['education'] = self.education.to_response_dict() if self.education else None
        return data
