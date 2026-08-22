"""Snapshot / restore the Group Offering demo data.

This protects the manager-demo data (plans, admin-assembled teams, patient
bookings and their payout installments) against a Docker-volume wipe. It is a
generic row snapshot + idempotent restore — NOT a business-logic seeder — so it
keeps working as the schema evolves.

Scope: the group-offering *scaffolding* tables (plans → teams → bookings). Chat
messages and completion documents are runtime artefacts created by actually
using the app; recreate those by driving the flow (see the demo walkthrough).

Usage (run inside the backend container):

    # Freeze the CURRENT demo rows into the fixture (do this while data exists):
    docker compose exec backend python scripts/reseed_group_offering_demo.py --capture

    # Restore after a volume wipe (idempotent — skips rows that already exist):
    docker compose exec backend python scripts/reseed_group_offering_demo.py

The fixture is committed at scripts/fixtures/group_offering_demo.json so a
fresh clone can restore without a prior capture.
"""
import json
import os
import sys
import uuid
import decimal
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from sqlalchemy import text  # noqa: E402

# Parent-before-child: restore order must satisfy the FKs between them.
TABLES = [
    'group_offerings',
    'group_offering_members',
    'group_offering_installments',
    'marketplace_service_groups',
    'marketplace_service_group_members',
    'service_group_member_installments',
    'group_offering_bookings',
    'group_offering_booking_installments',
]

# Primary-key column per table (used for the ON CONFLICT skip).
PK = {
    'group_offerings': 'group_offering_id',
    'group_offering_members': 'member_id',
    'group_offering_installments': 'installment_id',
    'marketplace_service_groups': 'group_id',
    'marketplace_service_group_members': 'member_id',
    'service_group_member_installments': 'installment_id',
    'group_offering_bookings': 'booking_id',
    'group_offering_booking_installments': 'booking_installment_id',
}

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       'fixtures', 'group_offering_demo.json')


def _default_tenant_id():
    row = db.session.execute(
        text("SELECT id FROM tenants WHERE is_default = TRUE LIMIT 1")
    ).first()
    if not row:
        raise SystemExit('No default (platform) tenant found.')
    return str(row[0])


def _table_columns(table):
    rows = db.session.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = :t ORDER BY ordinal_position"
    ), {'t': table})
    return [r[0] for r in rows]


def _jsonable(v):
    if isinstance(v, (uuid.UUID,)):
        return str(v)
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()
    if isinstance(v, (dict, list)):
        return v
    return v


def capture():
    tid = _default_tenant_id()
    out = {'tenant_id': tid, 'tables': {}}
    total = 0
    for table in TABLES:
        cols = _table_columns(table)
        has_tenant = 'tenant_id' in cols
        sql = f'SELECT * FROM {table}'
        if has_tenant:
            sql += ' WHERE tenant_id = :tid'
        rows = db.session.execute(text(sql), {'tid': tid} if has_tenant else {})
        data = [{k: _jsonable(v) for k, v in dict(r._mapping).items()} for r in rows]
        out['tables'][table] = data
        total += len(data)
        print(f'  captured {len(data):>4}  {table}')
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    with open(FIXTURE, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'Wrote {total} rows to {FIXTURE}')


def restore():
    if not os.path.exists(FIXTURE):
        raise SystemExit(f'Fixture not found: {FIXTURE}. Run --capture first.')
    with open(FIXTURE, encoding='utf-8') as f:
        payload = json.load(f)

    inserted = 0
    for table in TABLES:  # parent-first
        rows = payload['tables'].get(table, [])
        if not rows:
            continue
        pk = PK[table]
        json_cols = _json_columns(table)
        for row in rows:
            cols = list(row.keys())
            placeholders = ', '.join(f':{c}' for c in cols)
            collist = ', '.join(cols)
            params = {}
            for c in cols:
                v = row[c]
                # JSON/JSONB columns must be passed as a JSON string.
                if c in json_cols and v is not None and not isinstance(v, str):
                    v = json.dumps(v)
                params[c] = v
            sql = text(
                f'INSERT INTO {table} ({collist}) VALUES ({placeholders}) '
                f'ON CONFLICT ({pk}) DO NOTHING'
            )
            res = db.session.execute(sql, params)
            inserted += res.rowcount or 0
        print(f'  restored {table} ({len(rows)} in fixture)')
    db.session.commit()
    print(f'Inserted {inserted} new rows (existing rows left untouched).')


def _json_columns(table):
    rows = db.session.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = :t AND data_type IN ('json','jsonb')"
    ), {'t': table})
    return {r[0] for r in rows}


def main():
    app = create_app()
    with app.app_context():
        if '--capture' in sys.argv:
            print('Capturing group-offering demo rows...')
            capture()
        else:
            print('Restoring group-offering demo rows (idempotent)...')
            restore()


if __name__ == '__main__':
    main()
