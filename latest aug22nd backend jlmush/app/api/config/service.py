"""
Login Page Configuration Service
Business logic for managing login page configurations.

All four models (LoginPageConfig, LoginFieldConfig, UserTypeConfig,
ExtraButtonConfig) extend TenantMixin — every read filters by tenant_id
and every INSERT sets tenant_id. ``get_active_config`` is reachable from
both an anonymous public endpoint and JWT-protected admin endpoints, so
it resolves tenant via ``current_tenant_id_or_default`` (falls back to
the default tenant for anonymous traffic). Mutations use
``current_tenant_id_strict`` since they're admin-only.
"""
from typing import Optional, Dict, Any, List
from app.models import (
    LoginPageConfig, LoginFieldConfig, UserTypeConfig, ExtraButtonConfig
)
from app.extensions import db
from app.common.tenant_context import (
    current_tenant_id_strict,
    current_tenant_id_or_default,
)


class LoginPageConfigService:
    """Service layer for login page configuration operations."""

    @staticmethod
    def get_active_config() -> Optional[LoginPageConfig]:
        """
        Get the active login page configuration for the current tenant.
        Creates a default config for the tenant if none exists.
        """
        tid = current_tenant_id_or_default()
        config = LoginPageConfig.query.filter_by(
            tenant_id=tid, is_active=True,
        ).first()

        if not config:
            config = LoginPageConfigService.create_default_config(tid)

        return config

    @staticmethod
    def get_config_by_id(config_id: str) -> Optional[LoginPageConfig]:
        """Get a specific configuration by ID, scoped to the current tenant."""
        return LoginPageConfig.query.filter_by(
            tenant_id=current_tenant_id_or_default(),
            id=config_id,
        ).first()

    @staticmethod
    def create_default_config(tenant_id=None) -> LoginPageConfig:
        """
        Create and return a default login page configuration.
        Called when no active config exists for the current tenant.
        """
        tid = tenant_id or current_tenant_id_or_default()

        config = LoginPageConfig(
            tenant_id=tid,
            is_active=True,
            page_title='Sign In',
            page_subtitle='Welcome back!',
        )
        db.session.add(config)
        db.session.flush()  # Get the ID before adding related records

        # Add default fields
        default_fields = [
            {
                'field_key': 'username',
                'field_type': 'text',
                'label': 'Email / Phone / Aadhaar',
                'placeholder': 'Enter email, phone, or Aadhaar',
                'icon': 'Person',
                'display_order': 1,
            },
            {
                'field_key': 'password',
                'field_type': 'password',
                'label': 'Password',
                'placeholder': 'Enter your password',
                'icon': 'Lock',
                'display_order': 2,
            },
        ]

        for field_data in default_fields:
            field = LoginFieldConfig(tenant_id=tid, config_id=config.id, **field_data)
            db.session.add(field)

        # Add default user types
        default_user_types = [
            {'type_key': 'patient', 'display_name': 'Patient', 'display_order': 1, 'default_selected': False, 'signup_route': '/auth/service-receiver/signup'},
            {'type_key': 'doctor', 'display_name': 'Doctor', 'display_order': 2, 'signup_route': '/auth/service-provider/signup'},
            {'type_key': 'corporate', 'display_name': 'Corporate', 'display_order': 3, 'signup_route': '/auth/corporate/signup'},
            {'type_key': 'admin', 'display_name': 'Admin', 'display_order': 4, 'default_selected': True, 'signup_route': None},
        ]

        for ut_data in default_user_types:
            user_type = UserTypeConfig(tenant_id=tid, config_id=config.id, **ut_data)
            db.session.add(user_type)

        db.session.commit()
        return config

    @staticmethod
    def update_config(config_id: str, data: Dict[str, Any]) -> Optional[LoginPageConfig]:
        """
        Update a login page configuration.
        Handles both main config fields and nested children.
        """
        config = LoginPageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=config_id,
        ).first()
        if not config:
            return None

        # Update main config fields
        main_fields = [
            'logo_url', 'logo_alt_text', 'logo_is_present',
            'page_title', 'page_subtitle',
            'login_tab_text', 'signup_tab_text', 'signup_tab_is_present',
            'login_button_text', 'otp_button_text', 'otp_section_text', 'otp_section_is_present',
            'forgot_password_text', 'forgot_password_is_present',
            'register_text', 'register_link_text', 'register_is_present',
            'terms_checkbox_text', 'terms_link_text', 'terms_is_present', 'terms_required',
            'remember_me_text', 'remember_me_is_present',
            'user_type_selector_is_present',
        ]

        for field in main_fields:
            if field in data:
                setattr(config, field, data[field])

        db.session.commit()
        return config

    @staticmethod
    def update_field(field_id: str, data: Dict[str, Any]) -> Optional[LoginFieldConfig]:
        """Update a specific field configuration."""
        field = LoginFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=field_id,
        ).first()
        if not field:
            return None

        updateable_fields = [
            'field_key', 'field_type', 'label', 'placeholder', 'helper_text', 'icon',
            'required', 'min_length', 'max_length', 'validation_regex', 'validation_message',
            'display_order', 'is_present', 'user_types'
        ]

        for f in updateable_fields:
            if f in data:
                setattr(field, f, data[f])

        db.session.commit()
        return field

    @staticmethod
    def add_field(config_id: str, data: Dict[str, Any]) -> LoginFieldConfig:
        """Add a new field to a configuration."""
        field = LoginFieldConfig(
            tenant_id=current_tenant_id_strict(),
            config_id=config_id,
            **data,
        )
        db.session.add(field)
        db.session.commit()
        return field

    @staticmethod
    def delete_field(field_id: str) -> bool:
        """Delete a field configuration."""
        field = LoginFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=field_id,
        ).first()
        if not field:
            return False
        db.session.delete(field)
        db.session.commit()
        return True

    @staticmethod
    def update_user_type(user_type_id: str, data: Dict[str, Any]) -> Optional[UserTypeConfig]:
        """Update a specific user type configuration."""
        user_type = UserTypeConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=user_type_id,
        ).first()
        if not user_type:
            return None

        updateable_fields = ['display_name', 'display_order', 'is_present', 'default_selected', 'signup_route']

        for f in updateable_fields:
            if f in data:
                setattr(user_type, f, data[f])

        db.session.commit()
        return user_type

    @staticmethod
    def add_extra_button(config_id: str, data: Dict[str, Any]) -> ExtraButtonConfig:
        """Add a new extra button to a configuration."""
        button = ExtraButtonConfig(
            tenant_id=current_tenant_id_strict(),
            config_id=config_id,
            **data,
        )
        db.session.add(button)
        db.session.commit()
        return button

    @staticmethod
    def update_extra_button(button_id: str, data: Dict[str, Any]) -> Optional[ExtraButtonConfig]:
        """Update an extra button configuration."""
        button = ExtraButtonConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=button_id,
        ).first()
        if not button:
            return None

        updateable_fields = [
            'button_text', 'button_type', 'button_color',
            'action_type', 'action_value', 'icon',
            'display_order', 'is_present'
        ]

        for f in updateable_fields:
            if f in data:
                setattr(button, f, data[f])

        db.session.commit()
        return button

    @staticmethod
    def delete_extra_button(button_id: str) -> bool:
        """Delete an extra button configuration."""
        button = ExtraButtonConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=button_id,
        ).first()
        if not button:
            return False
        db.session.delete(button)
        db.session.commit()
        return True

    @staticmethod
    def get_all_configs() -> List[LoginPageConfig]:
        """Get all login page configurations (admin listing) for the current tenant."""
        return LoginPageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
        ).order_by(LoginPageConfig.created_at.desc()).all()
