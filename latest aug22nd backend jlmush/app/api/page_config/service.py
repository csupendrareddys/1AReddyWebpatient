"""Page Configuration Service - Business logic for page config management.

All queries and writes are tenant-scoped. The current tenant_id is read
from ``flask.g`` (set by the before-request hook in ``app/__init__.py``).
A tenant SUPER_ADMIN therefore sees and modifies only their tenant's
page configs; a PLATFORM_OWNER acting cross-tenant via ``?tenant_id=``
sees that tenant's rows.
"""
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from flask import request, g

from app.extensions import db
from app.models import (
    PageConfig, PageConfigAsset, ConfigAuditLog,
    PageType, ConfigStatus, AuditAction, AssetType,
    Tenant,
)
from app.common.i18n import apply_translations as _apply_translations_common


# Keys on the ``login``-style page config that may carry per-language overrides.
# Passed explicitly to the common apply_translations helper so legacy callers
# who import ``apply_translations`` from this module get the same behavior.
_PAGE_CONFIG_TRANSLATABLE_FIELDS = (
    'page_title', 'page_subtitle', 'page_description',
    'primary_button_text', 'identifier_label',
    'username_placeholder', 'password_placeholder',
    'otp_section_text', 'otp_button_text',
    'forgot_password_text', 'register_text', 'register_link_text',
    'remember_me_text', 'terms_checkbox_text', 'terms_link_text',
    'privacy_link_text', 'footer_text', 'logo_alt_text',
)


def _current_tenant_id():
    """Resolve the active tenant for this request.

    Order: ``g.tenant_id`` (set by the auth hook) → the default tenant.
    Falling back to the default tenant lets unauthenticated public
    endpoints (which don't go through JWT) still load LIVE config.
    """
    tid = getattr(g, 'tenant_id', None)
    if tid:
        return tid
    default_tenant = Tenant.query.filter_by(is_default=True).first()
    if not default_tenant:
        raise ValueError('No tenant context and no default tenant configured.')
    return default_tenant.id

def apply_translations(config_dict, lang='en'):
    """Apply language translations to a page config dict. Thin wrapper around
    :func:`app.common.i18n.apply_translations`; uses the login-page's
    translatable-field whitelist. Kept for backward compatibility with existing
    callers that import this module's ``apply_translations`` directly.
    """
    return _apply_translations_common(
        config_dict, lang=lang,
        translatable_fields=_PAGE_CONFIG_TRANSLATABLE_FIELDS,
    )

