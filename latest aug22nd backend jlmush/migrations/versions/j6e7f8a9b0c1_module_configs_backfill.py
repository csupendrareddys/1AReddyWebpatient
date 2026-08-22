"""Per-module publish lifecycle — Phase 2 backfill.

Round 9, Phase 2. Walk every existing ``PageConfig`` row and
partition its ``PageFieldConfig`` children into one ``ModuleConfig``
per module (per the SECTION_TO_MODULE map in each page_type's
``modules.py``). Mirrors the parent PageConfig's status, version,
created_at, and published_at so existing tenants land with the same
release surface they had before.

After this runs, every PageFieldConfig has ``module_config_id``
populated. The legacy ``config_id`` column stays populated too —
Phase 3's endpoint cutover keeps both columns in sync during the
back-compat window.

Idempotent: skips ModuleConfigs that already exist for a given
(tenant, page_type, module, version, status); skips field rows
whose ``module_config_id`` is already set.

Sections not in any module map are logged as orphans + their field
rows keep module_config_id = NULL. The Phase 3 services will still
serve those rows via the legacy config_id path until the operator
cleans them up (manually adds them to a modules.py, or deletes
them).

Revision ID: j6e7f8a9b0c1
Revises: i5d6e7f8a9b1
Create Date: 2026-05-21
"""
from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


logger = logging.getLogger(__name__)


# revision identifiers
revision = 'j6e7f8a9b0c1'
down_revision = 'i5d6e7f8a9b1'
branch_labels = None
depends_on = None


# Mirror of the SECTION_TO_MODULE maps in each page_type's
# ``modules.py``. Duplicated here so the migration is self-contained
# and doesn't need to import application code (Alembic migrations
# should be hermetic — the app may not even be importable at
# migration time on a fresh CI bootstrap).
#
# Keep this in sync with the corresponding ``modules.py``.
# A pytest in ``tests/api/test_module_mapping.py`` (Phase 4) cross-
# checks the two so they don't drift.
_MODULE_MAPS: dict[str, dict[str, str]] = {
    'DOCTOR_PROFILE': {
        # personal_professional
        'personal_details':            'personal_professional',
        'additional_personal_details': 'personal_professional',
        'identity_documents':          'personal_professional',
        'female_health_details':       'personal_professional',
        # addresses
        'current_address':             'addresses',
        'permanent_address':           'addresses',
        # signatures_verification
        'signatures':                  'signatures_verification',
        # about_me
        'about_me':                    'about_me',
        # education
        'education_graduation':        'education',
        'education_post_graduation':   'education',
        'education_super_speciality':  'education',
        'education_other_certification': 'education',
        # bank_details
        'bank_details':                'bank_details',
        # declaration_documents
        'declaration_documents':       'declaration_documents',
        # scheduling
        'working_days_hours':          'scheduling',
        'consultation_pricing':        'scheduling',
        # analytics
        'doctor_analytics':            'analytics',
        'doctor_attendance':           'analytics',
        # treatable_symptoms
        'treatable_symptoms':          'treatable_symptoms',
    },
    'ADMIN_PROFILE': {
        'personal_details':            'personal_professional',
        'additional_personal_details': 'personal_professional',
        'identity_documents':          'personal_professional',
        'female_health_details':       'personal_professional',
        'current_address':             'addresses',
        'permanent_address':           'addresses',
        'signatures':                  'signatures_verification',
        'about_me':                    'about_me',
        'education_graduation':        'education',
        'education_post_graduation':   'education',
        'education_super_speciality':  'education',
        'education_other_certification': 'education',
        'bank_details':                'bank_details',
        'declaration_documents':       'declaration_documents',
        'working_days_hours':          'scheduling',
        'consultation_pricing':        'scheduling',
        'admin_analytics':             'analytics',
        'admin_attendance':            'analytics',
    },
    'DOCTOR_SIGNUP': {
        'account':                     'account',
        'personal':                    'identity_contact',
        'address':                     'identity_contact',
        'identity':                    'identity_contact',
        'qualifications_ug':           'qualifications',
        'qualifications_pg':           'qualifications',
        'qualifications_ss':           'qualifications',
    },
    'PATIENT_PROFILE': {
        'personal_details':            'personal_contact',
        'contact_identity':            'personal_contact',
        'address':                     'personal_contact',
        'emergency_contact':           'emergency_insurance',
        'insurance':                   'emergency_insurance',
        'vitals':                      'health',
        'habits':                      'health',
        'surgeries':                   'health',
        'female_health':               'health',
        'health_records':              'records',
        'previous_prescriptions':      'records',
        'house_family_group':          'family',
    },
    # PATIENT_APPOINTMENT is split into two separate PageType enum
    # values in the DB — FILTER and SYMPTOMS — each carrying its own
    # PageConfig row. Treat each as its own module so the per-module
    # surfaces have something concrete to attach to.
    'PATIENT_APPOINTMENT_FILTER': {
        'filter_general':              'filters',
        'filter_preferences':          'filters',
    },
    'PATIENT_APPOINTMENT_SYMPTOMS': {
        'symptoms_categories':         'symptoms',
        'symptoms_display':            'symptoms',
    },
}


