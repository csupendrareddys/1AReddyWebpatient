"""MediaAsset — one row per stored media object, addressed by a STABLE URL.

The problem this solves: the app used to hand clients whatever URL was
convenient at write time — presigned S3 URLs (dead after an hour, and in
three places actually PERSISTED into ``*_url`` columns), container-local
``/uploads`` paths with the scheme+host baked in (unreachable from a
phone, gone on container rebuild), or raw public-bucket URLs (bucket and
region duplicated into every row). A mobile client caches URLs; every one
of those shapes eventually lies to it.

A MediaAsset row is the durable name for an object: the client keeps
``/api/v1/media/<id>`` forever, and the redirect endpoint
(``app/api/media``) exchanges it for a fresh presigned URL (private
buckets) or the public object URL at request time. The DB stores WHERE
the object is (bucket/key), never a URL that can expire or move.

``sha256`` enables upload dedup: the same bytes uploaded twice by one
tenant reuse the existing object + row instead of storing a copy
(see ``S3Service.upload_file``).

``access``:
  * ``public`` — no auth on the redirect (marketing assets, logos,
    profile photos that render on public booking pages);
  * ``tenant`` — any authenticated user of the SAME tenant (documents
    whose fine-grained authorization lives in their owning feature —
    the redirect is a floor, not the whole policy).

Rows are created inside the caller's transaction (no commit here) so a
rolled-back upload flow leaves no row — at worst an orphan S3 object,
which is what the old rail leaked too.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TimestampMixin


class MediaAsset(TimestampMixin, db.Model):
    __tablename__ = 'media_assets'

    ACCESS_PUBLIC = 'public'
    ACCESS_TENANT = 'tenant'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Nullable: vendor/platform assets (page-config on the vendor host)
    # belong to no customer tenant.
    tenant_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('tenants.id'), nullable=True, index=True)

    s3_bucket = db.Column(db.String(200), nullable=False)
    s3_key = db.Column(db.String(500), nullable=False)
    content_type = db.Column(db.String(120), nullable=True)
    file_size_bytes = db.Column(db.BigInteger, nullable=True)
    sha256 = db.Column(db.String(64), nullable=True, index=True)

    access = db.Column(db.String(16), nullable=False, default=ACCESS_TENANT)
    # What the object IS (profile_image, signature, logo, ...) — display /
    # audit metadata, never an authorization input.
    asset_type = db.Column(db.String(64), nullable=True)
    created_by = db.Column(UUID(as_uuid=True), nullable=True)

    __table_args__ = (
        db.Index('ix_media_assets_dedup', 'tenant_id', 'sha256', 's3_bucket'),
    )

    @property
    def url(self):
        """The stable, client-cacheable path for this asset."""
        return f'/api/v1/media/{self.id}'

    def to_dict(self):
        return {
            'id': str(self.id),
            'url': self.url,
            'content_type': self.content_type,
            'file_size_bytes': self.file_size_bytes,
            'asset_type': self.asset_type,
            'access': self.access,
        }

    def __repr__(self):
        return f'<MediaAsset {self.id} {self.asset_type} {self.access}>'
