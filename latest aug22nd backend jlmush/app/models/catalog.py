"""
Catalog / master-data models.

Models: Category, MasterCollege, Symptom, AllergyMaster

All models add TenantMixin.
Unique name constraints are now scoped to (tenant_id, name) instead of a
global UNIQUE so that different tenants may share names.
DateTime columns use timezone=True.
All original table names, column names, FK references, and methods are preserved.
"""
import uuid

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin

# The education ladder. `qualification_level` is a free-form String column
# rather than an Enum, so these are the recognised values, not a DB constraint.
# Defined next to the column so callers validating it share one list — several
# hand-copied tuples of these predate this constant.
QUALIFICATION_LEVELS = ('ug', 'pg', 'super_speciality')

# Category rows are discriminated by `category_type`; these are the values in
# use. 'work_qualification' backs the admin-managed work-qualification list
# that doctors pick from on their profile.
CATEGORY_TYPE_SPECIALIZATION = 'specialization'
CATEGORY_TYPE_DEGREE = 'degree'
CATEGORY_TYPE_WORK_QUALIFICATION = 'work_qualification'
# Admin-managed category list for Group Offerings (the plan builder's Category
# dropdown). Same master table, discriminated by type — no dedicated table.
CATEGORY_TYPE_GROUP_OFFERING = 'group_offering_category'


class Category(TenantMixin, TimestampMixin, db.Model):
    """Medical specialization categories (and other category types)."""
    __tablename__ = 'categories'

    id            = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='category_id')
    name          = db.Column(db.String(200), nullable=False, index=True)
    description   = db.Column(db.Text,        nullable=True)
    icon          = db.Column(db.String(500), nullable=True)
    parent_id     = db.Column(UUID(as_uuid=True), db.ForeignKey('categories.category_id'), nullable=True)
    is_active     = db.Column(db.Boolean, default=True,             nullable=False, index=True)
    category_type = db.Column(db.String(50), nullable=True, index=True, default='specialization')
    # Qualification level scoping for specialization rows (NULL = legacy /
    # all-levels). Values: 'ug', 'pg', 'super_speciality'. Free-form String
    # so new levels can be added without a migration.
    qualification_level = db.Column(db.String(20), nullable=True)

    # Self-referential relationship
    children = db.relationship(
        'Category',
        backref=db.backref('parent', remote_side=[id]),
        lazy='dynamic',
    )
    specializations = db.relationship(
        'ProfileEducationSpecialization',
        back_populates='category',
        lazy='dynamic',
    )

    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='uq_category_tenant_name'),
        Index('ix_category_tenant_type', 'tenant_id', 'category_type'),
        Index('ix_categories_tenant_type_level', 'tenant_id', 'category_type', 'qualification_level'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'icon': self.icon,
            'is_active': self.is_active,
            'qualification_level': self.qualification_level,
        }

    def __repr__(self):
        return f"<Category {self.name}>"


class MasterCollege(TenantMixin, db.Model):
    """Master table for colleges/universities used in doctor profile dropdowns."""
    __tablename__ = 'master_colleges'

    id             = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='college_id')
    name           = db.Column(db.String(300), nullable=False, index=True)
    is_active      = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_by_id  = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    created_at     = db.Column(db.DateTime(timezone=True), default=None, nullable=False)
    # Qualification level: 'ug', 'pg', 'super_speciality'. NULL = legacy
    # row that predates the level split (resolves under any level filter).
    qualification_level = db.Column(db.String(20), nullable=True)

    created_by = db.relationship('User', foreign_keys=[created_by_id])

    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='uq_master_college_tenant_name'),
        Index('ix_master_colleges_tenant_level', 'tenant_id', 'qualification_level'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'is_active': self.is_active,
            'qualification_level': self.qualification_level,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<MasterCollege {self.name}>"


class Symptom(TenantMixin, TimestampMixin, db.Model):
    """Master list of symptoms patients can select."""
    __tablename__ = 'symptoms'

    id          = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='symptom_id')
    name        = db.Column(db.String(200), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    category    = db.Column(db.String(100), nullable=True, index=True)  # e.g., 'General', 'Respiratory'
    is_active   = db.Column(db.Boolean, default=True, nullable=False, index=True)

    # Relationships
    appointments = db.relationship('AppointmentSymptom', back_populates='symptom', lazy='dynamic')
    doctors      = db.relationship('DoctorSymptom',      back_populates='symptom', lazy='dynamic')

    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='uq_symptom_tenant_name'),
        Index('ix_symptom_tenant_category', 'tenant_id', 'category'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'category': self.category,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<Symptom {self.name}>"


class AllergyMaster(TenantMixin, db.Model):
    """Admin-managed master list of allergies. Patients select from this list."""
    __tablename__ = 'allergy_master'

    id         = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name       = db.Column(db.String(200), nullable=False, index=True)
    category   = db.Column(db.String(100), nullable=True)   # e.g. "Drug", "Food", "Environmental"
    is_active  = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='uq_allergy_master_tenant_name'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'category': self.category,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<AllergyMaster {self.name}>"

class Product_Category(TenantMixin, TimestampMixin, db.Model):
    """Products falls under this main product category"""
    __tablename__ = 'product_categories'

    id            = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='category_id')
    name          = db.Column(db.String(200), nullable=False, index=True)
    tag_line      = db.Column(db.String(200),        nullable=True)
    icon          = db.Column(db.String(500), nullable=True)
    is_active     = db.Column(db.Boolean, default=True,             nullable=False, index=True)
    # The products/features this category covers (Video, Audio, Chat, …). A flat
    # list of string keys — the admin picks from a fixed catalog list, so a
    # JSONB array is enough; no join table is warranted.
    features      = db.Column(JSONB, nullable=False, default=list, server_default='[]')
    # Category classification — "Consultant type" / "Plan based type" (a
    # category may be both). Flat list of string keys, same shape as
    # ``features``; the admin picks from a fixed frontend list.
    category_types = db.Column(JSONB, nullable=False, default=list, server_default='[]')

    # Named subcategories under this category. Deleted with the parent.
    subcategories = db.relationship(
        'ProductSubcategory', back_populates='category',
        cascade='all, delete-orphan', order_by='ProductSubcategory.name',
    )

    __table_args__ = (
        UniqueConstraint('tenant_id', 'name', name='product_category_tenant_name'),
        Index('ix_category_tenant_active', 'tenant_id', 'is_active'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'tag_line': self.tag_line,
            'icon': self.icon,
            'is_active': self.is_active,
            'features': self.features or [],
            'category_types': self.category_types or [],
            'subcategories': [s.to_dict() for s in self.subcategories],
        }

    def __repr__(self):
        return f"<Product Category {self.name}>"


class ProductSubcategory(TenantMixin, TimestampMixin, db.Model):
    """A named subcategory under a Product_Category."""
    __tablename__ = 'product_subcategories'

    id           = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='subcategory_id')
    category_id  = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('product_categories.category_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    name         = db.Column(db.String(200), nullable=False)
    is_active    = db.Column(db.Boolean, default=True, nullable=False)

    category     = db.relationship('Product_Category', back_populates='subcategories')

    __table_args__ = (
        UniqueConstraint('category_id', 'name', name='product_subcategory_category_name'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'category_id': str(self.category_id),
            'name': self.name,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<Product Subcategory {self.name}>"
