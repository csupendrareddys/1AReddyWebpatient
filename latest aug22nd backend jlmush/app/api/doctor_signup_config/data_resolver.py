"""
Data source resolver for the Doctor SIGNUP page dropdowns.

Adds qualification-level scoped sources on top of what
``doctor_profile_config.data_resolver`` supports:

    "master_colleges:ug"             → MasterCollege where level in {ug, NULL}
    "master_colleges:pg"             → MasterCollege where level in {pg, NULL}
    "master_colleges:super_speciality" → MasterCollege where level in {ss, NULL}
    "master_degrees:ug" / :pg / :super_speciality
        → Category(type=degree)        where level matches
    "master_specializations:ug" / :pg / :super_speciality
        → Category(type=specialization) where level matches

A level filter of NULL is treated as "available at every level" so a
tenant that hasn't yet split its master data still works.

Unknown sources fall back to ``doctor_profile_config.data_resolver``
so static lists (states, religions, etc.) and the legacy
``master_colleges`` / ``master_degrees`` / ``category:<x>`` sources keep
working unchanged.
"""
from sqlalchemy import or_

from app.api.doctor_profile_config.data_resolver import (
    resolve_data_source as _legacy_resolve,
)
from app.common.tenant_context import current_tenant_id_or_default


# Levels we recognise on the application side. The DB column is a free
# string so new levels can be added without a migration, but the resolver
# only short-circuits on these for the canonical paths.
_KNOWN_LEVELS = frozenset({'ug', 'pg', 'super_speciality'})


def _level_filter(model_attr, level):
    """Postgres filter: ``level`` matches OR is NULL (legacy/all-levels)."""
    return or_(model_attr == level, model_attr.is_(None))


def _master_colleges(tid, level):
    from app.models import MasterCollege
    items = MasterCollege.query.filter(
        MasterCollege.tenant_id == tid,
        MasterCollege.is_active.is_(True),
        _level_filter(MasterCollege.qualification_level, level),
    ).order_by(MasterCollege.name).all()
    return [{"id": str(c.id), "name": c.name} for c in items]


def _master_categories_by_type(tid, category_type, level):
    from app.models import Category
    items = Category.query.filter(
        Category.tenant_id == tid,
        Category.is_active.is_(True),
        Category.category_type == category_type,
        _level_filter(Category.qualification_level, level),
    ).order_by(Category.name).all()
    return [{"id": str(c.id), "name": c.name} for c in items]


def resolve_data_source(source):
    """
    Resolve a data_source string to dropdown option values. Falls back
    to the doctor_profile_config resolver for sources we don't handle
    (states, religions, gender_options, ``category:<x>``, etc.).
    """
    if not source:
        return []

    # Level-scoped lookups have the form "<base>:<level>".
    if ':' in source:
        base, _, level = source.partition(':')
        # Only short-circuit for sources we own; fall through otherwise.
        if base in ('master_colleges', 'master_degrees', 'master_specializations'):
            tid = current_tenant_id_or_default()
            if base == 'master_colleges':
                return _master_colleges(tid, level)
            if base == 'master_degrees':
                return _master_categories_by_type(tid, 'degree', level)
            if base == 'master_specializations':
                return _master_categories_by_type(tid, 'specialization', level)

    # Anything else (master_states, master_religions, gender_options,
    # legacy unscoped master_colleges/master_degrees, category:<x>, etc.)
    # is handled by the profile-config resolver.
    return _legacy_resolve(source)
