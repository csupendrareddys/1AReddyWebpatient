"""Exhaustive endpoint sweep via Flask test_client (runs CURRENT code in-container).

- Logs in each seed role, then GETs every parameterless GET route, recording
  status codes and flagging any 5xx / exceptions (the real-breakage signal).
- Then drives the doctor education WRITE to prove the new dual-write path sets
  profile_owner_id (the stale gunicorn does not).
"""
import traceback
from app import create_app
from app.extensions import db
from sqlalchemy import text

app = create_app()
client = app.test_client()
H = {'Host': 'localhost'}


def login(email, pw):
    r = client.post('/auth/signin', json={'email': email, 'password': pw}, headers=H)
    if r.status_code != 200:
        return None
    try:
        return r.get_json()['data']['access_token']
    except Exception:
        return None


tokens = {
    'doctor': login('doctor01@platform-seed.test', 'Demo@1234'),
    'admin':  login('super_admin01@platform-seed.test', 'Demo@1234'),
    'owner':  login('owner@platform-seed.test', 'Owner@1234'),
}
print("logins:", {k: ('ok' if v else 'FAIL') for k, v in tokens.items()})


def pick(path):
    if path.startswith(('/api/admin', '/api/admin-profile-config')):
        return tokens['admin']
    if path.startswith(('/api/doctor', '/api/doctor-profile-config', '/api/doctor-signup-config')):
        return tokens['doctor']
    if path.startswith('/api/platform'):
        return tokens['owner']
    if path.startswith('/api/patient'):
        return tokens['doctor']
    return None


rules = sorted({r.rule for r in app.url_map.iter_rules()
                if 'GET' in r.methods and '<' not in r.rule
                and not r.rule.startswith('/static')})

from collections import Counter
dist = Counter()
bad = []
for path in rules:
    hdr = dict(H)
    tok = pick(path)
    if tok:
        hdr['Authorization'] = f'Bearer {tok}'
    try:
        code = client.get(path, headers=hdr).status_code
    except Exception as e:
        bad.append((f'EXC {type(e).__name__}', path))
        dist['EXC'] += 1
        continue
    dist[code] += 1
    if isinstance(code, int) and code >= 500:
        bad.append((code, path))

print(f"\n=== swept {len(rules)} parameterless GET routes ===")
print("status distribution:", dict(sorted(dist.items(), key=lambda x: str(x[0]))))
print(f"\n=== {len(bad)} SERVER ERRORS (5xx / exceptions) ===")
for code, path in bad:
    print(f"  {code}  {path}")

# --- write path: a FRESH doctor's education create must set profile_owner_id ---
print("\n=== doctor education WRITE (create-path dual-write proof) ===")


def owner_set_count():
    with app.app_context():
        return db.session.execute(text(
            "SELECT count(*) FROM profile_education WHERE profile_owner_id IS NOT NULL")).scalar()


before = owner_set_count()
d2, who = None, None
for nn in ('02', '03', '04', '05'):
    d2 = login(f'doctor{nn}@platform-seed.test', 'Demo@1234')
    if d2:
        who = nn
        break
if not d2:
    print("no fresh doctor login available — skipping write proof")
else:
    r = client.post('/api/doctor/profile/education',
                    data={'graduation_data': '{}'},
                    headers={**H, 'Authorization': f'Bearer {d2}'},
                    content_type='multipart/form-data')
    after = owner_set_count()
    print(f"doctor{who} POST education -> {r.status_code}; owner-set rows {before} -> {after} "
          f"(+{after - before}; expect +1 if fresh doctor, new code dual-writes)")