def upgrade():
    conn = op.get_bind()

    # Pull every PageConfig row.
    page_configs = conn.execute(text(
        '''
        SELECT config_id, tenant_id, page_type, version, status,
               published_at, created_at
        FROM page_configs
        ORDER BY tenant_id, page_type, version
        '''
    )).fetchall()

    if not page_configs:
        logger.info('[migrate:j6e7f8a9b0c1] no PageConfig rows — nothing to backfill')
        return

    created_modules = 0
    fields_updated = 0
    orphan_sections = defaultdict(int)
    page_types_seen = defaultdict(int)

    for pc in page_configs:
        (pc_id, tenant_id, page_type, version, status,
         published_at, created_at) = pc
        page_types_seen[page_type] += 1

        section_to_module = _MODULE_MAPS.get(page_type)
        if section_to_module is None:
            # Unknown page_type — skip. Existing tests will still pass
            # because the field rows keep their legacy config_id.
            logger.warning(
                '[migrate:j6e7f8a9b0c1] unknown page_type=%s — skipping '
                'PageConfig %s',
                page_type, pc_id,
            )
            continue

        # Pull this PageConfig's field rows + their sections.
        fields = conn.execute(text(
            '''
            SELECT field_id, section
            FROM page_field_configs
            WHERE config_id = :pc_id
              AND module_config_id IS NULL
            '''
        ), {'pc_id': str(pc_id)}).fetchall()

        if not fields:
            # PageConfig with no fields (or already-backfilled fields).
            # Skip — nothing to do for this PageConfig.
            continue

        # Group field IDs by destination module.
        fields_by_module: dict[str, list[uuid.UUID]] = defaultdict(list)
        for f_id, section in fields:
            module = section_to_module.get(section)
            if module is None:
                # Unmapped section — log + skip. The field row keeps
                # module_config_id = NULL and still resolves via the
                # legacy config_id chain.
                orphan_sections[f'{page_type}:{section}'] += 1
                continue
            fields_by_module[module].append(f_id)

        # For each module with at least one field row, create a
        # ModuleConfig that mirrors the parent PageConfig.
        for module, field_ids in fields_by_module.items():
            # Idempotency — if a ModuleConfig already exists for
            # (tenant, page_type, module, version, status) reuse it
            # instead of inserting a duplicate. Real-world this only
            # fires when the migration is re-run after a partial
            # failure.
            existing = conn.execute(text(
                '''
                SELECT module_config_id
                FROM module_configs
                WHERE tenant_id = :tid AND page_type = :pt
                  AND module = :m AND version = :v AND status = :s
                LIMIT 1
                '''
            ), {
                'tid': str(tenant_id), 'pt': page_type, 'm': module,
                'v': version, 's': status,
            }).fetchone()

            if existing:
                module_config_id = existing[0]
            else:
                module_config_id = uuid.uuid4()
                conn.execute(text(
                    '''
                    INSERT INTO module_configs
                      (module_config_id, tenant_id, page_type, module,
                       version, status, published_at, created_at,
                       updated_at)
                    VALUES
                      (:id, :tid, :pt, :m, :v, :s, :pub, :ca, :ua)
                    '''
                ), {
                    'id': str(module_config_id),
                    'tid': str(tenant_id),
                    'pt': page_type,
                    'm': module,
                    'v': version,
                    's': status,
                    'pub': published_at,
                    'ca': created_at or datetime.now(timezone.utc),
                    'ua': created_at or datetime.now(timezone.utc),
                })
                created_modules += 1

            # Wire the field rows to the ModuleConfig.
            # ANY(:ids) on a UUID column needs the array cast — psycopg2
            # binds the list as text[] which has no equality operator
            # against uuid. Cast inside the SQL to keep the migration
            # database-driver agnostic.
            conn.execute(text(
                '''
                UPDATE page_field_configs
                SET module_config_id = :mc_id
                WHERE field_id = ANY(CAST(:ids AS uuid[]))
                  AND module_config_id IS NULL
                '''
            ), {
                'mc_id': str(module_config_id),
                'ids': [str(f) for f in field_ids],
            })
            fields_updated += len(field_ids)

    logger.info(
        '[migrate:j6e7f8a9b0c1] PageConfigs walked=%d module_configs '
        'created=%d fields wired=%d',
        sum(page_types_seen.values()), created_modules, fields_updated,
    )
    if orphan_sections:
        logger.warning(
            '[migrate:j6e7f8a9b0c1] orphan sections (unmapped — kept on '
            'legacy config_id chain): %s',
            dict(orphan_sections),
        )


def downgrade():
    # Reverse:
    #   1. NULL out every page_field_configs.module_config_id we set
    #      (we can't distinguish ours from future writes, so null all).
    #   2. DELETE every ModuleConfig (Phase 1 schema's CASCADE on FK
    #      means dropping them would also drop fields; do step 1 first).
    #
    # This is safe to run because Phase 1's downgrade leaves the table
    # in place — Phase 2 only added data on top.
    op.execute(
        'UPDATE page_field_configs SET module_config_id = NULL '
        'WHERE module_config_id IS NOT NULL'
    )
    op.execute('DELETE FROM module_configs')
