"""Per-module publish lifecycle helper (Round 9, Phase 3).

Each "module" inside a page_type carries its own DRAFT / PREVIEW /
LIVE / ARCHIVED state, stored on the ``module_configs`` table. The
PageFieldConfig rows that belong to that module carry a
``module_config_id`` FK pointing at the active ModuleConfig.

This module exposes a single helper class — ``ModuleLifecycle`` —
that the five page_type service modules (doctor_profile,
admin_profile, doctor_signup, patient_profile,
patient_appointment_filter / _symptoms) call into. The helper owns
the actual ModuleConfig CRUD; each page_type wires in its
section→module map + its own default-fields source.

By the time the Phase 3 backfill (``j6e7f8a9b0c1``) runs, every
existing PageFieldConfig row already has its ``module_config_id``
populated, so the helper can read & write through that column
directly. New tenants that come online after Phase 3 lands will
have ModuleConfig rows seeded on demand by ``get_or_create_draft``.

Audit logging — every DRAFT-create / PREVIEW / PUBLISH / ARCHIVE /
RESTORE action lands on ``ConfigAuditLog`` keyed by
``module_config_id`` (via ``config_id``) + a stringified page_type
that mirrors the legacy page-wide flow. The History tab joins
those rows by config_id, same shape it does today.
"""
from __future__ import annotations

import copy
import logging
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

from flask import request

from app.extensions import db
from app.models import (
    ModuleConfig, PageConfig, PageFieldConfig, ConfigAuditLog,
    PageType, ConfigStatus, AuditAction,
)
from app.common.tenant_context import current_tenant_id_strict


logger = logging.getLogger(__name__)


