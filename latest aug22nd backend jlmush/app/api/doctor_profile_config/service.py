"""Doctor Profile Configuration Service — Business logic for doctor profile page config management."""
import copy
from datetime import datetime, timezone
from typing import Optional, List

from flask import request

from app.extensions import db
from app.models import (
    PageConfig, PageFieldConfig, ConfigAuditLog,
    PageType, ConfigStatus, AuditAction,
    Category, MasterCollege
)
from app.api.doctor_profile_config.default_fields import (
    DOCTOR_PROFILE_SECTIONS, DOCTOR_PROFILE_FIELDS
)
from app.api.doctor_profile_config.data_resolver import resolve_data_source
from app.common.tenant_context import current_tenant_id_strict


PAGE_TYPE = 'doctor_profile'
PAGE_TYPE_ENUM = PageType.DOCTOR_PROFILE

# Maps frontend TAB_GROUP keys → backend section keys
SECTION_GROUPS = {
    'personal_professional': ['personal_details', 'additional_personal_details', 'identity_documents', 'female_health_details', 'current_address', 'permanent_address'],
    'signatures': ['signatures'],
    'about_me': ['about_me'],
    'education': ['education_graduation', 'education_post_graduation', 'education_super_speciality', 'education_other_certification'],
    'bank_details': ['bank_details'],
    'declaration_documents': ['declaration_documents'],
    'working_hours': ['working_days_hours'],
    'pricing': ['consultation_pricing'],
    'analytics': ['doctor_analytics'],
    'attendance_activity': ['doctor_attendance'],
}


def apply_translations(config_dict, field_configs, lang):
    """
    Override default English values with translations for the given language.
    Falls back to default column value when translation is missing.

    Args:
        config_dict: dict from PageConfig.to_dict()
        field_configs: list of dicts from PageFieldConfig.to_dict()
        lang: language code (e.g., 'te', 'hi')

    Returns:
        Modified config_dict with translated values.
    """
    if not lang or lang == 'en':
        return config_dict

    # Page-level translations (page_title, page_subtitle, etc.)
    page_translations = config_dict.get('translations') or {}
    for key, lang_map in page_translations.items():
        if isinstance(lang_map, dict) and lang in lang_map:
            config_dict[key] = lang_map[lang]

    # Section-level translations in fields JSON
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
    """
    Filter sections and fields by user_type RBAC.
    If user_types is null/empty, the section/field is visible to all.
    """
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