def get_default_config(page_type: str) -> dict:
    """Return default configuration for a page type."""
    defaults = {
        'patient_login': {
            'page_title': 'Service Receiver Login',
            'page_subtitle': 'Access your health records and appointments',
            'primary_button_text': 'Sign In',
            'register_link_url': '/auth/service-receiver/signup',
        },
        'doctor_login': {
            'page_title': 'Service Provider Login',
            'page_subtitle': 'Access your dashboard and patient records',
            'primary_button_text': 'Sign In',
            'register_link_url': '/auth/service-provider/doctor/signup',
        },
        'admin_login': {
            'page_title': 'Admin Login',
            'page_subtitle': 'Healthcare Administration Portal',
            'primary_button_text': 'Sign In',
            'otp_is_present': False,
            'register_is_present': False,
        },
        'patient_signup': {
            'page_title': 'Create Service Receiver Account',
            'page_subtitle': 'Join our healthcare platform',
            'primary_button_text': 'Create Account',
            'otp_is_present': False,
            'forgot_password_is_present': False,
            'remember_me_is_present': False,
        },
        'doctor_signup': {
            'page_title': 'Service Provider Registration',
            'page_subtitle': 'Join our network of healthcare providers',
            'primary_button_text': 'Register',
            'otp_is_present': False,
            'forgot_password_is_present': False,
            'remember_me_is_present': False,
        },
        'doctor_profile': {
            'page_title': 'Doctor Profile Settings',
            'page_subtitle': 'Manage your professional profile',
            'primary_button_text': 'Save Profile',
            'otp_is_present': False,
            'forgot_password_is_present': False,
            'register_is_present': False,
            'remember_me_is_present': False,
        },
    }
    
    base_config = {
        'id': None,
        'page_type': page_type,
        'version': 0,
        'status': 'default',
        'logo_url': None,
        'logo_alt_text': 'Logo',
        'logo_is_present': True,
        'favicon_url': None,
        'background_url': None,
        'background_color': '#ffffff',
        'card_background_color': '#ffffff',
        'primary_color': '#1976d2',
        'secondary_color': '#dc004e',
        'page_title': 'Welcome',
        'page_subtitle': None,
        'page_description': None,
        'primary_button_text': 'Submit',
        'identifier_label': 'Email / Phone / Aadhaar',
        'username_placeholder': 'Enter Email, Phone, or Aadhaar',
        'password_placeholder': 'Enter Password',
        'otp_section_text': 'Login via OTP',
        'otp_button_text': 'Request OTP',
        'otp_is_present': True,
        'forgot_password_text': 'Forgot Password?',
        'forgot_password_is_present': True,
        'register_text': "Don't have an account?",
        'register_link_text': 'Register Now',
        'register_link_url': None,
        'register_is_present': True,
        'remember_me_text': 'Remember Me',
        'remember_me_is_present': True,
        'terms_checkbox_text': 'I agree to the',
        'terms_link_text': 'Terms & Conditions',
        'terms_url': None,
        'terms_is_present': True,
        'terms_required': True,
        'privacy_link_text': 'Privacy Policy',
        'privacy_url': None,
        'privacy_is_present': True,
        'footer_text': None,
        'footer_is_present': True,
    }
    
    # Merge with page-specific defaults
    if page_type in defaults:
        base_config.update(defaults[page_type])
    
    return base_config