class ModuleLifecycle:
    """Per-module DRAFT/PREVIEW/LIVE lifecycle for a single page_type+module.

    Instantiate one per (page_type, module). The instance holds all the
    page-type-specific configuration (the PageType enum value, the
    section keys, the default-field seeds) so callers can treat it as
    a thin wrapper around the underlying ModuleConfig row.
    """

    def __init__(
        self,
        *,
        page_type: PageType,
        page_type_str: str,
        module: str,
        sections: list[str],
        default_fields_for_module: Callable[[], dict[str, list[dict]]],
        default_sections_for_module: Callable[[], list[dict]] | None = None,
    ):
        """
        Args:
            page_type: PageType enum value (e.g. PageType.DOCTOR_PROFILE).
            page_type_str: lowercase string (e.g. 'doctor_profile'),
                used as PageFieldConfig.page_type and audit-log page_type.
            module: module identifier (e.g. 'education').
            sections: list of section keys owned by this module
                (the canonical mapping lives in
                ``app/api/<page_type>_config/modules.py``).
            default_fields_for_module: zero-arg callable returning a dict
                keyed by section key whose values are the default field
                definitions for that section. Same shape as the
                ``DOCTOR_PROFILE_FIELDS`` / ``ADMIN_PROFILE_FIELDS`` /
                etc. constants — we just filter to the sections that
                belong to ``module``.
            default_sections_for_module: optional callable returning the
                list of section dicts for this module (the
                ``sections: [...]`` JSON the editor renders). When not
                supplied we still create a ModuleConfig but the parent
                PageConfig keeps the section metadata.
        """
        self.page_type = page_type
        self.page_type_str = page_type_str
        self.module = module
        self.sections = sections
        self.default_fields_for_module = default_fields_for_module
        self.default_sections_for_module = default_sections_for_module

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def _get_by_status(self, status: ConfigStatus) -> Optional[ModuleConfig]:
        return ModuleConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=self.page_type,
            module=self.module,
            status=status,
        ).first()

    def get_live(self) -> Optional[ModuleConfig]:
        return self._get_by_status(ConfigStatus.LIVE)

    def get_preview(self) -> Optional[ModuleConfig]:
        return self._get_by_status(ConfigStatus.PREVIEW)

    def get_draft(self) -> Optional[ModuleConfig]:
        return self._get_by_status(ConfigStatus.DRAFT)

    def get_all(self) -> dict:
        """Return {'draft':..., 'preview':..., 'live':...} as dicts."""
        draft = self.get_draft()
        preview = self.get_preview()
        live = self.get_live()
        return {
            'draft': draft.to_dict() if draft else None,
            'preview': preview.to_dict() if preview else None,
            'live': live.to_dict() if live else None,
        }

    def get_field_configs(self, module_config_id) -> list[PageFieldConfig]:
        """Return the field rows that belong to a given ModuleConfig."""
        return (
            PageFieldConfig.query.filter_by(
                tenant_id=current_tenant_id_strict(),
                module_config_id=module_config_id,
            )
            .order_by(PageFieldConfig.section, PageFieldConfig.display_order)
            .all()
        )

    # ------------------------------------------------------------------
    # Draft management
    # ------------------------------------------------------------------

    def _next_version(self) -> int:
        """Return one more than the highest version seen for this
        (tenant, page_type, module). Per-module versioning — modules
        bump independently of each other and of the parent PageConfig.
        """
        tid = current_tenant_id_strict()
        max_v = (
            db.session.query(db.func.max(ModuleConfig.version))
            .filter_by(tenant_id=tid, page_type=self.page_type, module=self.module)
            .scalar()
            or 0
        )
        return max_v + 1

    def _clone_fields_from(
        self, source_module_config_id, target_module_config_id
    ):
        """Deep-clone every PageFieldConfig row from ``source`` to ``target``.

        Mirrors the existing per-page clone flow in
        ``DoctorProfileConfigService.get_or_create_draft`` (mirroring
        ``options`` + ``is_default`` etc. — see commit 778407d which
        fixed the dropped-fields regression).
        """
        tid = current_tenant_id_strict()
        # Pull a fresh PageConfig.id reference — the new field rows need
        # to point at a PageConfig too during the back-compat window.
        # Fall back to the parent page's DRAFT, then LIVE, then create
        # a placeholder PageConfig (rare; only happens for fresh
        # tenants).
        parent_config = self._ensure_parent_page_config()

        source_fields = PageFieldConfig.query.filter_by(
            tenant_id=tid,
            module_config_id=source_module_config_id,
        ).all()

        for sf in source_fields:
            db.session.add(PageFieldConfig(
                tenant_id=tid,
                config_id=parent_config.id,
                module_config_id=target_module_config_id,
                page_type=self.page_type_str,
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

    def _ensure_parent_page_config(self) -> PageConfig:
        """Return the PageConfig row that new module-scoped field rows
        should attach to.

        Back-compat window: PageFieldConfig still NOT-NULL requires
        ``config_id``. We attach new module-scoped field rows to the
        tenant's current DRAFT PageConfig (creating one if none
        exists), so the legacy page-wide read paths keep working.
        Phase 5 will drop this NOT-NULL constraint once the cutover is
        complete.
        """
        tid = current_tenant_id_strict()
        draft = PageConfig.query.filter_by(
            tenant_id=tid, page_type=self.page_type, status=ConfigStatus.DRAFT,
        ).first()
        if draft:
            return draft
        live = PageConfig.query.filter_by(
            tenant_id=tid, page_type=self.page_type, status=ConfigStatus.LIVE,
        ).first()
        if live:
            return live
        # No DRAFT, no LIVE — create a placeholder DRAFT PageConfig so
        # field rows have something to attach to. Only happens for
        # fresh tenants spinning up a brand-new page_type.
        placeholder = PageConfig(
            tenant_id=tid,
            page_type=self.page_type,
            version=1,
            status=ConfigStatus.DRAFT,
            fields={'sections': []},
        )
        db.session.add(placeholder)
        db.session.flush()
        return placeholder

    def _seed_default_fields(self, module_config_id):
        """Seed PageFieldConfig rows from the page-type's default-fields
        constants for sections owned by this module. Called when a
        brand-new tenant creates the first DRAFT of a module that has
        no LIVE to clone from.
        """
        tid = current_tenant_id_strict()
        parent = self._ensure_parent_page_config()
        all_defaults = self.default_fields_for_module()
        for section_key in self.sections:
            for field_def in all_defaults.get(section_key, []):
                db.session.add(PageFieldConfig(
                    tenant_id=tid,
                    config_id=parent.id,
                    module_config_id=module_config_id,
                    page_type=self.page_type_str,
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
                    options=field_def.get('options'),
                ))

    def get_or_create_draft(self, user_id=None) -> ModuleConfig:
        """Return existing DRAFT ModuleConfig or create one.

        Order:
        1. If a DRAFT row exists, return it.
        2. Else if a LIVE row exists, clone its field configs into a new
           DRAFT (new version number = LIVE.version + 1).
        3. Else seed an empty DRAFT and call
           ``_seed_default_fields`` to populate from the page-type's
           defaults constants.
        """
        existing = self.get_draft()
        if existing:
            return existing

        tid = current_tenant_id_strict()
        live = self.get_live()
        version = self._next_version()
        draft = ModuleConfig(
            tenant_id=tid,
            page_type=self.page_type,
            module=self.module,
            version=version,
            status=ConfigStatus.DRAFT,
            created_by_id=user_id,
        )
        db.session.add(draft)
        db.session.flush()

        if live:
            self._clone_fields_from(live.id, draft.id)
        else:
            self._seed_default_fields(draft.id)

        db.session.commit()

        self._audit(draft.id, AuditAction.CREATE, user_id=user_id)
        return draft

    def update_fields(self, field_updates: list[dict], user_id=None) -> list[dict]:
        """Update field rows that belong to the current DRAFT.

        Same write rules as the page-wide ``update_field_configs`` — the
        only difference is the FK we filter on (``module_config_id`` not
        ``config_id``).
        """
        draft = self.get_or_create_draft(user_id)
        tid = current_tenant_id_strict()
        parent = self._ensure_parent_page_config()

        updatable = [
            'label', 'placeholder', 'helper_text', 'icon',
            'required', 'min_length', 'max_length',
            'validation_regex', 'validation_message',
            'display_order', 'is_present', 'user_types',
            'data_source', 'translations', 'options',
        ]

        updated = []
        for upd in field_updates:
            fid = upd.get('id')
            if not fid:
                continue

            # New field — temp id starts with 'new_'.
            if isinstance(fid, str) and fid.startswith('new_'):
                # If the section isn't owned by this module, reject.
                section = upd.get('section')
                if section not in self.sections:
                    raise ValueError(
                        f"Cannot create field in section '{section}' — "
                        f"section is not owned by module '{self.module}'"
                    )
                new_field = PageFieldConfig(
                    tenant_id=tid,
                    config_id=parent.id,
                    module_config_id=draft.id,
                    page_type=self.page_type_str,
                    section=section,
                    field_key=upd.get('field_key', f'custom_{fid}'),
                    field_type=upd.get('field_type', 'text'),
                    label=upd.get('label', ''),
                    placeholder=upd.get('placeholder'),
                    helper_text=upd.get('helper_text'),
                    required=upd.get('required', False),
                    display_order=upd.get('display_order', 999),
                    is_present=upd.get('is_present', True),
                    data_source=upd.get('data_source'),
                    options=upd.get('options'),
                    translations=upd.get('translations', {}),
                    is_default=False,
                )
                db.session.add(new_field)
                db.session.flush()
                updated.append(new_field.to_dict())
                continue

            field = PageFieldConfig.query.filter_by(
                tenant_id=tid,
                id=fid,
                module_config_id=draft.id,
            ).first()
            if not field:
                continue
            for k in updatable:
                if k in upd:
                    setattr(field, k, upd[k])
            if 'field_type' in upd and not field.is_default:
                field.field_type = upd['field_type']
            updated.append(field.to_dict())

        db.session.commit()
        self._audit(
            draft.id, AuditAction.UPDATE, user_id=user_id,
            new_values={'updated_fields': updated},
            notes=f'Module {self.module} field configs updated',
        )
        return updated

    def delete_field(self, field_id, user_id=None) -> bool:
        """Delete a non-default field from the DRAFT."""
        draft = self.get_or_create_draft(user_id)
        field = PageFieldConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            id=field_id,
            module_config_id=draft.id,
        ).first()
        if not field:
            raise ValueError('Field not found')
        if field.is_default:
            raise ValueError('Cannot delete a built-in default field')
        db.session.delete(field)
        db.session.commit()
        return True

    # ------------------------------------------------------------------
    # Workflow transitions
    # ------------------------------------------------------------------

    def promote_to_preview(self, user_id=None) -> ModuleConfig:
        """DRAFT → PREVIEW. Archive any existing PREVIEW first."""
        draft = self.get_draft()
        if not draft:
            raise ValueError(
                f"No draft module config for {self.page_type_str}/{self.module}"
            )
        existing_preview = self.get_preview()
        if existing_preview:
            existing_preview.status = ConfigStatus.ARCHIVED
        draft.status = ConfigStatus.PREVIEW
        db.session.commit()
        self._audit(draft.id, AuditAction.PREVIEW, user_id=user_id)
        return draft

    def publish(self, user_id=None, note=None) -> ModuleConfig:
        """PREVIEW → LIVE. Archive any existing LIVE for this module."""
        preview = self.get_preview()
        if not preview:
            raise ValueError(
                f"No preview module config for {self.page_type_str}/{self.module}"
            )
        # Archive existing LIVE(s) for this module
        all_live = ModuleConfig.query.filter_by(
            tenant_id=current_tenant_id_strict(),
            page_type=self.page_type,
            module=self.module,
            status=ConfigStatus.LIVE,
        ).all()
        for lc in all_live:
            lc.status = ConfigStatus.ARCHIVED
            self._audit(lc.id, AuditAction.ARCHIVE, user_id=user_id)

        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)
        if note:
            preview.note = note
        db.session.commit()
        self._audit(preview.id, AuditAction.PUBLISH, user_id=user_id, notes=note)
        return preview

    def restore_version(self, module_config_id, user_id=None) -> ModuleConfig:
        """Copy field configs from an archived version into the current DRAFT.

        Same semantics as PageConfig restore: doesn't bring the
        historical version back to LIVE, just re-seeds the DRAFT with
        its contents so the operator can adjust and re-publish.
        """
        tid = current_tenant_id_strict()
        source = ModuleConfig.query.filter_by(id=module_config_id, tenant_id=tid).first()
        if not source:
            raise ValueError(f'Version {module_config_id} not found')
        if source.page_type != self.page_type or source.module != self.module:
            raise ValueError(
                f"Version {module_config_id} does not belong to "
                f"{self.page_type_str}/{self.module}"
            )

        draft = self.get_or_create_draft(user_id)
        previous = draft.to_dict()

        # Wipe current DRAFT field rows + clone from source.
        PageFieldConfig.query.filter_by(
            tenant_id=tid, module_config_id=draft.id,
        ).delete()
        self._clone_fields_from(source.id, draft.id)
        db.session.commit()

        self._audit(
            draft.id, AuditAction.UPDATE, user_id=user_id,
            previous_values=previous, new_values=draft.to_dict(),
            notes=f'Restored {self.module} from version {source.version}',
        )
        return draft

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def get_history(self, limit=10) -> list[dict]:
        """Return all per-module versions with their PUBLISH notes attached.

        ``note`` lives directly on the ModuleConfig row (it's the
        operator's release comment), so unlike the page-wide history
        we don't need to join against ConfigAuditLog. Kept the
        ``publish_note`` key on the output dict so the front-end's
        existing History tab works without changes.
        """
        tid = current_tenant_id_strict()
        versions = (
            ModuleConfig.query.filter_by(
                tenant_id=tid, page_type=self.page_type, module=self.module,
            )
            .order_by(ModuleConfig.version.desc())
            .limit(limit)
            .all()
        )
        out = []
        for v in versions:
            row = v.to_dict()
            row['publish_note'] = v.note
            out.append(row)
        return out

    # ------------------------------------------------------------------
    # Audit logging
    # ------------------------------------------------------------------

    def _audit(
        self, module_config_id, action, *, user_id=None,
        previous_values=None, new_values=None, notes=None,
    ):
        ip = request.remote_addr if request else None
        log = ConfigAuditLog(
            tenant_id=current_tenant_id_strict(),
            config_id=module_config_id,
            page_type=self.page_type_str,
            action=action,
            user_id=user_id,
            previous_values=previous_values,
            new_values=new_values,
            ip_address=ip,
            notes=notes,
        )
        db.session.add(log)
        db.session.commit()
        return log