class DoctorProfileConfigService:
    """Service for managing doctor profile page configurations."""

    # ---- Read operations ----

    @staticmethod
    def get_live_config():
        """Get the currently live configuration."""
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE
        ).first()

    @staticmethod
    def get_draft_config():
        """Get the draft configuration."""
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.DRAFT
        ).first()

    @staticmethod
    def get_preview_config():
        """Get the preview configuration."""
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.PREVIEW
        ).first()

    @staticmethod
    def get_all_configs():
        """Get draft, preview, and live configs."""
        draft = DoctorProfileConfigService.get_draft_config()
        preview = DoctorProfileConfigService.get_preview_config()
        live = DoctorProfileConfigService.get_live_config()
        return {
            'draft': draft.to_dict(include_asset_urls=True) if draft else None,
            'preview': preview.to_dict(include_asset_urls=True) if preview else None,
            'live': live.to_dict(include_asset_urls=True) if live else None,
        }

    @staticmethod
    def get_field_configs(config_id, section_group=None):
        """Get PageFieldConfig rows for a config, optionally filtered by section group."""
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
        """
        Ensure draft has all sections and field configs from defaults.
        Called when returning an existing draft that may have been created
        before new sections (e.g. analytics, attendance) were added.
        """
        tid = current_tenant_id_strict()

        # Sync sections into fields JSON
        fields = draft.fields or {}
        existing_section_keys = {s['key'] for s in (fields.get('sections') or [])}
        default_sections = DOCTOR_PROFILE_SECTIONS.get('sections', [])
        added_sections = []
        for ds in default_sections:
            if ds['key'] not in existing_section_keys:
                added_sections.append(copy.deepcopy(ds))

        if added_sections:
            sections_list = list(fields.get('sections') or [])
            sections_list.extend(added_sections)
            fields['sections'] = sections_list
            draft.fields = fields
            import sqlalchemy
            sqlalchemy.orm.attributes.flag_modified(draft, 'fields')

        # Sync missing or outdated field configs
        # Get existing field keys per section
        existing_fields_by_section = {}
        existing_q = PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).all()
        for fc in existing_q:
            existing_fields_by_section.setdefault(fc.section, set()).add(fc.field_key)

        # Backfill is_default=True for existing fields that match default keys
        for section_key, fields_list in DOCTOR_PROFILE_FIELDS.items():
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
        for section_key, fields_list in DOCTOR_PROFILE_FIELDS.items():
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
                        required=field_def.get('required', True),
                        min_length=field_def.get('min_length'),
                        max_length=field_def.get('max_length'),
                        display_order=field_def.get('display_order', 0),
                        is_present=field_def.get('is_present', True),
                        is_default=True,
                        data_source=field_def.get('data_source'),
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

        draft = DoctorProfileConfigService.get_draft_config()
        if draft:
            # Auto-sync any new sections/fields added after this draft was created
            DoctorProfileConfigService._sync_missing_sections(draft)
            return draft

        # Get live config to base draft on
        live = DoctorProfileConfigService.get_live_config()

        # Calculate next version (per-tenant)
        max_version = db.session.query(db.func.max(PageConfig.version)).filter_by(
            tenant_id=tid,
            page_type=PAGE_TYPE_ENUM,
        ).scalar() or 0

        if live:
            # Clone live config
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
            db.session.flush()  # Get the draft.id

            # Clone field configs from live.
            #
            # NB: ``options`` and ``is_default`` were missing from this
            # clone for a long time. The symptom: after the user
            # published the page config, the next page refresh would
            # auto-create a new draft from live via this code path —
            # but with options=NULL for every field. The Editor row
            # then rendered "Options (0)" for every dropdown, and on
            # the public signup the dropdowns came up empty for any
            # field that relied on static-options instead of
            # data_source. Same applies to ``is_default``: cloned
            # fields landed in the new draft marked as non-default,
            # which let the operator accidentally delete them.
            # Mirror the full column set the model carries; if a new
            # column is added to PageFieldConfig, add it here too.
            live_fields = DoctorProfileConfigService.get_field_configs(live.id)
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
                    user_types=copy.deepcopy(lf.user_types),
                    data_source=lf.data_source,
                    options=copy.deepcopy(lf.options),
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
                page_title='Doctor Profile Settings',
                page_subtitle='Manage your professional profile',
                primary_button_text='Save Profile',
                fields=copy.deepcopy(DOCTOR_PROFILE_SECTIONS),
                created_by_id=user_id,
            )
            db.session.add(draft)
            db.session.flush()  # Get the draft.id

            # Create default field configs
            for section_key, fields_list in DOCTOR_PROFILE_FIELDS.items():
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
                        required=field_def.get('required', True),
                        min_length=field_def.get('min_length'),
                        max_length=field_def.get('max_length'),
                        display_order=field_def.get('display_order', 0),
                        is_present=field_def.get('is_present', True),
                        is_default=True,
                        data_source=field_def.get('data_source'),
                        validation_regex=field_def.get('validation_regex'),
                        validation_message=field_def.get('validation_message'),
                    )
                    db.session.add(new_field)

        db.session.commit()

        # Audit log
        DoctorProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.CREATE,
            user_id=user_id,
            new_values=draft.to_dict()
        )

        return draft

    @staticmethod
    def update_draft(data, user_id=None):
        """Update draft page-level configuration."""
        draft = DoctorProfileConfigService.get_or_create_draft(user_id)
        previous = draft.to_dict()

        # Updatable page-level fields for doctor profile
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

        DoctorProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.UPDATE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict()
        )

        return draft

    @staticmethod
    def update_field_configs(field_updates, user_id=None):
        """
        Update individual PageFieldConfig rows.

        Args:
            field_updates: list of dicts, each containing 'id' and fields to update.
                e.g., [{"id": "uuid", "label": "New Label", "is_present": false, ...}]
        """
        draft = DoctorProfileConfigService.get_or_create_draft(user_id)

        updatable = [
            'label', 'placeholder', 'helper_text', 'icon',
            'required', 'min_length', 'max_length',
            'validation_regex', 'validation_message',
            'display_order', 'is_present', 'user_types',
            'data_source', 'translations', 'options',
            # field_type allowed only for non-default fields
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
                    section=update.get('section', 'personal_professional'),
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
                    is_default=False,
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

        DoctorProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.UPDATE,
            user_id=user_id,
            new_values={'updated_fields': updated_fields},
            notes='Field configs updated'
        )

        return updated_fields

    @staticmethod
    def delete_field(field_id, user_id=None):
        """Delete a non-default admin-added field from the doctor profile draft."""
        draft = DoctorProfileConfigService.get_or_create_draft(user_id)
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

    # ---- Workflow operations (reuse PageConfig lifecycle) ----

    @staticmethod
    def promote_to_preview(user_id=None):
        """Promote draft to preview status."""
        draft = DoctorProfileConfigService.get_draft_config()
        if not draft:
            raise ValueError("No draft config found for doctor_profile")

        # Archive existing preview
        existing_preview = DoctorProfileConfigService.get_preview_config()
        if existing_preview:
            existing_preview.status = ConfigStatus.ARCHIVED

        draft.status = ConfigStatus.PREVIEW
        db.session.commit()

        DoctorProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.PREVIEW,
            user_id=user_id
        )
        return draft

    @staticmethod
    def publish(user_id=None, note=None):
        """Publish preview to live.

        ``note`` (optional) is the operator's free-text comment about
        what changed in this release — persisted on the PUBLISH audit
        row so the History tab can render it.
        """
        preview = DoctorProfileConfigService.get_preview_config()
        if not preview:
            raise ValueError("No preview config found for doctor_profile")

        # Archive ALL existing live configs (not just one)
        all_live = PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE,
        ).all()
        for live_config in all_live:
            live_config.status = ConfigStatus.ARCHIVED
            DoctorProfileConfigService.log_action(
                config_id=live_config.id,
                action=AuditAction.ARCHIVE,
                user_id=user_id
            )

        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)
        db.session.commit()

        DoctorProfileConfigService.log_action(
            config_id=preview.id,
            action=AuditAction.PUBLISH,
            user_id=user_id,
            notes=note,
        )
        return preview

    @staticmethod
    def restore_version(version_id, user_id=None):
        """Restore a specific version by copying its config into the current draft."""
        tid = current_tenant_id_strict()
        source = PageConfig.query.filter_by(id=version_id, tenant_id=tid).first()
        if not source:
            raise ValueError(f"Version {version_id} not found")
        if source.page_type != PAGE_TYPE_ENUM:
            raise ValueError(f"Version {version_id} does not belong to doctor_profile")

        draft = DoctorProfileConfigService.get_or_create_draft(user_id)
        previous = draft.to_dict()

        # Copy page-level fields
        copyable_fields = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color',
            'card_background_color', 'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'footer_text', 'footer_is_present',
            'fields', 'translations',
        ]
        for field in copyable_fields:
            setattr(draft, field, getattr(source, field))

        # Delete current draft field configs and clone from source
        PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).delete()

        source_fields = DoctorProfileConfigService.get_field_configs(source.id)
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
                # Mirror the full PageFieldConfig column set. ``options``
                # and ``is_default`` were missing here too — restoring a
                # historical version dropped its static options and
                # marked every field non-default, same shape of bug as
                # in ``get_or_create_draft`` above.
                is_default=sf.is_default,
                user_types=copy.deepcopy(sf.user_types),
                data_source=sf.data_source,
                options=copy.deepcopy(sf.options),
                translations=copy.deepcopy(sf.translations),
            )
            db.session.add(new_field)

        db.session.commit()

        DoctorProfileConfigService.log_action(
            config_id=draft.id,
            action=AuditAction.UPDATE,
            user_id=user_id,
            previous_values=previous,
            new_values=draft.to_dict(),
            notes=f"Restored from version {source.version} (id: {version_id})"
        )
        return draft

    @staticmethod
    def get_version_history(limit=10):
        """Get version history with the most-recent PUBLISH note
        attached per version. The note lives on the audit-log row
        (``ConfigAuditLog.notes`` where ``action = PUBLISH``); the
        History tab in the editor renders it inline so operators
        don't have to scroll to the separate Audit Logs section.
        """
        tid = current_tenant_id_strict()
        versions = PageConfig.query.filter_by(
            tenant_id=tid,
            page_type=PAGE_TYPE_ENUM,
        ).order_by(PageConfig.version.desc()).limit(limit).all()

        if not versions:
            return []

        version_ids = [v.id for v in versions]
        # Latest PUBLISH note per config_id. ``order_by(timestamp DESC)``
        # + a Python-side first-wins makes the "republished with new
        # note" case behave: every fresh publish creates a new audit
        # row, and we surface the most recent one.
        publish_logs = ConfigAuditLog.query.filter(
            ConfigAuditLog.tenant_id == tid,
            ConfigAuditLog.config_id.in_(version_ids),
            ConfigAuditLog.action == AuditAction.PUBLISH,
        ).order_by(ConfigAuditLog.timestamp.desc()).all()

        latest_note_by_config_id = {}
        for log in publish_logs:
            cid = str(log.config_id)
            if cid not in latest_note_by_config_id and log.notes:
                latest_note_by_config_id[cid] = log.notes

        # Attach as a transient attribute so to_dict() can pick it up.
        for v in versions:
            v._publish_note = latest_note_by_config_id.get(str(v.id))
        return versions

    @staticmethod
    def get_audit_logs(limit=50):
        """Get audit logs for doctor profile."""
        return ConfigAuditLog.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE,
        ).order_by(ConfigAuditLog.timestamp.desc()).limit(limit).all()

    # ---- Merged public config (with translations, RBAC, dropdown resolution) ----

    @staticmethod
    def get_merged_config(lang=None, user_type=None):
        """
        Get the LIVE config merged with field configs, translations applied,
        RBAC filtered, and dropdown data sources resolved.
        """
        live = DoctorProfileConfigService.get_live_config()
        # Fall back to draft if no live config exists yet
        if not live:
            live = DoctorProfileConfigService.get_draft_config()
        if not live:
            # Return defaults
            return {
                'page_config': {
                    'page_title': 'Doctor Profile Settings',
                    'page_subtitle': 'Manage your professional profile',
                    'primary_color': '#1976d2',
                    'secondary_color': '#dc004e',
                    'background_color': '#ffffff',
                    'fields': copy.deepcopy(DOCTOR_PROFILE_SECTIONS),
                },
                'field_configs': [],
            }

        config_dict = live.to_dict(include_asset_urls=True)
        field_configs = [f.to_dict() for f in DoctorProfileConfigService.get_field_configs(live.id)]

        # Apply RBAC filtering
        sections = (config_dict.get('fields') or {}).get('sections', []) if isinstance(config_dict.get('fields'), dict) else []
        filtered_sections, filtered_fields = filter_by_user_type(sections, field_configs, user_type)

        # Update sections in config
        if isinstance(config_dict.get('fields'), dict):
            config_dict['fields']['sections'] = filtered_sections

        # Apply translations
        config_dict = apply_translations(config_dict, filtered_fields, lang)

        # Resolve dropdown data sources
        for field in filtered_fields:
            if field.get('data_source'):
                field['options'] = resolve_data_source(field['data_source'])

        return {
            'page_config': config_dict,
            'field_configs': filtered_fields,
        }

    # ---- Audit logging ----

    @staticmethod
    def log_action(config_id, action, user_id=None, previous_values=None, new_values=None, notes=None):
        """Create audit log entry."""
        ip_address = request.remote_addr if request else None

        log = ConfigAuditLog(
            tenant_id=current_tenant_id_strict(),
            config_id=config_id,
            page_type=PAGE_TYPE,
            action=action,
            user_id=user_id,
            previous_values=previous_values,
            new_values=new_values,
            ip_address=ip_address,
            notes=notes
        )
        db.session.add(log)
        db.session.commit()
        return log


