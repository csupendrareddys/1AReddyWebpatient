"""
Doctor Signup Configuration Service.

Structurally identical to ``DoctorProfileConfigService`` but for the
``DOCTOR_SIGNUP`` page_type. The single behavioral addition is the
required-field guard: a small set of field_keys (phone_number, password,
first_name, etc.) are flagged as LOCKED — the admin can edit their
label / placeholder / helper_text / translations but cannot hide them,
delete them, or remap their data_source / field_type / field_key.
Without this guard a misconfiguration could lock every doctor out of
signup entirely.
"""
import copy
from datetime import datetime, timezone

from flask import request

from app.extensions import db
from app.models import (
    PageConfig, PageFieldConfig, ConfigAuditLog,
    PageType, ConfigStatus, AuditAction,
)
from app.api.doctor_signup_config.default_fields import (
    DOCTOR_SIGNUP_SECTIONS, DOCTOR_SIGNUP_FIELDS, LOCKED_FIELD_KEYS,
)
from app.api.doctor_signup_config.data_resolver import resolve_data_source
from app.common.tenant_context import current_tenant_id_strict


PAGE_TYPE = 'doctor_signup'
PAGE_TYPE_ENUM = PageType.DOCTOR_SIGNUP


# Updates an admin attempts on a locked field are filtered down to these
# keys. Everything else (is_present, field_key, field_type, data_source,
# required, validation_regex, validation_message) is silently dropped on
# the server side — the frontend is expected to disable those inputs but
# the server is the source of truth.
_LOCKED_ALLOWED_UPDATE_KEYS = frozenset({
    'label', 'placeholder', 'helper_text', 'icon',
    'display_order', 'translations',
})


def apply_translations(config_dict, field_configs, lang):
    """Override default English values with translations for ``lang``."""
    if not lang or lang == 'en':
        return config_dict

    page_translations = config_dict.get('translations') or {}
    for key, lang_map in page_translations.items():
        if isinstance(lang_map, dict) and lang in lang_map:
            config_dict[key] = lang_map[lang]

    fields = config_dict.get('fields') or {}
    sections = fields.get('sections', []) if isinstance(fields, dict) else []
    for section in sections:
        section_translations = section.get('translations', {})
        if isinstance(section_translations, dict) and lang in section_translations:
            section['label'] = section_translations[lang]

    for field in field_configs:
        field_translations = field.get('translations') or {}
        for key, lang_map in field_translations.items():
            if isinstance(lang_map, dict) and lang in lang_map:
                field[key] = lang_map[lang]

    return config_dict