class PageConfigService:
    """Service for managing page configurations."""
    
    @staticmethod
    def get_live_config(page_type: str) -> Optional[PageConfig]:
        """Get the currently live configuration for a page type, scoped to
        the current tenant."""
        try:
            pt = PageType(page_type)
        except ValueError:
            return None

        return PageConfig.query.filter_by(
            tenant_id=_current_tenant_id(),
            page_type=pt,
            status=ConfigStatus.LIVE,
        ).first()

    @staticmethod
    def get_draft_config(page_type: str) -> Optional[PageConfig]:
        """Get the draft configuration for a page type, scoped to the
        current tenant."""
        try:
            pt = PageType(page_type)
        except ValueError:
            return None

        return PageConfig.query.filter_by(
            tenant_id=_current_tenant_id(),
            page_type=pt,
            status=ConfigStatus.DRAFT,
        ).first()

    @staticmethod
    def get_preview_config(page_type: str) -> Optional[PageConfig]:
        """Get the preview configuration for a page type, scoped to the
        current tenant."""
        try:
            pt = PageType(page_type)
        except ValueError:
            return None

        return PageConfig.query.filter_by(
            tenant_id=_current_tenant_id(),
            page_type=pt,
            status=ConfigStatus.PREVIEW,
        ).first()

    @staticmethod
    def get_or_create_draft(page_type: str, user_id: str = None) -> PageConfig:
        """Get existing draft or create new one based on live config.

        All operations are scoped to the active tenant — a SUPER_ADMIN of
        tenant A can never observe or mutate tenant B's configs.
        """
        try:
            pt = PageType(page_type)
        except ValueError:
            raise ValueError(f"Invalid page type: {page_type}")

        tenant_id = _current_tenant_id()

        # Check for existing draft (in this tenant)
        draft = PageConfig.query.filter_by(
            tenant_id=tenant_id,
            page_type=pt,
            status=ConfigStatus.DRAFT,
        ).first()

        if draft:
            return draft

        # Get live config (in this tenant) to base draft on
        live = PageConfig.query.filter_by(
            tenant_id=tenant_id,
            page_type=pt,
            status=ConfigStatus.LIVE,
        ).first()

        # Calculate next version (per-tenant)
        max_version = db.session.query(db.func.max(PageConfig.version)).filter_by(
            tenant_id=tenant_id,
            page_type=pt,
        ).scalar() or 0

        if live:
            # Clone live config
            draft = PageConfig(
                tenant_id=tenant_id,
                page_type=pt,
                version=max_version + 1,
                status=ConfigStatus.DRAFT,
                logo_asset_id=live.logo_asset_id,
                logo_alt_text=live.logo_alt_text,
                logo_is_present=live.logo_is_present,
                favicon_asset_id=live.favicon_asset_id,
                background_asset_id=live.background_asset_id,
                background_color=live.background_color,
                card_background_color=live.card_background_color,
                primary_color=live.primary_color,
                secondary_color=live.secondary_color,
                page_title=live.page_title,
                page_subtitle=live.page_subtitle,
                page_description=live.page_description,
                primary_button_text=live.primary_button_text,
                otp_section_text=live.otp_section_text,
                otp_button_text=live.otp_button_text,
                otp_is_present=live.otp_is_present,
                forgot_password_text=live.forgot_password_text,
                forgot_password_is_present=live.forgot_password_is_present,
                register_text=live.register_text,
                register_link_text=live.register_link_text,
                register_link_url=live.register_link_url,
                register_is_present=live.register_is_present,
                remember_me_text=live.remember_me_text,
                remember_me_is_present=live.remember_me_is_present,
                terms_checkbox_text=live.terms_checkbox_text,
                terms_link_text=live.terms_link_text,
                terms_asset_id=live.terms_asset_id,
                terms_is_present=live.terms_is_present,
                terms_required=live.terms_required,
                privacy_link_text=live.privacy_link_text,
                privacy_asset_id=live.privacy_asset_id,
                privacy_is_present=live.privacy_is_present,
                footer_text=live.footer_text,
                footer_is_present=live.footer_is_present,
                translations=live.translations,
                published_languages=live.published_languages,
                created_by_id=user_id,
            )
        else:
            # Create new draft with defaults
            defaults = get_default_config(page_type)
            draft = PageConfig(
                tenant_id=tenant_id,
                page_type=pt,
                version=1,
                status=ConfigStatus.DRAFT,
                page_title=defaults.get('page_title', 'Welcome'),
                page_subtitle=defaults.get('page_subtitle'),
                primary_button_text=defaults.get('primary_button_text', 'Submit'),
                otp_is_present=defaults.get('otp_is_present', True),
                forgot_password_is_present=defaults.get('forgot_password_is_present', True),
                register_is_present=defaults.get('register_is_present', True),
                register_link_url=defaults.get('register_link_url'),
                remember_me_is_present=defaults.get('remember_me_is_present', True),
                created_by_id=user_id,
            )
        
        db.session.add(draft)
        db.session.commit()
        
        # Audit log
        PageConfigService.log_action(
            config_id=draft.id,
            page_type=page_type,
            action=AuditAction.CREATE,
            user_id=user_id,
            new_values=draft.to_dict()
        )
        
        return draft
    
    @staticmethod
    def update_draft(page_type: str, data: dict, user_id: str = None) -> PageConfig:
        """Update draft configuration."""
        draft = PageConfigService.get_or_create_draft(page_type, user_id)
        
        previous = draft.to_dict()
        
        # Updatable fields
        updatable_fields = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color','card_background_color',
            'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'identifier_label', 'username_placeholder', 'password_placeholder',
            'otp_section_text', 'otp_button_text', 'otp_is_present',
            'forgot_password_text', 'forgot_password_is_present',
            'register_text', 'register_link_text', 'register_link_url', 'register_is_present',
            'remember_me_text', 'remember_me_is_present',
            'terms_checkbox_text', 'terms_link_text', 'terms_asset_id',
            'terms_is_present', 'terms_required',
            'privacy_link_text', 'privacy_asset_id', 'privacy_is_present',
            'footer_text', 'footer_is_present',
            'fields', 'translations', 'published_languages',
        ]
        
        for field in updatable_fields:
            if field in data:
                setattr(draft, field, data[field])
        
        db.session.commit()
        
        # Audit log
        PageConfigService.log_action(
            config_id=draft.id,
            page_type=page_type,
            action=AuditAction.UPDATE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict()
        )
        
        return draft
    
    @staticmethod
    def promote_to_preview(page_type: str, user_id: str = None) -> PageConfig:
        """Promote draft to preview status."""
        draft = PageConfigService.get_draft_config(page_type)
        if not draft:
            raise ValueError(f"No draft config found for {page_type}")
        
        # Archive any existing preview
        existing_preview = PageConfigService.get_preview_config(page_type)
        if existing_preview:
            existing_preview.status = ConfigStatus.ARCHIVED
        
        draft.status = ConfigStatus.PREVIEW
        db.session.commit()
        
        PageConfigService.log_action(
            config_id=draft.id,
            page_type=page_type,
            action=AuditAction.PREVIEW,
            user_id=user_id
        )
        
        return draft
    
    @staticmethod
    def publish(page_type: str, user_id: str = None) -> PageConfig:
        """Publish preview to live."""
        preview = PageConfigService.get_preview_config(page_type)
        if not preview:
            raise ValueError(f"No preview config found for {page_type}")
        
        # Archive current live
        current_live = PageConfigService.get_live_config(page_type)
        if current_live:
            current_live.status = ConfigStatus.ARCHIVED
            PageConfigService.log_action(
                config_id=current_live.id,
                page_type=page_type,
                action=AuditAction.ARCHIVE,
                user_id=user_id
            )
        
        # Promote preview to live
        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)
        db.session.commit()
        
        PageConfigService.log_action(
            config_id=preview.id,
            page_type=page_type,
            action=AuditAction.PUBLISH,
            user_id=user_id
        )
        
        return preview
    
    @staticmethod
    def restore_version(page_type: str, version_id: str, user_id: str = None) -> PageConfig:
        """Restore a specific version by copying its config into the current draft."""
        try:
            pt = PageType(page_type)
        except ValueError:
            raise ValueError(f"Invalid page type: {page_type}")

        # Find the version to restore — must belong to the active tenant
        source = PageConfig.query.filter_by(
            tenant_id=_current_tenant_id(), id=version_id,
        ).first()
        if not source:
            raise ValueError(f"Version {version_id} not found")
        if source.page_type != pt:
            raise ValueError(f"Version {version_id} does not belong to page type {page_type}")

        # Get or create draft
        draft = PageConfigService.get_or_create_draft(page_type, user_id)

        # Copy all configurable fields from source to draft
        copyable_fields = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color','card_background_color',
            'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'identifier_label', 'username_placeholder', 'password_placeholder',
            'otp_section_text', 'otp_button_text', 'otp_is_present',
            'forgot_password_text', 'forgot_password_is_present',
            'register_text', 'register_link_text', 'register_link_url', 'register_is_present',
            'remember_me_text', 'remember_me_is_present',
            'terms_checkbox_text', 'terms_link_text', 'terms_asset_id',
            'terms_is_present', 'terms_required',
            'privacy_link_text', 'privacy_asset_id', 'privacy_is_present',
            'footer_text', 'footer_is_present',
            'translations', 'published_languages',
        ]

        previous = draft.to_dict()
        for field in copyable_fields:
            setattr(draft, field, getattr(source, field))

        db.session.commit()

        # Audit log
        PageConfigService.log_action(
            config_id=draft.id,
            page_type=page_type,
            action=AuditAction.UPDATE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict(),
            notes=f"Restored from version {source.version} (id: {version_id})"
        )

        return draft

    @staticmethod
    def get_version_history(page_type: str, limit: int = 10) -> List[PageConfig]:
        """Get version history for a page type, scoped to this tenant."""
        try:
            pt = PageType(page_type)
        except ValueError:
            return []

        return PageConfig.query.filter_by(
            tenant_id=_current_tenant_id(),
            page_type=pt,
        ).order_by(PageConfig.version.desc()).limit(limit).all()

    @staticmethod
    def get_audit_logs(page_type: str = None, limit: int = 50) -> List[ConfigAuditLog]:
        """Get audit logs for the current tenant, optionally filtered by page type."""
        query = ConfigAuditLog.query.filter_by(tenant_id=_current_tenant_id())
        if page_type:
            query = query.filter_by(page_type=page_type)
        return query.order_by(ConfigAuditLog.timestamp.desc()).limit(limit).all()

    @staticmethod
    def log_action(
        config_id,
        page_type: str,
        action: AuditAction,
        user_id: str = None,
        previous_values: dict = None,
        new_values: dict = None,
        notes: str = None
    ):
        """Create audit log entry, tagged with the current tenant."""
        ip_address = request.remote_addr if request else None

        log = ConfigAuditLog(
            tenant_id=_current_tenant_id(),
            config_id=config_id,
            page_type=page_type,
            action=action,
            user_id=user_id,
            previous_values=previous_values,
            new_values=new_values,
            ip_address=ip_address,
            notes=notes,
        )
        db.session.add(log)
        db.session.commit()
        return log


