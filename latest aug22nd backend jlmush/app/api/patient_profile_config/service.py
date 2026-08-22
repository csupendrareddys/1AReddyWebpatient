"""Patient Profile Configuration Service — Business logic for patient profile page config management."""
import copy
from datetime import datetime, timezone
from typing import Optional, List

from flask import request

from app.extensions import db
from app.models import (
    PageConfig, PageFieldConfig, ConfigAuditLog,
    PageType, ConfigStatus, AuditAction,
)
from app.api.patient_profile_config.default_fields import (
    PATIENT_PROFILE_SECTIONS, PATIENT_PROFILE_FIELDS
)
from app.api.patient_profile_config.data_resolver import resolve_data_source
from app.common.tenant_context import current_tenant_id_strict


PAGE_TYPE = 'patient_profile'
PAGE_TYPE_ENUM = PageType.PATIENT_PROFILE

# Maps frontend TAB_GROUP keys -> backend section keys
SECTION_GROUPS = {
    'personal': ['personal_details', 'contact_identity', 'address', 'emergency_contact', 'insurance', 'female_health'],
    'vitals': ['vitals'],
    'habits': ['habits'],
    'surgeries': ['surgeries'],
    'health_records': ['health_records'],
    'prescriptions': ['previous_prescriptions'],
    'family_group': ['house_family_group'],
}


def apply_translations(config_dict, field_configs, lang):
    """Override default English values with translations for the given language."""
    if not lang or lang == 'en':
        return config_dict

    # Page-level translations
    page_translations = config_dict.get('translations') or {}
    for key, lang_map in page_translations.items():
        if isinstance(lang_map, dict) and lang in lang_map:
            config_dict[key] = lang_map[lang]

    # Section-level translations
    fields = config_dict.get('fields') or {}
    sections = fields.get('sections', []) if isinstance(fields, dict) else []
    for section in sections:
        section_translations = section.get('translations', {})
        if isinstance(section_translations, dict) and lang in section_translations:
            section['label'] = section_translations[lang]

    # Field-level translations
    for field in field_configs:
        field_translations = field.get('translations') or {}
        for key, lang_map in field_translations.items():
            if isinstance(lang_map, dict) and lang in lang_map:
                field[key] = lang_map[lang]

    return config_dict


def filter_by_user_type(sections, field_configs, user_type):
    """Filter sections and fields by user_type RBAC."""
    if not user_type:
        return sections, field_configs

    filtered_sections = [
        s for s in sections
        if not s.get('user_types') or user_type in s['user_types']
    ]
    visible_section_keys = {s['key'] for s in filtered_sections}

    filtered_fields = [
        f for f in field_configs
        if f.get('section') in visible_section_keys
        and (not f.get('user_types') or user_type in f['user_types'])
    ]

    return filtered_sections, filtered_fields