class DoctorSignupConfigService:
    """Service for managing doctor signup page configurations."""

    # ---- Read operations ----

    @staticmethod
    def get_live_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE,
        ).first()

    @staticmethod
    def get_draft_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.DRAFT,
        ).first()

    @staticmethod
    def get_preview_config():
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.PREVIEW,
        ).first()

    @staticmethod
    def get_all_configs():
        draft = DoctorSignupConfigService.get_draft_config()
        preview = DoctorSignupConfigService.get_preview_config()
        live = DoctorSignupConfigService.get_live_config()
        return {
            'draft': draft.to_dict(include_asset_urls=True) if draft else None,
            'preview': preview.to_dict(include_asset_urls=True) if preview else None,
            'live': live.to_dict(include_asset_urls=True) if live else None,
        }

    @staticmethod
    def get_field_configs(config_id):
        return PageFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            config_id=config_id,
        ).order_by(
            PageFieldConfig.section,
            PageFieldConfig.display_order,
        ).all()

    # ---- Draft management ----

    @staticmethod
    def _sync_missing_sections(draft):
        """Add any default sections/fields that don't exist yet on this draft."""
        tid = current_tenant_id_strict()
        fields = draft.fields or {}
        existing_section_keys = {s['key'] for s in (fields.get('sections') or [])}
        added_sections = []
        for ds in DOCTOR_SIGNUP_SECTIONS.get('sections', []):
            if ds['key'] not in existing_section_keys:
                added_sections.append(copy.deepcopy(ds))

        if added_sections:
            sections_list = list(fields.get('sections') or [])
            sections_list.extend(added_sections)
            fields['sections'] = sections_list
            draft.fields = fields
            import sqlalchemy
            sqlalchemy.orm.attributes.flag_modified(draft, 'fields')

        existing_fields_by_section = {}
        for fc in PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).all():
            existing_fields_by_section.setdefault(fc.section, set()).add(fc.field_key)

        for section_key, fields_list in DOCTOR_SIGNUP_FIELDS.items():
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
                        validation_regex=field_def.get('validation_regex'),
                        validation_message=field_def.get('validation_message'),
                    )
                    db.session.add(new_field)

        db.session.commit()

    @staticmethod
    def get_or_create_draft(user_id=None):
        """Get existing draft or seed a new one for this tenant."""
        tid = current_tenant_id_strict()
        draft = DoctorSignupConfigService.get_draft_config()
        if draft:
            DoctorSignupConfigService._sync_missing_sections(draft)
            return draft

        live = DoctorSignupConfigService.get_live_config()
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

            for lf in DoctorSignupConfigService.get_field_configs(live.id):
                # Mirror full column set — see doctor_profile_config's
                # matching block for the ``options`` regression
                # rationale.
                db.session.add(PageFieldConfig(
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
                ))
        else:
            draft = PageConfig(
                tenant_id=tid,
                page_type=PAGE_TYPE_ENUM,
                version=1,
                status=ConfigStatus.DRAFT,
                page_title='Doctor Signup',
                page_subtitle='Create your account',
                primary_button_text='Create Account',
                fields=copy.deepcopy(DOCTOR_SIGNUP_SECTIONS),
                created_by_id=user_id,
            )
            db.session.add(draft)
            db.session.flush()

            for section_key, fields_list in DOCTOR_SIGNUP_FIELDS.items():
                for field_def in fields_list:
                    db.session.add(PageFieldConfig(
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
                        validation_regex=field_def.get('validation_regex'),
                        validation_message=field_def.get('validation_message'),
                    ))

        db.session.commit()
        DoctorSignupConfigService.log_action(
            config_id=draft.id, action=AuditAction.CREATE, user_id=user_id,
            new_values=draft.to_dict(),
        )
        return draft

    @staticmethod
    def update_draft(data, user_id=None):
        """Update page-level fields on the draft (colors, copy, branding)."""
        draft = DoctorSignupConfigService.get_or_create_draft(user_id)
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
        DoctorSignupConfigService.log_action(
            config_id=draft.id, action=AuditAction.UPDATE, user_id=user_id,
            previous_values=previous, new_values=draft.to_dict(),
        )
        return draft

    @staticmethod
    def update_field_configs(field_updates, user_id=None):
        """
        Update individual PageFieldConfig rows.

        Required-field guard: for any field whose ``field_key`` is in
        ``LOCKED_FIELD_KEYS``, only label / placeholder / helper_text /
        icon / display_order / translations updates are accepted. Anything
        else (in particular ``is_present=False``) is silently dropped so
        an admin can't accidentally remove a field the signup flow
        depends on.
        """
        tid = current_tenant_id_strict()
        draft = DoctorSignupConfigService.get_or_create_draft(user_id)

        updatable_for_default = frozenset({
            'label', 'placeholder', 'helper_text', 'icon',
            'required', 'min_length', 'max_length',
            'validation_regex', 'validation_message',
            'display_order', 'is_present', 'user_types',
            'data_source', 'translations', 'options',
        })

        updated_fields = []
        rejected_updates = []  # for audit log

        for update in field_updates:
            field_id = update.get('id')
            if not field_id:
                continue

            # Admin-added new field (temp ID starts with 'new_').
            if isinstance(field_id, str) and field_id.startswith('new_'):
                # New fields can never collide with the locked set —
                # field_key is admin-supplied and would be e.g.
                # ``custom_<id>``, so no extra guard needed here.
                new_field = PageFieldConfig(
                    tenant_id=tid,
                    config_id=draft.id,
                    page_type=PAGE_TYPE,
                    section=update.get('section', 'personal'),
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
                tenant_id=tid, id=field_id, config_id=draft.id,
            ).first()
            if not field:
                continue

            # Pick the allow-list of keys this row accepts. Locked rows
            # get a narrow allow-list so the admin can never disable
            # them or change their wiring; everything else uses the full
            # set.
            is_locked = field.field_key in LOCKED_FIELD_KEYS
            allowed = (
                _LOCKED_ALLOWED_UPDATE_KEYS if is_locked else updatable_for_default
            )

            applied_keys = []
            for key, value in update.items():
                if key in ('id', 'section', 'field_key'):
                    continue
                if key in allowed:
                    setattr(field, key, value)
                    applied_keys.append(key)
                elif key not in ('field_type',):
                    # Locked rows reject is_present/data_source/etc.
                    rejected_updates.append({
                        'field_key': field.field_key, 'attribute': key,
                    })

            # field_type only mutable on non-default, non-locked rows.
            if 'field_type' in update and not field.is_default and not is_locked:
                field.field_type = update['field_type']
                applied_keys.append('field_type')

            updated_fields.append(field.to_dict())

        db.session.commit()
        DoctorSignupConfigService.log_action(
            config_id=draft.id, action=AuditAction.UPDATE, user_id=user_id,
            new_values={'updated_fields': updated_fields,
                        'rejected_updates': rejected_updates},
            notes='Field configs updated' + (
                f' ({len(rejected_updates)} locked-field updates rejected)'
                if rejected_updates else ''
            ),
        )
        return {
            'updated_fields': updated_fields,
            'rejected_updates': rejected_updates,
            'locked_field_keys': sorted(LOCKED_FIELD_KEYS),
        }

    @staticmethod
    def delete_field(field_id, user_id=None):
        """Delete a non-default admin-added field."""
        draft = DoctorSignupConfigService.get_or_create_draft(user_id)
        field = PageFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=field_id, config_id=draft.id,
        ).first()
        if not field:
            raise ValueError('Field not found')
        if field.is_default:
            raise ValueError('Cannot delete a built-in default field')
        if field.field_key in LOCKED_FIELD_KEYS:
            # Belt-and-suspenders: a custom field with a colliding key
            # would also be locked. is_default already covers the
            # primary case but this guard catches edge cases.
            raise ValueError('Cannot delete a locked field')
        db.session.delete(field)
        db.session.commit()
        return True

    # ---- Workflow operations ----

    @staticmethod
    def promote_to_preview(user_id=None):
        draft = DoctorSignupConfigService.get_draft_config()
        if not draft:
            raise ValueError('No draft config found for doctor_signup')

        existing_preview = DoctorSignupConfigService.get_preview_config()
        if existing_preview:
            existing_preview.status = ConfigStatus.ARCHIVED

        draft.status = ConfigStatus.PREVIEW
        db.session.commit()
        DoctorSignupConfigService.log_action(
            config_id=draft.id, action=AuditAction.PREVIEW, user_id=user_id,
        )
        return draft

    @staticmethod
    def publish(user_id=None):
        preview = DoctorSignupConfigService.get_preview_config()
        if not preview:
            raise ValueError('No preview config found for doctor_signup')

        all_live = PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
            status=ConfigStatus.LIVE,
        ).all()
        for live_config in all_live:
            live_config.status = ConfigStatus.ARCHIVED
            DoctorSignupConfigService.log_action(
                config_id=live_config.id, action=AuditAction.ARCHIVE, user_id=user_id,
            )

        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)
        db.session.commit()
        DoctorSignupConfigService.log_action(
            config_id=preview.id, action=AuditAction.PUBLISH, user_id=user_id,
        )
        return preview

    @staticmethod
    def restore_version(version_id, user_id=None):
        tid = current_tenant_id_strict()
        source = PageConfig.query.filter_by(id=version_id, tenant_id=tid).first()
        if not source:
            raise ValueError(f'Version {version_id} not found')
        if source.page_type != PAGE_TYPE_ENUM:
            raise ValueError(f'Version {version_id} does not belong to doctor_signup')

        draft = DoctorSignupConfigService.get_or_create_draft(user_id)
        previous = draft.to_dict()

        copyable = [
            'logo_asset_id', 'logo_alt_text', 'logo_is_present',
            'favicon_asset_id', 'background_asset_id', 'background_color',
            'card_background_color', 'primary_color', 'secondary_color',
            'page_title', 'page_subtitle', 'page_description', 'primary_button_text',
            'footer_text', 'footer_is_present',
            'fields', 'translations',
        ]
        for f in copyable:
            setattr(draft, f, getattr(source, f))

        PageFieldConfig.query.filter_by(tenant_id=tid, config_id=draft.id).delete()
        for sf in DoctorSignupConfigService.get_field_configs(source.id):
            db.session.add(PageFieldConfig(
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
                user_types=copy.deepcopy(sf.user_types),
                data_source=sf.data_source,
                options=copy.deepcopy(sf.options),
                translations=copy.deepcopy(sf.translations),
            ))

        db.session.commit()
        DoctorSignupConfigService.log_action(
            config_id=draft.id, action=AuditAction.UPDATE, user_id=user_id,
            previous_values=previous, new_values=draft.to_dict(),
            notes=f'Restored from version {source.version} (id: {version_id})',
        )
        return draft

    @staticmethod
    def get_version_history(limit=10):
        return PageConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE_ENUM,
        ).order_by(PageConfig.version.desc()).limit(limit).all()

    @staticmethod
    def get_audit_logs(limit=50):
        return ConfigAuditLog.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=PAGE_TYPE,
        ).order_by(ConfigAuditLog.timestamp.desc()).limit(limit).all()

    # ---- Merged public config ----

    @staticmethod
    def get_merged_config(lang=None):
        """
        Build the live config the signup React page consumes:
        page-level config + field rows + resolved dropdown options.
        Falls back to draft when no live config exists yet so the
        editor preview works on a fresh tenant. Falls back further
        to in-memory defaults when neither exists — without that, a
        production tenant who's never opened the doctor-signup-config
        editor would serve EMPTY field_configs to the public signup
        form, which renders as "No degrees uploaded for this level
        yet — ask the admin to add some." even though the master
        data IS present.
        """
        live = DoctorSignupConfigService.get_live_config()
        if not live:
            live = DoctorSignupConfigService.get_draft_config()
        if not live:
            # Anonymous request for a tenant that hasn't seeded a
            # signup config yet. Synthesise field_configs from
            # DOCTOR_SIGNUP_FIELDS so the public signup form is
            # functional out of the box, with proper data_source
            # resolution against tenant master data.
            synth_fields = []
            order_within_section = {}
            for section_key, field_defs in DOCTOR_SIGNUP_FIELDS.items():
                for fd in field_defs:
                    order_within_section.setdefault(section_key, 0)
                    order_within_section[section_key] += 1
                    synth_fields.append({
                        'id': None,
                        'config_id': None,
                        'page_type': PAGE_TYPE,
                        'section': section_key,
                        'field_key': fd['field_key'],
                        'field_type': fd.get('field_type', 'text'),
                        'label': fd.get('label', fd['field_key']),
                        'placeholder': fd.get('placeholder'),
                        'helper_text': fd.get('helper_text'),
                        'icon': fd.get('icon'),
                        'required': fd.get('required', False),
                        'min_length': fd.get('min_length'),
                        'max_length': fd.get('max_length'),
                        'validation_regex': fd.get('validation_regex'),
                        'validation_message': fd.get('validation_message'),
                        'display_order': fd.get('display_order', order_within_section[section_key]),
                        'is_present': fd.get('is_present', True),
                        'is_default': True,
                        'user_types': fd.get('user_types'),
                        'data_source': fd.get('data_source'),
                        'options': fd.get('options'),
                        'translations': None,
                    })
            # Resolve data_sources for the synthesised fields against
            # this tenant's actual master data.
            data_sources = {}
            for f in synth_fields:
                ds = f.get('data_source')
                if ds and ds not in data_sources:
                    data_sources[ds] = resolve_data_source(ds)
            return {
                'page_config': {
                    'page_title': 'Doctor Signup',
                    'page_subtitle': 'Create your account',
                    'fields': copy.deepcopy(DOCTOR_SIGNUP_SECTIONS),
                },
                'field_configs': synth_fields,
                'data_sources': data_sources,
                'locked_field_keys': sorted(LOCKED_FIELD_KEYS),
            }

        config_dict = live.to_dict(include_asset_urls=True)
        field_configs = [f.to_dict() for f in DoctorSignupConfigService.get_field_configs(live.id)]

        # Defensive: a tenant in the wild can land in a state where a
        # PageConfig row exists (so we don't hit the no-config branch
        # above) but its PageFieldConfig rows are empty — e.g. an
        # admin who clicked Publish on an unseeded draft, or an older
        # tenant whose seed migration didn't run. Same user-facing
        # symptom either way: the signup form shows "No degrees /
        # specializations / colleges uploaded for this level yet".
        # Fall back to the same synth path so the dropdowns work.
        if not field_configs:
            synth_fields = []
            order_within_section = {}
            for section_key, field_defs in DOCTOR_SIGNUP_FIELDS.items():
                for fd in field_defs:
                    order_within_section.setdefault(section_key, 0)
                    order_within_section[section_key] += 1
                    synth_fields.append({
                        'id': None,
                        'config_id': str(live.id),
                        'page_type': PAGE_TYPE,
                        'section': section_key,
                        'field_key': fd['field_key'],
                        'field_type': fd.get('field_type', 'text'),
                        'label': fd.get('label', fd['field_key']),
                        'placeholder': fd.get('placeholder'),
                        'helper_text': fd.get('helper_text'),
                        'icon': fd.get('icon'),
                        'required': fd.get('required', False),
                        'min_length': fd.get('min_length'),
                        'max_length': fd.get('max_length'),
                        'validation_regex': fd.get('validation_regex'),
                        'validation_message': fd.get('validation_message'),
                        'display_order': fd.get(
                            'display_order',
                            order_within_section[section_key],
                        ),
                        'is_present': fd.get('is_present', True),
                        'is_default': True,
                        'user_types': fd.get('user_types'),
                        'data_source': fd.get('data_source'),
                        'options': fd.get('options'),
                        'translations': None,
                    })
            field_configs = synth_fields

        config_dict = apply_translations(config_dict, field_configs, lang)

        # Resolve dropdown sources once per unique source.
        data_sources = {}
        for f in field_configs:
            ds = f.get('data_source')
            if ds and ds not in data_sources:
                data_sources[ds] = resolve_data_source(ds)

        return {
            'page_config': config_dict,
            'field_configs': field_configs,
            'data_sources': data_sources,
            'locked_field_keys': sorted(LOCKED_FIELD_KEYS),
        }

    # ---- Audit logging ----

    @staticmethod
    def log_action(config_id, action, user_id=None, previous_values=None,
                   new_values=None, notes=None):
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
        return log