class MasterDataService:
    """Service for managing master data tables (colleges, specializations)."""

    # ---- Colleges ----

    @staticmethod
    def get_colleges(active_only=True):
        query = MasterCollege.query.filter_by(tenant_id=current_tenant_id_strict())
        if active_only:
            query = query.filter_by(is_active=True)
        return query.order_by(MasterCollege.name).all()

    @staticmethod
    def create_college(name, user_id=None):
        tid = current_tenant_id_strict()
        existing = MasterCollege.query.filter_by(tenant_id=tid, name=name).first()
        if existing:
            raise ValueError(f"College '{name}' already exists")
        college = MasterCollege(tenant_id=tid, name=name, created_by_id=user_id)
        db.session.add(college)
        db.session.commit()
        return college

    @staticmethod
    def update_college(college_id, data):
        college = MasterCollege.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=college_id,
        ).first()
        if not college:
            raise ValueError("College not found")
        if 'name' in data:
            college.name = data['name']
        if 'is_active' in data:
            college.is_active = data['is_active']
        db.session.commit()
        return college

    @staticmethod
    def delete_college(college_id):
        """Soft delete a college."""
        college = MasterCollege.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=college_id,
        ).first()
        if not college:
            raise ValueError("College not found")
        college.is_active = False
        db.session.commit()
        return college

    # ---- Specializations (via Category) ----

    @staticmethod
    def get_specializations(active_only=True):
        query = Category.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            category_type='specialization',
        )
        if active_only:
            query = query.filter_by(is_active=True)
        return query.order_by(Category.name).all()

    @staticmethod
    def create_specialization(name, description=None, user_id=None):
        tid = current_tenant_id_strict()
        existing = Category.query.filter_by(
            tenant_id=tid, name=name, category_type='specialization',
        ).first()
        if existing:
            raise ValueError(f"Specialization '{name}' already exists")
        spec = Category(
            tenant_id=tid,
            name=name,
            description=description,
            category_type='specialization',
        )
        db.session.add(spec)
        db.session.commit()
        return spec

    @staticmethod
    def update_specialization(spec_id, data):
        spec = Category.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=spec_id,
        ).first()
        if not spec:
            raise ValueError("Specialization not found")
        if 'name' in data:
            spec.name = data['name']
        if 'description' in data:
            spec.description = data['description']
        if 'is_active' in data:
            spec.is_active = data['is_active']
        db.session.commit()
        return spec

    @staticmethod
    def delete_specialization(spec_id):
        """Soft delete a specialization."""
        spec = Category.query.filter_by(
            tenant_id=current_tenant_id_strict(), id=spec_id,
        ).first()
        if not spec:
            raise ValueError("Specialization not found")
        spec.is_active = False
        db.session.commit()
        return spec