# ----------------------------------------------------------------------
# Builders
# ----------------------------------------------------------------------

def build_lifecycle(
    *,
    page_type: PageType,
    page_type_str: str,
    module: str,
    module_to_sections: dict[str, list[str]],
    default_fields: dict[str, list[dict]],
) -> ModuleLifecycle:
    """Convenience builder. Most page_type service modules import this
    rather than constructing ModuleLifecycle directly — keeps the per-
    page-type service code symmetric.

    Args:
        page_type: PageType enum.
        page_type_str: lowercase string (e.g. 'doctor_profile').
        module: module identifier.
        module_to_sections: SECTION_TO_MODULE map from the page_type's
            modules.py (e.g. ``MODULE_TO_SECTIONS`` from
            ``doctor_profile_config.modules``).
        default_fields: page-type's DEFAULT_FIELDS constant
            (e.g. ``DOCTOR_PROFILE_FIELDS``). The lifecycle helper
            filters it down to sections that belong to ``module``.

    Raises:
        ValueError: ``module`` isn't in ``module_to_sections``.
    """
    sections = module_to_sections.get(module)
    if sections is None:
        raise ValueError(
            f'Unknown module {module!r} for page_type {page_type_str!r}. '
            f'Known modules: {sorted(module_to_sections.keys())}'
        )

    return ModuleLifecycle(
        page_type=page_type,
        page_type_str=page_type_str,
        module=module,
        sections=sections,
        default_fields_for_module=lambda: {
            s: default_fields.get(s, []) for s in sections
        },
    )