class AssetService:
    """Service for managing page config assets — all per-tenant."""

    @staticmethod
    def get_all_assets(asset_type: str = None, active_only: bool = True) -> List[PageConfigAsset]:
        """Get all assets for the current tenant, optionally filtered by type."""
        query = PageConfigAsset.query.filter_by(tenant_id=_current_tenant_id())
        if active_only:
            query = query.filter_by(is_active=True)
        if asset_type:
            try:
                at = AssetType(asset_type)
                query = query.filter_by(asset_type=at)
            except ValueError:
                pass
        return query.order_by(PageConfigAsset.created_at.desc()).all()

    @staticmethod
    def get_asset_by_id(asset_id: str) -> Optional[PageConfigAsset]:
        """Get asset by ID — only if it belongs to the current tenant."""
        return PageConfigAsset.query.filter_by(
            tenant_id=_current_tenant_id(), id=asset_id,
        ).first()

    @staticmethod
    def create_asset(
        asset_type: str,
        name: str,
        s3_data: dict,
        original_filename: str,
        user_id: str = None
    ) -> PageConfigAsset:
        """Create new asset record under the current tenant."""
        try:
            at = AssetType(asset_type)
        except ValueError:
            raise ValueError(f"Invalid asset type: {asset_type}")

        asset = PageConfigAsset(
            tenant_id=_current_tenant_id(),
            asset_type=at,
            name=name,
            s3_bucket=s3_data['s3_bucket'],
            s3_key=s3_data['s3_key'],
            s3_region=s3_data['s3_region'],
            content_type=s3_data.get('content_type'),
            file_size_bytes=s3_data.get('file_size_bytes'),
            original_filename=original_filename,
            uploaded_by_id=user_id,
        )
        db.session.add(asset)
        db.session.commit()
        
        # Audit log
        PageConfigService.log_action(
            config_id=None,
            page_type='assets',
            action=AuditAction.ASSET_UPLOAD,
            user_id=user_id,
            new_values={'asset_id': str(asset.id), 'name': name, 'type': asset_type}
        )
        
        return asset
    
    @staticmethod
    def is_asset_in_use(asset_id: str) -> bool:
        """Check if asset is used by any LIVE config in the current tenant."""
        asset_uuid = asset_id
        tenant_id = _current_tenant_id()

        return PageConfig.query.filter(
            PageConfig.tenant_id == tenant_id,
            PageConfig.status == ConfigStatus.LIVE,
            db.or_(
                PageConfig.logo_asset_id == asset_uuid,
                PageConfig.favicon_asset_id == asset_uuid,
                PageConfig.background_asset_id == asset_uuid,
                PageConfig.terms_asset_id == asset_uuid,
                PageConfig.privacy_asset_id == asset_uuid,
            )
        ).first() is not None

    @staticmethod
    def delete_asset(asset_id: str, user_id: str = None) -> bool:
        """Soft delete an asset for the current tenant.

        Returns False if asset is used by a LIVE config or doesn't belong
        to this tenant.
        """
        if AssetService.is_asset_in_use(asset_id):
            return False

        asset = AssetService.get_asset_by_id(asset_id)
        if not asset:
            return False
        
        asset.is_active = False
        db.session.commit()
        
        # Audit log
        PageConfigService.log_action(
            config_id=None,
            page_type='assets',
            action=AuditAction.ASSET_DELETE,
            user_id=user_id,
            previous_values={'asset_id': str(asset.id), 'name': asset.name}
        )
        
        return True
