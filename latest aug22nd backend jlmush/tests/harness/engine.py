"""Equivalence-class + boundary-value test engine for API endpoints.

A :class:`Contract` describes one endpoint declaratively: a known-shape
baseline payload plus a :class:`Field` spec per input. The engine expands
that into the classic black-box case families:

  equivalence classes   missing / null / empty / wrong-type per field,
                        invalid member for enum fields, malformed member
                        for format fields (email, phone, date, time, uuid)
  boundary values       max_len → exactly-at-limit must not crash,
                        limit+1 must be refused; numeric min/max edges

Every generated case also asserts the UNIVERSAL response invariants:

  * the body is JSON with a boolean ``success``;
  * an error response carries a machine ``code`` (the error-envelope
    contract from app/common/responses.py);
  * the status is NEVER 5xx — bad input is the client's problem, a crash
    is ours. This single rule is what caught the malformed-uuid→500 bug
    class this harness exists to keep dead.

Usage (see test_*_contracts.py):

    CONTRACT = Contract(
        'signin', 'POST', '/api/v1/auth/signin',
        payload={'email': 'x@y.com', 'password': 'Secret123!'},
        fields={
            'email': Field(fmt='email'),
            'password': Field(max_len=128),
        },
    )

    @pytest.mark.parametrize('case', CONTRACT.cases(), ids=str)
    def test_signin_contract(client, case):
        case.run(client)

Cases are built at import time (no app/db needed), so pytest can show one
test id per case. ``Contract.payload`` may be a callable for payloads
that need per-case freshness (unique emails etc.).
"""
import copy
import json


# Values guaranteed malformed for each format family.
_BAD_FORMAT = {
    'email': 'not-an-email',
    'phone': '12345',                     # not a 10-digit Indian mobile
    'date': '2026-13-45',                 # unparseable calendar date
    'time': '25:99',
    'uuid': 'not-a-uuid',
}

# A value of a WRONG TYPE for any scalar field.
_WRONG_TYPE = {'unexpected': ['object', 'instead', 'of', 'scalar']}


class Field:
    """Spec for one payload field.

    required    engine generates missing/null/empty refusal cases
    fmt         'email' | 'phone' | 'date' | 'time' | 'uuid' — adds a
                malformed-member case
    max_len     adds boundary cases: exactly max_len (must not 5xx and
                must not be refused FOR LENGTH), max_len+1 (refused)
    min_len     adds min_len-1 refusal case
    allowed     iterable of valid enum members — adds an invalid-member case
    numeric     adds wrong-type ('abc') and extreme-value cases
    """

    def __init__(self, required=True, fmt=None, max_len=None, min_len=None,
                 allowed=None, numeric=False):
        self.required = required
        self.fmt = fmt
        self.max_len = max_len
        self.min_len = min_len
        self.allowed = allowed
        self.numeric = numeric


class Case:
    """One generated request + its expectation."""

    def __init__(self, contract, name, payload, expect):
        self.contract = contract
        self.name = name
        self.payload = payload
        # expect: 'refused' (4xx), 'no_crash' (anything < 500),
        #         'unauthorized' (401), or an int / tuple of ints.
        self.expect = expect
        self.headers_override = None

    def __str__(self):
        return f'{self.contract.name}:{self.name}'

    def run(self, client, headers=None):
        headers = dict(self.headers_override if self.headers_override is not None
                       else (headers or {}))
        kwargs = {'headers': headers}
        if self.payload is not None:
            kwargs['data'] = json.dumps(self.payload)
            kwargs['content_type'] = 'application/json'
        resp = client.open(self.contract.path, method=self.contract.method,
                           **kwargs)

        # ── universal invariants ─────────────────────────────────────────
        assert resp.status_code < 500, (
            f'{self}: got {resp.status_code} — bad input must never crash '
            f'the server. Body: {resp.get_data(as_text=True)[:300]}')
        body = resp.get_json(silent=True)
        assert isinstance(body, dict) and isinstance(body.get('success'), bool), (
            f'{self}: response is not the standard envelope '
            f'(status {resp.status_code}): {resp.get_data(as_text=True)[:200]}')
        if resp.status_code >= 400:
            assert body.get('code'), (
                f'{self}: error response missing machine "code" '
                f'(status {resp.status_code}): {body}')

        # ── per-case expectation ─────────────────────────────────────────
        if self.expect == 'refused':
            assert 400 <= resp.status_code < 500, (
                f'{self}: expected a 4xx refusal, got {resp.status_code}: {body}')
        elif self.expect == 'unauthorized':
            assert resp.status_code == 401, (
                f'{self}: expected 401, got {resp.status_code}: {body}')
        elif self.expect == 'no_crash':
            pass  # the universal <500 assertion already covered it
        elif isinstance(self.expect, int):
            assert resp.status_code == self.expect, (
                f'{self}: expected {self.expect}, got {resp.status_code}: {body}')
        else:  # tuple of acceptable statuses
            assert resp.status_code in self.expect, (
                f'{self}: expected one of {self.expect}, '
                f'got {resp.status_code}: {body}')
        return resp


