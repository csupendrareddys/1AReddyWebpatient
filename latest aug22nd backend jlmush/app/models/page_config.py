"""
Page config models: LoginPageConfig, LoginFieldConfig, UserTypeConfig,
ExtraButtonConfig, PageConfigAsset, PageConfig, ConfigAuditLog, PageFieldConfig.

PageFieldConfig is a new merged model replacing:
  - DoctorProfileFieldConfig
  - PatientProfileFieldConfig
  - PatientAppointmentFieldConfig
Uses `page_type` String(50) column to distinguish between them.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import PageType, AssetType, ConfigStatus, AuditAction


class LoginPageConfig(TenantMixin, db.Model):
    """Configurable login page settings with is_present toggles."""
    __tablename__ = 'login_page_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='config_id')

    # Branding
    logo_url = db.Column(db.String(500), nullable=True)
    logo_alt_text = db.Column(db.String(200), default='Application Logo')
    logo_is_present = db.Column(db.Boolean, default=True)

    # Page text labels
    page_title = db.Column(db.String(200), default='Login')
    page_subtitle = db.Column(db.String(500), nullable=True)
    login_tab_text = db.Column(db.String(100), default='Login')
    signup_tab_text = db.Column(db.String(100), default='Sign up')
    signup_tab_is_present = db.Column(db.Boolean, default=True)

    # Button labels + visibility
    login_button_text = db.Column(db.String(100), default='Login')
    otp_button_text = db.Column(db.String(100), default='Request OTP')
    otp_section_text = db.Column(db.String(200), default='Login via Phone Number')
    otp_section_is_present = db.Column(db.Boolean, default=True)

    # Links + visibility
    forgot_password_text = db.Column(db.String(200), default='Forgot Password?')
    forgot_password_is_present = db.Column(db.Boolean, default=True)
    register_text = db.Column(db.String(200), default="Don't have an account")
    register_link_text = db.Column(db.String(100), default='Register Now')
    register_is_present = db.Column(db.Boolean, default=True)

    # Terms & Conditions + visibility
    terms_checkbox_text = db.Column(db.String(500), default='Yes, I agree to the')
    terms_link_text = db.Column(db.String(200), default='Terms & Conditions')
    terms_is_present = db.Column(db.Boolean, default=True)
    terms_required = db.Column(db.Boolean, default=True)

    # Remember Me + visibility
    remember_me_text = db.Column(db.String(100), default='Remember Me')
    remember_me_is_present = db.Column(db.Boolean, default=True)

    # User type selector
    user_type_selector_is_present = db.Column(db.Boolean, default=True)

    # Timestamps & status
    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    fields = db.relationship('LoginFieldConfig', back_populates='config', cascade='all, delete-orphan', lazy='dynamic')
    user_types = db.relationship('UserTypeConfig', back_populates='config', cascade='all, delete-orphan', lazy='dynamic')
    extra_buttons = db.relationship('ExtraButtonConfig', back_populates='config', cascade='all, delete-orphan', lazy='dynamic')

    def to_dict(self, include_children=True):
        data = {
            'id': str(self.id),
            'logo_url': self.logo_url,
            'logo_alt_text': self.logo_alt_text,
            'logo_is_present': self.logo_is_present,
            'page_title': self.page_title,
            'page_subtitle': self.page_subtitle,
            'login_tab_text': self.login_tab_text,
            'signup_tab_text': self.signup_tab_text,
            'signup_tab_is_present': self.signup_tab_is_present,
            'login_button_text': self.login_button_text,
            'otp_button_text': self.otp_button_text,
            'otp_section_text': self.otp_section_text,
            'otp_section_is_present': self.otp_section_is_present,
            'forgot_password_text': self.forgot_password_text,
            'forgot_password_is_present': self.forgot_password_is_present,
            'register_text': self.register_text,
            'register_link_text': self.register_link_text,
            'register_is_present': self.register_is_present,
            'terms_checkbox_text': self.terms_checkbox_text,
            'terms_link_text': self.terms_link_text,
            'terms_is_present': self.terms_is_present,
            'terms_required': self.terms_required,
            'remember_me_text': self.remember_me_text,
            'remember_me_is_present': self.remember_me_is_present,
            'user_type_selector_is_present': self.user_type_selector_is_present,
        }
        if include_children:
            data['fields'] = [f.to_dict() for f in self.fields.filter_by(is_present=True).order_by(LoginFieldConfig.display_order)]
            data['user_types'] = [ut.to_dict() for ut in self.user_types.filter_by(is_present=True).order_by(UserTypeConfig.display_order)]
            data['extra_buttons'] = [eb.to_dict() for eb in self.extra_buttons.filter_by(is_present=True).order_by(ExtraButtonConfig.display_order)]
        return data

    def __repr__(self):
        return f"<LoginPageConfig {self.id} active={self.is_active}>"


class LoginFieldConfig(TenantMixin, db.Model):
    """Dynamic form fields for login page."""
    __tablename__ = 'login_field_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='field_id')
    config_id = db.Column(UUID(as_uuid=True), db.ForeignKey('login_page_configs.config_id', ondelete='CASCADE'), nullable=False, index=True)

    field_key = db.Column(db.String(100), nullable=False)
    field_type = db.Column(db.String(50), default='text')
    label = db.Column(db.String(200), nullable=False)
    placeholder = db.Column(db.String(300), nullable=True)
    helper_text = db.Column(db.String(500), nullable=True)
    icon = db.Column(db.String(100), nullable=True)

    # Validation
    required = db.Column(db.Boolean, default=True)
    min_length = db.Column(db.Integer, nullable=True)
    max_length = db.Column(db.Integer, nullable=True)
    validation_regex = db.Column(db.String(500), nullable=True)
    validation_message = db.Column(db.String(300), nullable=True)

    # Display
    display_order = db.Column(db.Integer, default=0)
    is_present = db.Column(db.Boolean, default=True)

    user_types = db.Column(JSON, nullable=True)
    translations = db.Column(JSON, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    config = db.relationship('LoginPageConfig', back_populates='fields')

    def to_dict(self):
        return {
            'id': str(self.id),
            'field_key': self.field_key,
            'field_type': self.field_type,
            'label': self.label,
            'placeholder': self.placeholder,
            'helper_text': self.helper_text,
            'icon': self.icon,
            'required': self.required,
            'min_length': self.min_length,
            'max_length': self.max_length,
            'validation_regex': self.validation_regex,
            'validation_message': self.validation_message,
            'display_order': self.display_order,
            'is_present': self.is_present,
            'user_types': self.user_types,
            'translations': self.translations,
        }

    def __repr__(self):
        return f"<LoginFieldConfig {self.field_key}>"


class UserTypeConfig(TenantMixin, db.Model):
    """Configuration for each user type shown on login page."""
    __tablename__ = 'user_type_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='user_type_id')
    config_id = db.Column(UUID(as_uuid=True), db.ForeignKey('login_page_configs.config_id', ondelete='CASCADE'), nullable=False, index=True)

    type_key = db.Column(db.String(50), nullable=False)
    display_name = db.Column(db.String(100), nullable=False)
    display_order = db.Column(db.Integer, default=0)
    is_present = db.Column(db.Boolean, default=True)
    default_selected = db.Column(db.Boolean, default=False)
    signup_route = db.Column(db.String(200), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    config = db.relationship('LoginPageConfig', back_populates='user_types')

    def to_dict(self):
        return {
            'id': str(self.id),
            'type_key': self.type_key,
            'display_name': self.display_name,
            'display_order': self.display_order,
            'is_present': self.is_present,
            'default_selected': self.default_selected,
            'signup_route': self.signup_route,
        }

    def __repr__(self):
        return f"<UserTypeConfig {self.type_key}>"


class ExtraButtonConfig(TenantMixin, db.Model):
    """Dynamic extra buttons that admin can add to login page."""
    __tablename__ = 'extra_button_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='button_id')
    config_id = db.Column(UUID(as_uuid=True), db.ForeignKey('login_page_configs.config_id', ondelete='CASCADE'), nullable=False, index=True)

    button_text = db.Column(db.String(200), nullable=False)
    button_type = db.Column(db.String(50), default='outlined')
    button_color = db.Column(db.String(50), default='primary')
    action_type = db.Column(db.String(50), nullable=False)
    action_value = db.Column(db.String(500), nullable=True)
    icon = db.Column(db.String(100), nullable=True)
    display_order = db.Column(db.Integer, default=0)
    is_present = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    config = db.relationship('LoginPageConfig', back_populates='extra_buttons')

    def to_dict(self):
        return {
            'id': str(self.id),
            'button_text': self.button_text,
            'button_type': self.button_type,
            'button_color': self.button_color,
            'action_type': self.action_type,
            'action_value': self.action_value,
            'icon': self.icon,
            'display_order': self.display_order,
            'is_present': self.is_present,
        }

    def __repr__(self):
        return f"<ExtraButtonConfig {self.button_text}>"


class PageConfigAsset(TenantMixin, db.Model):
    """Assets stored in AWS S3 for page configurations."""
    __tablename__ = 'page_config_assets'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='asset_id')
    asset_type = db.Column(db.Enum(AssetType), nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    s3_bucket = db.Column(db.String(100), nullable=False)
    s3_key = db.Column(db.String(500), nullable=False)
    s3_region = db.Column(db.String(50), nullable=False)
    content_type = db.Column(db.String(100), nullable=True)
    file_size_bytes = db.Column(db.BigInteger, nullable=True)
    original_filename = db.Column(db.String(300), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    uploaded_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    uploaded_by = db.relationship('User', backref='uploaded_assets')

    def get_presigned_url(self, expiration=3600):
        """Get URL for asset - direct public URL for public bucket, presigned for private."""
        from flask import current_app
        from app.services.s3_service import S3Service

        public_bucket = current_app.config.get('AWS_S3_PUBLIC_BUCKET', '')

        print(f"DEBUG: Asset bucket: '{self.s3_bucket}', Public bucket: '{public_bucket}'", flush=True)

        if self.s3_bucket == public_bucket:
            url = S3Service.get_public_url(self.s3_bucket, self.s3_key, self.s3_region)
            print(f"DEBUG: Generated PUBLIC URL: {url}", flush=True)
            return url
        else:
            url = S3Service.generate_presigned_url(self.s3_bucket, self.s3_key, expiration)
            print(f"DEBUG: Generated PRESIGNED URL: {url}", flush=True)
            return url

    def to_dict(self, include_url=False):
        data = {
            'id': str(self.id),
            'asset_type': self.asset_type.value,
            'name': self.name,
            'content_type': self.content_type,
            'file_size_bytes': self.file_size_bytes,
            'original_filename': self.original_filename,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        if include_url:
            data['url'] = self.get_presigned_url()
        return data


class PageConfig(TenantMixin, db.Model):
    """Configurable page settings with draft/preview/live workflow."""
    __tablename__ = 'page_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='config_id')
    page_type = db.Column(db.Enum(PageType), nullable=False, index=True)
    version = db.Column(db.Integer, default=1, nullable=False)
    status = db.Column(db.Enum(ConfigStatus), default=ConfigStatus.DRAFT, nullable=False, index=True)
    logo_asset_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'), nullable=True)
    logo_alt_text = db.Column(db.String(200), default='Logo')
    logo_is_present = db.Column(db.Boolean, default=True)
    favicon_asset_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'), nullable=True)
    background_asset_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'), nullable=True)
    background_color = db.Column(db.String(20), default='#ffffff')
    card_background_color = db.Column(db.String(20), default='#ffffff')
    primary_color = db.Column(db.String(20), default='#1976d2')
    secondary_color = db.Column(db.String(20), default='#dc004e')
    page_title = db.Column(db.String(200), default='Welcome')
    page_subtitle = db.Column(db.String(500), nullable=True)
    page_description = db.Column(db.Text, nullable=True)
    primary_button_text = db.Column(db.String(100), default='Submit')
    identifier_label = db.Column(db.String(100), default='Email / Phone / Aadhaar')
    username_placeholder = db.Column(db.String(200), nullable=True)
    password_placeholder = db.Column(db.String(200), nullable=True)
    otp_section_text = db.Column(db.String(200), default='Login via OTP')
    otp_button_text = db.Column(db.String(100), default='Request OTP')
    otp_is_present = db.Column(db.Boolean, default=True)
    forgot_password_text = db.Column(db.String(200), default='Forgot Password?')
    forgot_password_is_present = db.Column(db.Boolean, default=True)
    register_text = db.Column(db.String(200), default="Don't have an account?")
    register_link_text = db.Column(db.String(100), default='Register Now')
    register_link_url = db.Column(db.String(500), nullable=True)
    register_is_present = db.Column(db.Boolean, default=True)
    remember_me_text = db.Column(db.String(100), default='Remember Me')
    remember_me_is_present = db.Column(db.Boolean, default=True)
    terms_checkbox_text = db.Column(db.String(300), default='I agree to the')
    terms_link_text = db.Column(db.String(100), default='Terms & Conditions')
    terms_asset_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'), nullable=True)
    terms_is_present = db.Column(db.Boolean, default=True)
    terms_required = db.Column(db.Boolean, default=True)
    privacy_link_text = db.Column(db.String(100), default='Privacy Policy')
    privacy_asset_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'), nullable=True)
    privacy_is_present = db.Column(db.Boolean, default=True)
    footer_text = db.Column(db.String(500), nullable=True)
    footer_is_present = db.Column(db.Boolean, default=True)
    fields = db.Column(db.JSON, default=list)
    translations = db.Column(JSON, nullable=True)
    published_languages = db.Column(JSON, nullable=True, default=lambda: ["en"])

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])
    favicon_asset = db.relationship('PageConfigAsset', foreign_keys=[favicon_asset_id])
    background_asset = db.relationship('PageConfigAsset', foreign_keys=[background_asset_id])
    terms_asset = db.relationship('PageConfigAsset', foreign_keys=[terms_asset_id])
    privacy_asset = db.relationship('PageConfigAsset', foreign_keys=[privacy_asset_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    __table_args__ = (
        db.Index('ix_page_config_tenant_type_status', 'tenant_id', 'page_type', 'status'),
    )

    def to_dict(self, include_asset_urls=False):
        data = {
            'id': str(self.id),
            'page_type': self.page_type.value,
            'published_languages': self.published_languages or ['en'],
            'version': self.version,
            'status': self.status.value,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_alt_text': self.logo_alt_text,
            'logo_is_present': self.logo_is_present,
            'favicon_asset_id': str(self.favicon_asset_id) if self.favicon_asset_id else None,
            'background_asset_id': str(self.background_asset_id) if self.background_asset_id else None,
            'background_color': self.background_color,
            'card_background_color': self.card_background_color,
            'primary_color': self.primary_color,
            'secondary_color': self.secondary_color,
            'page_title': self.page_title,
            'page_subtitle': self.page_subtitle,
            'page_description': self.page_description,
            'primary_button_text': self.primary_button_text,
            'identifier_label': self.identifier_label,
            'username_placeholder': self.username_placeholder,
            'password_placeholder': self.password_placeholder,
            'otp_section_text': self.otp_section_text,
            'otp_button_text': self.otp_button_text,
            'otp_is_present': self.otp_is_present,
            'forgot_password_text': self.forgot_password_text,
            'forgot_password_is_present': self.forgot_password_is_present,
            'register_text': self.register_text,
            'register_link_text': self.register_link_text,
            'register_link_url': self.register_link_url,
            'register_is_present': self.register_is_present,
            'remember_me_text': self.remember_me_text,
            'remember_me_is_present': self.remember_me_is_present,
            'terms_checkbox_text': self.terms_checkbox_text,
            'terms_link_text': self.terms_link_text,
            'terms_asset_id': str(self.terms_asset_id) if self.terms_asset_id else None,
            'terms_is_present': self.terms_is_present,
            'terms_required': self.terms_required,
            'privacy_link_text': self.privacy_link_text,
            'privacy_asset_id': str(self.privacy_asset_id) if self.privacy_asset_id else None,
            'privacy_is_present': self.privacy_is_present,
            'footer_text': self.footer_text,
            'footer_is_present': self.footer_is_present,
            'fields': self.fields or [],
            'translations': self.translations,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_asset_urls:
            data['logo_url'] = self.logo_asset.get_presigned_url() if self.logo_asset else None
            data['favicon_url'] = self.favicon_asset.get_presigned_url() if self.favicon_asset else None
            data['background_url'] = self.background_asset.get_presigned_url() if self.background_asset else None
            data['terms_url'] = self.terms_asset.get_presigned_url() if self.terms_asset else None
            data['privacy_url'] = self.privacy_asset.get_presigned_url() if self.privacy_asset else None
        return data

    def __repr__(self):
        return f"<PageConfig {self.page_type.value} v{self.version} [{self.status.value}]>"


class ModuleConfig(TenantMixin, db.Model):
    """Per-module draft/preview/live lifecycle (Round 9, Phase 1).

    Each "module" is a logical grouping of sections inside a page
    config (e.g. ``education`` groups ``education_graduation`` +
    ``education_post_graduation`` + ``education_super_speciality`` +
    ``education_other_certification`` on the doctor_profile page).

    Until Phase 2 backfills the existing data, this table is empty and
    every read path still uses the legacy single-PageConfig pipeline.
    Phase 2 fills it; Phase 3 cuts the read/write paths over.

    See docs/features/08-configuration-system/per-module-publish-design.md
    for the full plan.
    """
    __tablename__ = 'module_configs'

    id = db.Column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
        name='module_config_id',
    )
    # ``page_type`` keeps the same Enum as PageConfig — module rows live
    # alongside their parent page_type so the per-page-type seed
    # defaults can be reused.
    page_type = db.Column(db.Enum(PageType), nullable=False, index=True)
    # Module identifier — free-form String so new modules can be added
    # without an Alembic migration. The canonical set per page_type
    # lives in ``app/api/<page_type>_config/modules.py``
    # (SECTION_TO_MODULE / MODULE_KEYS constants).
    module = db.Column(db.String(60), nullable=False, index=True)
    version = db.Column(db.Integer, default=1, nullable=False)
    status = db.Column(
        db.Enum(ConfigStatus), default=ConfigStatus.DRAFT,
        nullable=False, index=True,
    )
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # Operator's release note — set when publishing, surfaced on the
    # History tab.
    note = db.Column(db.Text, nullable=True)
    created_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow,
        nullable=False,
    )

    __table_args__ = (
        Index(
            'ix_module_configs_tenant_pagetype_module_status',
            'tenant_id', 'page_type', 'module', 'status',
        ),
        # A tenant has AT MOST one row in each (PREVIEW, LIVE) state
        # per (page_type, module). DRAFT can stay singleton too but the
        # service layer enforces that via get_or_create_draft. The
        # partial unique index here protects against accidental dupes
        # at the DB level — e.g. a race promoting two drafts to live.
        Index(
            'uq_module_configs_active',
            'tenant_id', 'page_type', 'module', 'status',
            unique=True,
            postgresql_where=db.text(
                "status IN ('DRAFT', 'PREVIEW', 'LIVE')"
            ),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'page_type': self.page_type.value,
            'module': self.module,
            'version': self.version,
            'status': self.status.value,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'note': self.note,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (
            f"<ModuleConfig {self.page_type.value}/{self.module} "
            f"v{self.version} [{self.status.value}]>"
        )


class ConfigAuditLog(TenantMixin, db.Model):
    """Audit trail for page configuration changes."""
    __tablename__ = 'config_audit_logs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='audit_id')
    config_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    page_type = db.Column(db.String(50), nullable=False, index=True)
    action = db.Column(db.Enum(AuditAction), nullable=False)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True, index=True)
    timestamp = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    previous_values = db.Column(JSON, nullable=True)
    new_values = db.Column(JSON, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    user = db.relationship('User', backref='config_audit_logs')

    def to_dict(self):
        return {
            'id': str(self.id),
            'config_id': str(self.config_id) if self.config_id else None,
            'page_type': self.page_type,
            'action': self.action.value,
            'user_id': str(self.user_id) if self.user_id else None,
            'user_name': self.user.admin_profile.full_name if self.user and hasattr(self.user, 'admin_profile') and self.user.admin_profile else 'System',
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'previous_values': self.previous_values,
            'new_values': self.new_values,
            'ip_address': self.ip_address,
            'notes': self.notes,
        }

    def __repr__(self):
        return f"<ConfigAuditLog {self.action.value} on {self.page_type}>"


class PageFieldConfig(TenantMixin, db.Model):
    """
    Merged dynamic field config for doctor profile, patient profile,
    and patient appointment pages.

    The `page_type` column (String 50) replaces the three separate tables:
      - 'doctor_profile'              → was DoctorProfileFieldConfig
      - 'patient_profile'             → was PatientProfileFieldConfig
      - 'patient_appointment_filter'  → was PatientAppointmentFieldConfig
      - 'patient_appointment_symptoms'→ was PatientAppointmentFieldConfig

    All other columns are identical across the three originals.
    """
    __tablename__ = 'page_field_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='field_id')
    config_id = db.Column(UUID(as_uuid=True), db.ForeignKey('page_configs.config_id', ondelete='CASCADE'), nullable=False, index=True)

    # Round 9, Phase 1 — nullable FK to the per-module owner. Stays
    # NULL during the back-compat window; Phase 2 backfills it from the
    # field's section and Phase 3 cuts read paths over to consult this
    # column instead of ``config_id``. Once the cutover is verified the
    # old column gets dropped.
    module_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('module_configs.module_config_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    # Discriminator column
    page_type = db.Column(db.String(50), nullable=False, index=True)

    # Section grouping
    section = db.Column(db.String(100), nullable=False)

    # Field definition
    field_key = db.Column(db.String(100), nullable=False)
    field_type = db.Column(db.String(50), nullable=False, default='text')
    label = db.Column(db.String(200), nullable=False)
    placeholder = db.Column(db.String(300), nullable=True)
    helper_text = db.Column(db.String(500), nullable=True)
    icon = db.Column(db.String(100), nullable=True)

    # Validation
    required = db.Column(db.Boolean, default=False, nullable=False)
    min_length = db.Column(db.Integer, nullable=True)
    max_length = db.Column(db.Integer, nullable=True)
    validation_regex = db.Column(db.String(500), nullable=True)
    validation_message = db.Column(db.String(300), nullable=True)

    # Display
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_present = db.Column(db.Boolean, default=True, nullable=False)
    is_default = db.Column(db.Boolean, default=False, nullable=False)

    user_types = db.Column(JSON, nullable=True)
    data_source = db.Column(db.String(200), nullable=True)
    options = db.Column(JSON, nullable=True)
    translations = db.Column(JSON, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationship
    page_config = db.relationship(
        'PageConfig',
        backref=db.backref('page_field_configs', lazy='dynamic', cascade='all, delete-orphan')
    )

    __table_args__ = (
        Index('ix_page_field_config_config_page_section', 'config_id', 'page_type', 'section'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'config_id': str(self.config_id),
            'page_type': self.page_type,
            'section': self.section,
            'field_key': self.field_key,
            'field_type': self.field_type,
            'label': self.label,
            'placeholder': self.placeholder,
            'helper_text': self.helper_text,
            'icon': self.icon,
            'required': self.required,
            'min_length': self.min_length,
            'max_length': self.max_length,
            'validation_regex': self.validation_regex,
            'validation_message': self.validation_message,
            'display_order': self.display_order,
            'is_present': self.is_present,
            'is_default': self.is_default,
            'user_types': self.user_types,
            'data_source': self.data_source,
            'options': self.options,
            'translations': self.translations,
        }

    def __repr__(self):
        return f"<PageFieldConfig {self.page_type}/{self.section}.{self.field_key}>"
