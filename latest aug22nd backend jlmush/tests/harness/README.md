# Endpoint contract harness

Equivalence-class + boundary-value tests, generated from declarative
endpoint contracts. See `engine.py`'s docstring for the case families;
`test_*_contracts.py` for the contract tables per surface.

## Running (in the backend container, against throwaway state)

Tests use the `healthcare_test` database on the existing postgres
container (`db.create_all()`, dropped/rebuilt freely) and redis DB 1 —
never the dev data. `tests/` is mounted read-only into the container.

```bash
docker exec -w /app -e PYTHONPATH=/app \
  -e TEST_DATABASE_URL="postgresql://postgres:<pw>@jlmush-postgres:5432/healthcare_test" \
  -e TEST_REDIS_URL="redis://:<pw>@jlmush-redis:6379/1" \
  jlmush-backend python -m pytest tests/harness -p no:cacheprovider -q
```

(passwords: `docker exec jlmush-backend printenv DATABASE_URL / REDIS_URL`;
pytest: `pip install -r requirements-dev.txt` inside the container after a
rebuild.)

## Adding an endpoint

1. Write a known-shape `payload` and a `Field` spec per input
   (`required`, `fmt='email'|'phone'|'date'|'time'|'uuid'`, `max_len`,
   `min_len`, `allowed`, `numeric`).
2. Pick a `baseline` expectation for the untouched payload — an exact
   status, a tuple, `'refused'`, or `'no_crash'`. Omit it when the happy
   path needs un-mockable state; the flow tests own happy paths.
3. Append the contract to `_ALL` in the surface's test file (or start a
   new `test_<surface>_contracts.py` from an existing one).

Every case asserts the universal invariants — JSON envelope, machine
`code` on errors, **never a 5xx** — so a new contract's `wrong_type_*`
cases are fuzzers with receipts. The first run of this harness found
eight real 500s (dict-where-string crashes) on the auth/appointment/
device surfaces; keep it in the loop for every new mobile endpoint.