class Contract:
    def __init__(self, name, method, path, payload=None, fields=None,
                 auth=False, baseline=None):
        """``auth=True`` adds no-token / garbage-token cases (the test
        function passes real headers for everything else). ``baseline``
        is the expected status (or tuple) for the untouched payload —
        omit to skip the happy-path case (e.g. when it would need
        un-mockable externals)."""
        self.name = name
        self.method = method
        self.path = path
        self._payload = payload
        self.fields = fields or {}
        self.auth = auth
        self.baseline = baseline

    def payload(self):
        base = self._payload() if callable(self._payload) else self._payload
        return copy.deepcopy(base) if base is not None else None

    def _mutate(self, name, **changes):
        p = self.payload()
        for key, value in changes.items():
            if value is _REMOVE:
                p.pop(key, None)
            else:
                p[key] = value
        return p

    def cases(self):
        out = []
        if self.baseline is not None:
            out.append(Case(self, 'baseline', self.payload(), self.baseline))

        for fname, spec in self.fields.items():
            if spec.required:
                out.append(Case(self, f'missing_{fname}',
                                self._mutate(fname, **{fname: _REMOVE}), 'refused'))
                out.append(Case(self, f'null_{fname}',
                                self._mutate(fname, **{fname: None}), 'refused'))
                if not spec.numeric:
                    out.append(Case(self, f'empty_{fname}',
                                    self._mutate(fname, **{fname: ''}), 'refused'))
            out.append(Case(self, f'wrong_type_{fname}',
                            self._mutate(fname, **{fname: _WRONG_TYPE}), 'refused'))
            if spec.fmt:
                out.append(Case(self, f'malformed_{fname}',
                                self._mutate(fname, **{fname: _BAD_FORMAT[spec.fmt]}),
                                'refused'))
            if spec.allowed is not None:
                out.append(Case(self, f'invalid_member_{fname}',
                                self._mutate(fname, **{fname: 'zz_not_a_member'}),
                                'refused'))
            if spec.max_len:
                out.append(Case(self, f'over_max_{fname}',
                                self._mutate(fname, **{fname: 'x' * (spec.max_len + 1)}),
                                'refused'))
                out.append(Case(self, f'at_max_{fname}',
                                self._mutate(fname, **{fname: 'x' * spec.max_len}),
                                'no_crash'))
            if spec.min_len and spec.min_len > 1:
                out.append(Case(self, f'under_min_{fname}',
                                self._mutate(fname, **{fname: 'x' * (spec.min_len - 1)}),
                                'refused'))
            if spec.numeric:
                out.append(Case(self, f'non_numeric_{fname}',
                                self._mutate(fname, **{fname: 'abc'}), 'refused'))
                out.append(Case(self, f'huge_{fname}',
                                self._mutate(fname, **{fname: 10 ** 12}), 'no_crash'))
                out.append(Case(self, f'negative_{fname}',
                                self._mutate(fname, **{fname: -1}), 'no_crash'))

        if self.auth:
            anon = Case(self, 'no_token', self.payload(), 'unauthorized')
            anon.headers_override = {}
            garbage = Case(self, 'garbage_token', self.payload(), 'unauthorized')
            garbage.headers_override = {'Authorization': 'Bearer not.a.jwt'}
            out += [anon, garbage]
        return out


class _Remove:
    def __repr__(self):
        return '<REMOVE>'


_REMOVE = _Remove()