class PatientProfileConfigService:
    """Service for managing patient profile page configurations."""

    # ---- Read operations ----

    @staticmethod
    def get_live_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE
        ).first()

    @staticmethod
    def get_draft_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.DRAFT
        ).first()

    @staticmethod
    def get_preview_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.PREVIEW
        ).first()

    @staticmethod
    def get_all_configs():
        draft = PatientProfileConfigService.get_draft_config()
        preview = PatientProfileConfigService.get_preview_config()
        live = PatientProfileConfigService.get_live_config()
        return {
            'draft': draft.to_dict(include_asset_urls=True) if draft else None,
            'preview': preview.to_dict(include_asset_urls=True) if preview else None,
            'live': live.to_dict(include_asset_urls=True) if live else None,
        }

    @staticmethod
    def get_field_configs(config_id, section_group=None):
        query = PageFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            config_id=config_id,
        )
        if section_group:
            section_keys = SECTION_GROUPS.get(section_group, [])
            if section_keys:
                query = query.filter(PageFieldConfig.section.in_(section_keys))
        return query.order_by(
            PageFieldConfig.section,
            PageFieldConfig.display_order
        ).all()

    # ---- Draft management ----

    @staticmethod
    def _sync_missing_sections(draft):
        """Ensure draft has all sections and field configs from defaults."""
        tid = current_tenant_id_strict()
        fields = draft.fields or {}
        existing_section_keys = {s['key'] for s in (fields.get('sections') or [])}
        added_sections = []
        for ds in PATIENT_PROFILE_SECTIONS:
            if ds['key'] not in existing_section_keys:
                added_sections.append(copy.deepcopy(ds))

        if added_sections:
            sections_list = list(fields.get('sections') or [])
            sections_list.extend(added_sections)
            fields['sections'] = sections_list
            draft.fields = fields
            import sqlalchemy
            sqlalchemy.orm.attributes.flag_modified(draft, 'fields')

        # Sync missing field configs — only ADD fields that don't exist yet.
        # Never delete or overwrite existing fields (admin may have customised them).
        existing_fields_by_section = {}
        for fc in PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).all():
            existing_fields_by_section.setdefault(fc.section, set()).add(fc.field_key)

        # Backfill is_default=True for existing fields that match default keys
        for section_key, fields_list in PATIENT_PROFILE_FIELDS.items():
            default_keys = [f['field_key'] for f in fields_list]
            if default_keys:
                PageFieldConfig.query.filter(
                    PageFieldConfig.tenant_id == tid,
                    PageFieldConfig.config_id == draft.id,
                    PageFieldConfig.section == section_key,
                    PageFieldConfig.field_key.in_(default_keys),
                    PageFieldConfig.is_default == False,  # noqa: E712
                ).update({'is_default': True}, synchronize_session=False)

        added_fields = False
        for section_key, fields_list in PATIENT_PROFILE_FIELDS.items():
            existing_keys = existing_fields_by_section.get(section_key, set())
            for field_def in fields_list:
                if field_def['field_key'] not in existing_keys:
                    new_field = PageFieldConfig(
                        tenant_id=tid,
                        config_id=draft.id,
                        page_type=PAGE_TYPE,
                        section=section_key,
                        field_key=field_def['field_key'],
                        field_type=field_def.get('field_type', 'text'),
                        label=field_def['label'],
                        placeholder=field_def.get('placeholder'),
                        helper_text=field_def.get('helper_text'),
                        icon=field_def.get('icon'),
                        required=field_def.get('required', False),
                        min_length=field_def.get('min_length'),
                        max_length=field_def.get('max_length'),
                        display_order=field_def.get('display_order', 0),
                        is_present=field_def.get('is_present', True),
                        is_default=True,
                        data_source=field_def.get('data_source'),
                        options=field_def.get('options'),
                        validation_regex=field_def.get('validation_regex'),
                        validation_message=field_def.get('validation_message'),
                    )
                    db.session.add(new_field)
                    added_fields = True

        db.session.commit()

    @staticmethod
    def get_or_create_draft(user_id=None):
        """Get existing draft or create new one based on live config."""
        tid = current_tenant_id_strict()
        draft = PatientProfileConfigService.get_draft_config()
        if draft:
            PatientProfileConfigService._sync_missing_sections(draft)
            return draft

        live = PatientProfileConfigService.get_live_config()
        max_version = db.session.query(db.func.max(PageConfig.version)).filter_by(
            tenant_id=tid,
            page_type=PAGE_TYPE_ENUM,
        ).scalar() or 0

        if live:
            draft = PageConfig(
                tenant_id=tid,
                page_type=PAGE_TYPE_ENUM,
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
                footer_text=live.footer_text,
                footer_is_present=live.footer_is_present,
                fields=copy.deepcopy(live.fields),
                translations=copy.deepcopy(live.translations),
                created_by_id=user_id,
            )
            db.session.add(draft)
            db.session.flush()

            live_fields = PatientProfileConfigService.get_field_configs(live.id)
            for lf in live_fields:
                new_field = PageFieldConfig(
                    tenant_id=tid,
                    config_id=draft.id,
                    page_type=PAGE_TYPE,
                    section=lf.section,
                    field_key=lf.field_key,
                    field_type=lf.field_type,
                    label=lf.label,
                    placeholder=lf.placeholder,
                    helper_text=lf.helper_text,
                    icon=lf.icon,
                    required=lf.required,
                    min_length=lf.min_length,
                    max_length=lf.max_length,
                    validation_regex=lf.validation_regex,
                    validation_message=lf.validation_message,
                    display_order=lf.display_order,
                    is_present=lf.is_present,
                    is_default=lf.is_default,
                    options=copy.deepcopy(lf.options),
                    user_types=copy.deepcopy(lf.user_types),
                    data_source=lf.data_source,
                    translations=copy.deepcopy(lf.translations),
                )
                db.session.add(new_field)
        else:
            # Create new draft with defaults
            draft = PageConfig(
                tenant_id=tid,
                page_type=PAGE_TYPE_ENUM,
                version=1,
                status=ConfigStatus.DRAFT,
                page_title='Patient Profile Settings',
                page_subtitle='Manage your health profile',
                primary_button_text='Save Profile',
                fields={'sections': copy.deepcopy(PATIENT_PROFILE_SECTIONS)},
                created_by_id=user_id,
            )
            db.session.add(draft)
            db.session.flush()

            for section_key, fields_list in PATIENT_PROFILE_FIELDS.items():
                for field_def in fields_list:
                    new_field = PageFieldConfig(
                        tenant_id=tid,
                        config_id=draft.id,
                        page_type=PAGE_TYPE,
                        section=section_key,
                        field_key=field_def['field_key'],
                        field_type=field_def.get('field_type', 'text'),
                        label=field_def['label'],
                        placeholder=field_def.get('placeholder'),
                        helper_text=field_def.get('helper_text'),
                        icon=field_def.get('icon'),
                        required=field_def.get('required', False),
                        min_length=field_def.get('min_length'),
                        max_length=field_def.get('max_length'),
                        display_order=field_def.get('display_order', 0),
                        is_present=field_def.get('is_present', True),
                        is_default=True,
                        data_source=field_def.get('data_source'),
                        options=field_def.get('options'),
                        validation_regex=field_def.get('validation_regex'),
                        validation_message=field_def.get('validation_message'),
                    )
                    db.session.add(new_field)

        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.CREATE,
            user_id=user_id,
            new_values=draft.to_dict()
        )
        return draft

    @staticmethod
    def update_draft(data, user_id=None):
        """Update draft page-level configuration."""
        draft = PatientProfileConfigService.get_or_create_draft(user_id)
        previous = draft.to_dict()

        updatable_fields = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color',
            'card_background_color', 'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'footer_text', 'footer_is_present',
            'fields', 'translations',
        ]

        for field in updatable_fields:
            if field in data:
                setattr(draft, field, data[field])

        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.UPDATE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict()
        )
        return draft

    @staticmethod
    def update_field_configs(field_updates, user_id=None):
        """Update individual PageFieldConfig rows."""
        draft = PatientProfileConfigService.get_or_create_draft(user_id)

        updatable = [
            'label', 'placeholder', 'helper_text', 'icon',
            'required', 'min_length', 'max_length',
            'validation_regex', 'validation_message',
            'display_order', 'is_present', 'user_types',
            'data_source', 'translations', 'options',
            # field_type is allowed only for non-default fields
        ]

        updated_fields = []
        for update in field_updates:
            field_id = update.get('id')
            if not field_id:
                continue

            # Handle new field creation (temp ID starts with 'new_')
            if isinstance(field_id, str) and field_id.startswith('new_'):
                new_field = PageFieldConfig(
                    tenant_id=current_tenant_id_strict(),
                    config_id=draft.id,
                    page_type=PAGE_TYPE,
                    section=update.get('section', 'personal_details'),
                    field_key=update.get('field_key', f'custom_{field_id}'),
                    field_type=update.get('field_type', 'text'),
                    label=update.get('label', ''),
                    placeholder=update.get('placeholder'),
                    helper_text=update.get('helper_text'),
                    required=update.get('required', False),
                    display_order=update.get('display_order', 999),
                    is_present=update.get('is_present', True),
                    data_source=update.get('data_source'),
                    options=update.get('options'),
                    translations=update.get('translations', {}),
                )
                db.session.add(new_field)
                db.session.flush()
                updated_fields.append(new_field.to_dict())
                continue

            field = PageFieldConfig.query.filter_by(
                tenant_id=current_tenant_id_strict(),
                id=field_id,
                config_id=draft.id,
            ).first()
            if not field:
                continue

            for key in updatable:
                if key in update:
                    setattr(field, key, update[key])
            # Allow field_type change only for non-default (admin-added) fields
            if 'field_type' in update and not field.is_default:
                field.field_type = update['field_type']

            updated_fields.append(field.to_dict())

        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.UPDATE,
            user_id=user_id,
            new_values={'updated_fields': updated_fields},
            notes='Field configs updated'
        )
        return updated_fields

    @staticmethod
    def delete_field(field_id, user_id=None):
        """Delete a non-default admin-added field from the draft config."""
        draft = PatientProfileConfigService.get_or_create_draft(user_id)
        field = PageFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=field_id,
            config_id=draft.id,
        ).first()
        if not field:
            raise ValueError('Field not found')
        if field.is_default:
            raise ValueError('Cannot delete a built-in default field')
        db.session.delete(field)
        db.session.commit()
        return True

    # ---- Workflow operations ----

    @staticmethod
    def promote_to_preview(user_id=None):
        draft = PatientProfileConfigService.get_draft_config()
        if not draft:
            raise ValueError("No draft config found for patient_profile")

        existing_preview = PatientProfileConfigService.get_preview_config()
        if existing_preview:
            existing_preview.status = ConfigStatus.ARCHIVED

        draft.status = ConfigStatus.PREVIEW
        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.PREVIEW,
            user_id=user_id
        )
        return draft

    @staticmethod
    def publish(user_id=None):
        preview = PatientProfileConfigService.get_preview_config()
        if not preview:
            raise ValueError("No preview config found for patient_profile")

        # Archive ALL existing live configs (not just one)
        all_live = PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE,
        ).all()
        for live_config in all_live:
            live_config.status = ConfigStatus.ARCHIVED
            PatientProfileConfigService.log_action(
                config_id=live_config.id,
                action=AuditAction.ARCHIVE,
                user_id=user_id
            )

        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)
        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=preview.id,
            action=AuditAction.PUBLISH,
            user_id=user_id
        )
        return preview

    @staticmethod
    def restore_version(version_id, user_id=None):
        tid = current_tenant_id_strict()
        source = PageConfig.query.filter_by(id=version_id, tenant_id=tid).first()
        if not source:
            raise ValueError(f"Version {version_id} not found")
        if source.page_type != PAGE_TYPE_ENUM:
            raise ValueError(f"Version {version_id} does not belong to patient_profile")

        draft = PatientProfileConfigService.get_or_create_draft(user_id)
        previous = draft.to_dict()

        copyable_fields = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color',
            'card_background_color', 'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'footer_text', 'footer_is_present',
            'fields', 'translations',
        ]
        for f in copyable_fields:
            val = getattr(source, f)
            setattr(draft, f, copy.deepcopy(val) if isinstance(val, (dict, list)) else val)

        # Replace field configs
        PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).delete()
        source_fields = PatientProfileConfigService.get_field_configs(source.id)
        for sf in source_fields:
            new_field = PageFieldConfig(
                tenant_id=tid,
                config_id=draft.id,
                page_type=PAGE_TYPE,
                section=sf.section,
                field_key=sf.field_key,
                field_type=sf.field_type,
                label=sf.label,
                placeholder=sf.placeholder,
                helper_text=sf.helper_text,
                icon=sf.icon,
                required=sf.required,
                min_length=sf.min_length,
                max_length=sf.max_length,
                validation_regex=sf.validation_regex,
                validation_message=sf.validation_message,
                display_order=sf.display_order,
                is_present=sf.is_present,
                is_default=sf.is_default,
                options=copy.deepcopy(sf.options),
                user_types=copy.deepcopy(sf.user_types),
                data_source=sf.data_source,
                translations=copy.deepcopy(sf.translations),
            )
            db.session.add(new_field)

        db.session.commit()

        PatientProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.RESTORE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict(),
            notes=f'Restored from version {source.version}'
        )
        return draft

    @staticmethod
    def get_version_history(limit=20):
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
        ).order_by(PageConfig.version.desc()).limit(limit).all()

    @staticmethod
    def get_audit_logs(limit=50):
        tid = current_tenant_id_strict()
        return ConfigAuditLog.query.join(PageConfig).filter(
            ConfigAuditLog.tenant_id == tid,
            PageConfig.tenant_id == tid,
            PageConfig.page_type == PAGE_TYPE_ENUM,
        ).order_by(ConfigAuditLog.created_at.desc()).limit(limit).all()

    # ---- Merged config (public endpoint) ----

    @staticmethod
    def get_merged_config(lang=None, user_type=None):
        """
        Get the live config merged with field configs, translations applied,
        RBAC filtered, and dropdown data sources resolved.
        """
        live = PatientProfileConfigService.get_live_config()
        # Fall back to draft if no live config exists yet
        if not live:
            live = PatientProfileConfigService.get_draft_config()
        if not live:
            return {'page_config': None, 'field_configs': [], 'data_sources': {}}

        config_dict = live.to_dict(include_asset_urls=True)
        field_configs = [f.to_dict() for f in PatientProfileConfigService.get_field_configs(live.id)]

        # Apply translations
        config_dict = apply_translations(config_dict, field_configs, lang)

        # RBAC filtering
        fields = config_dict.get('fields') or {}
        sections = fields.get('sections', []) if isinstance(fields, dict) else []
        sections, field_configs = filter_by_user_type(sections, field_configs, user_type)
        if isinstance(fields, dict):
            fields['sections'] = sections
            config_dict['fields'] = fields

        # Resolve data sources
        data_sources = {}
        for fc in field_configs:
            ds = fc.get('data_source')
            if ds and ds not in data_sources:
                data_sources[ds] = resolve_data_source(ds)

        return {
            'page_config': config_dict,
            'field_configs': field_configs,
            'data_sources': data_sources,
        }

    # ---- Audit logging ----

    @staticmethod
    def log_action(config_id, action, user_id=None, previous_values=None, new_values=None, notes=None):
        try:
            log = ConfigAuditLog(
                tenant_id=current_tenant_id_strict(),
                config_id=config_id,
                page_type=PAGE_TYPE,
                action=action,
                user_id=user_id,
                previous_values=previous_values,
                new_values=new_values,
                ip_address=request.remote_addr if request else None,
                notes=notes,
            )
            db.session.add(log)
            db.session.commit()
        except Exception:
            db.session.rollback()
