"""Unify legacy education field options into the master data tables (per-tenant).

Older doctor-profile configs left the LEVEL education fields on legacy
data_sources — ``ug_specialization`` on ``category:specialization``,
``ug_university`` on unscoped ``master_universities``, etc. Those are NOT
recognised as master-backed by the field editor, so options typed there were
stored as literal ``PageFieldConfig.options`` and NEVER written to the master
tables that the Product Catalog and doctor product-gating read from. Result:
the education dropdown and the Product Catalog show two different lists.

For each such field this script:
  1. derives the level from the field-key prefix (ug_/pg_/ss_ -> ug/pg/super_speciality),
  2. inserts its options into the matching master table, tagged with that level
     (ADDITIVE — existing rows are kept; ON CONFLICT (tenant, name) DO NOTHING),
  3. rewrites data_source to the level-scoped master source
     (master_specializations:<lvl> / master_degrees:<lvl> /
      master_universities:<lvl> / master_colleges:<lvl>),
  4. nulls the field's options so it resolves from the master table going forward.

After this the education dropdown, Product Catalog "Allowed specializations",
and product gating all read one master source, and editing options in the field
editor keeps writing there. other-certification (oc_*) fields are left alone
(level-agnostic by design).

Usage (inside the backend container):
  python scripts/unify_education_master_data.py                 # DRY-RUN (report only)
  python scripts/unify_education_master_data.py --apply         # commit
  python scripts/unify_education_master_data.py --tenant <uuid> [--apply]
  python scripts/unify_education_master_data.py --tenant-slug platform [--apply]
"""
import sys

from app import create_app
from app.extensions import db
from sqlalchemy import text

APPLY = '--apply' in sys.argv
TENANT = None
if '--tenant' in sys.argv:
    TENANT = sys.argv[sys.argv.index('--tenant') + 1]
TENANT_SLUG = None
if '--tenant-slug' in sys.argv:
    TENANT_SLUG = sys.argv[sys.argv.index('--tenant-slug') + 1]

PREFIX_LEVEL = {'ug_': 'ug', 'pg_': 'pg', 'ss_': 'super_speciality'}

# suffix -> (legacy data_sources to migrate, new base, master kind)
SUFFIX_CFG = {
    'specialization': (('category:specialization',), 'master_specializations', 'cat:specialization'),
    'degree':         (('master_degrees', 'category:degree'), 'master_degrees', 'cat:degree'),
    'university':      (('master_universities', 'category:university'), 'master_universities', 'cat:university'),
    'institute':       (('master_colleges',), 'master_colleges', 'college'),
}


def _opt_name(opt):
    if isinstance(opt, str):
        return opt.strip()
    if isinstance(opt, dict):
        return (opt.get('label') or opt.get('name') or opt.get('value') or '').strip()
    return ''


def _classify(field_key):
    for pfx, lvl in PREFIX_LEVEL.items():
        if field_key.startswith(pfx):
            suffix = field_key[len(pfx):]
            if suffix in SUFFIX_CFG:
                return lvl, suffix, SUFFIX_CFG[suffix]
    return None


def main():
    app = create_app()
    with app.app_context():
        conn = db.session
        tenant_id = TENANT
        if tenant_id is None and TENANT_SLUG:
            row = conn.execute(
                text('SELECT id FROM tenants WHERE slug = :s'), {'s': TENANT_SLUG}
            ).fetchone()
            if not row:
                print(f'No tenant found with slug {TENANT_SLUG!r}')
                return
            tenant_id = str(row[0])
            print(f'Resolved slug {TENANT_SLUG!r} -> tenant {tenant_id}')
        where_tenant = ' AND tenant_id = :tid' if tenant_id else ''
        rows = conn.execute(text(f'''
            SELECT field_id, tenant_id, field_key, data_source, options
            FROM page_field_configs
            WHERE data_source IS NOT NULL AND options IS NOT NULL{where_tenant}
        '''), ({'tid': tenant_id} if tenant_id else {})).fetchall()

        planned = []  # (field_key, level, kind, new_ds, [names])
        for field_id, tenant_id, field_key, data_source, options in rows:
            c = _classify(field_key or '')
            if not c:
                continue
            level, suffix, (legacy_sources, new_base, kind) = c
            if data_source not in legacy_sources:
                continue  # already on a master:<level> source, or unrelated
            if not isinstance(options, list) or not options:
                continue
            names, seen = [], set()
            for o in options:
                n = _opt_name(o)
                if n and n.lower() not in seen:
                    seen.add(n.lower())
                    names.append(n)
            if not names:
                continue
            new_ds = f'{new_base}:{level}'
            planned.append((str(field_id), str(tenant_id), field_key, level, kind, new_ds, names))

        added = updated = 0
        for field_id, tenant_id, field_key, level, kind, new_ds, names in planned:
            for name in names:
                if kind == 'college':
                    conn.execute(text('''
                        INSERT INTO master_colleges (college_id, tenant_id, name, qualification_level, is_active, created_at)
                        VALUES (gen_random_uuid(), :t, :n, :lvl, TRUE, now())
                        ON CONFLICT (tenant_id, name) DO NOTHING
                    '''), {'t': tenant_id, 'n': name, 'lvl': level})
                else:
                    ctype = kind.split(':', 1)[1]
                    conn.execute(text('''
                        INSERT INTO categories (category_id, tenant_id, name, category_type, qualification_level, is_active, created_at, updated_at)
                        VALUES (gen_random_uuid(), :t, :n, :ct, :lvl, TRUE, now(), now())
                        ON CONFLICT (tenant_id, name) DO NOTHING
                    '''), {'t': tenant_id, 'n': name, 'ct': ctype, 'lvl': level})
                added += 1
            conn.execute(text('''
                UPDATE page_field_configs SET data_source = :ds, options = NULL WHERE field_id = :fid
            '''), {'ds': new_ds, 'fid': field_id})
            updated += 1

        mode = 'APPLIED' if APPLY else 'DRY-RUN (rolled back)'
        print('=' * 66)
        print(f'Unify education master data — {mode}')
        print(f'  legacy education fields to migrate : {updated}')
        print(f'  master rows inserted (upserts)     : {added}')
        for _fid, tid, fk, lvl, kind, new_ds, names in planned:
            print(f'    [{tid[:8]}] {fk}: -> {new_ds}   options={names}')
        if not planned:
            print('  nothing to migrate (all education fields already master-backed).')
        print('=' * 66)

        if APPLY:
            conn.commit()
        else:
            conn.rollback()


if __name__ == '__main__':
    main()
