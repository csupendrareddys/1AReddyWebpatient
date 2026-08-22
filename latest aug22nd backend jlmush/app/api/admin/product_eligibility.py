"""Product eligibility criteria — validation and evaluation.

A product may restrict which doctors are allowed to offer it. Four independent
criteria, each stored on DoctorProduct and each following the convention
already set by ``allowed_specialization_ids``: NULL/empty means "no rule", so
an untouched product stays offerable by anyone.

  * allowed_specialization_ids      — handled by the existing group/product code
  * required_degree_ids             — hold ANY ONE of these degrees
  * required_work_qualification_ids — hold ANY ONE of these work qualifications
  * experience_rule                 — see below

The experience rule is in disjunctive normal form: a list of AND-groups, OR'd
together. A doctor qualifies if every condition in ANY ONE group holds.

    [[{"level": "ug", "years": 2}, {"level": "super_speciality", "years": 2}],
     [{"level": "pg", "years": 1}]]

reads as ``(UG >= 2y AND SS >= 2y) OR (PG >= 1y)``. This is deliberately flat
rather than an arbitrary boolean tree: with three levels it can still express
every combination, while staying cheap to validate and buildable in a UI.

Criteria are ANDed with each other — a doctor must satisfy all the rules a
product actually sets.
"""
from app.models.catalog import QUALIFICATION_LEVELS


class EligibilityRuleError(ValueError):
    """Raised when an admin submits a malformed rule."""


def clean_id_list(value, field_name):
    """Normalize a JSON id list to a list of strings, or None when empty.

    Mirrors ``_clean_spec_ids`` in availability_products.py so every criteria
    field stores and reads back identically.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        raise EligibilityRuleError(f'{field_name} must be a list of ids')
    out = [str(v).strip() for v in value if str(v).strip()]
    return out or None


def clean_experience_rule(value):
    """Validate + normalize the DNF experience rule. Returns None when empty.

    Rejects anything malformed rather than silently dropping it: a criteria
    field that quietly becomes "no rule" would make a product look correctly
    gated in the UI while being offerable by anyone.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        raise EligibilityRuleError('experience_rule must be a list of groups')

    groups = []
    for gi, group in enumerate(value):
        if not isinstance(group, list):
            raise EligibilityRuleError(f'experience_rule group {gi + 1} must be a list of conditions')

        conditions = []
        seen_levels = set()
        for condition in group:
            if not isinstance(condition, dict):
                raise EligibilityRuleError(f'experience_rule group {gi + 1} has a condition that is not an object')

            level = str(condition.get('level', '')).strip()
            if level not in QUALIFICATION_LEVELS:
                raise EligibilityRuleError(
                    f"experience_rule group {gi + 1}: level must be one of "
                    f"{', '.join(QUALIFICATION_LEVELS)}; got {level!r}"
                )
            # Two conditions on one level inside a single AND-group can only be
            # a mistake — the stricter one always wins, so the other is dead.
            if level in seen_levels:
                raise EligibilityRuleError(
                    f'experience_rule group {gi + 1} lists {level} twice; '
                    f'combine them into one condition'
                )
            seen_levels.add(level)

            try:
                years = int(condition.get('years'))
            except (TypeError, ValueError):
                raise EligibilityRuleError(
                    f'experience_rule group {gi + 1}: {level} years must be a whole number'
                )
            if years < 0:
                raise EligibilityRuleError(
                    f'experience_rule group {gi + 1}: {level} years cannot be negative'
                )
            conditions.append({'level': level, 'years': years})

        # An empty group would be a vacuous AND — i.e. always true — which
        # would silently make the whole rule match everyone.
        if not conditions:
            raise EligibilityRuleError(f'experience_rule group {gi + 1} is empty')
        groups.append(conditions)

    return groups or None


_TARGET_GENDERS = {'all', 'male', 'female'}
_TARGET_PAY_MODES = {'single', 'installments'}


def clean_targeting(raw):
    """Normalise an audience-targeting config to its canonical shape.

    Shared by products, group offerings and the doctor's per-consultation-
    type targeting so all three store identical JSON. ``None``/empty → None
    (clears). Unknown keys are dropped; malformed values raise
    :class:`EligibilityRuleError`.

    Canonical shape (all keys optional)::

        {
          "age":     {"priority": ["5-10", ...], "general": ["5-10", ...]},
          "gender":  {"priority": "all|male|female", "general": ...},
          "entity":  {"priority": ["proprietorship", ...], "general": "all"},
          "product_category_ids": ["<uuid>", ...],
          "payment": {"price": 1000.0, "mode": "single|installments",
                      "installments": [{"pct": 50, "due_after_days": 0}, ...]},
          "description": "...", "not_suggested_for": "...",
          "quotas":  {"messages": 20, "video_calls": 2, "voice_calls": 2}
        }
    """
    if raw in (None, '', {}, []):
        return None
    if not isinstance(raw, dict):
        raise EligibilityRuleError('targeting must be an object')

    def _str_list(value, cap):
        if not isinstance(value, list):
            return []
        return [str(v).strip() for v in value[:cap] if str(v).strip()]

    out = {}

    age = raw.get('age')
    if isinstance(age, dict):
        block = {k: _str_list(age.get(k), 40) for k in ('priority', 'general')}
        block = {k: v for k, v in block.items() if v}
        if block:
            out['age'] = block

    gender = raw.get('gender')
    if isinstance(gender, dict):
        block = {}
        for k in ('priority', 'general'):
            v = str(gender.get(k) or '').strip().lower()
            if v:
                if v not in _TARGET_GENDERS:
                    raise EligibilityRuleError(f'targeting.gender.{k} must be all/male/female')
                block[k] = v
        if block:
            out['gender'] = block

    entity = raw.get('entity')
    if isinstance(entity, dict):
        block = {}
        pr = _str_list(entity.get('priority'), 20)
        if pr:
            block['priority'] = pr
        gen = str(entity.get('general') or '').strip()
        if gen:
            block['general'] = gen
        if block:
            out['entity'] = block

    cats = _str_list(raw.get('product_category_ids'), 50)
    if cats:
        out['product_category_ids'] = cats

    pay = raw.get('payment')
    if isinstance(pay, dict):
        block = {}
        price = pay.get('price')
        if price not in (None, ''):
            try:
                price = float(price)
            except (TypeError, ValueError):
                raise EligibilityRuleError('targeting.payment.price must be a number')
            if price < 0:
                raise EligibilityRuleError('targeting.payment.price cannot be negative')
            block['price'] = price
        mode = str(pay.get('mode') or '').strip().lower()
        if mode:
            if mode not in _TARGET_PAY_MODES:
                raise EligibilityRuleError('targeting.payment.mode must be single or installments')
            block['mode'] = mode
        insts = pay.get('installments')
        if isinstance(insts, list):
            rows = []
            for it in insts[:12]:
                if not isinstance(it, dict):
                    continue
                try:
                    pct = float(it.get('pct') or 0)
                    days = int(it.get('due_after_days') or 0)
                except (TypeError, ValueError):
                    raise EligibilityRuleError('targeting.payment.installments rows need numeric pct/due_after_days')
                if pct <= 0:
                    continue
                rows.append({'pct': pct, 'due_after_days': max(0, days)})
            if rows:
                block['installments'] = rows
        if block:
            out['payment'] = block

    for k in ('description', 'not_suggested_for'):
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:2000]

    quotas = raw.get('quotas')
    if isinstance(quotas, dict):
        block = {}
        for k in ('messages', 'video_calls', 'voice_calls'):
            v = quotas.get(k)
            if v in (None, ''):
                continue
            try:
                block[k] = max(0, int(v))
            except (TypeError, ValueError):
                raise EligibilityRuleError(f'targeting.quotas.{k} must be a whole number')
        if block:
            out['quotas'] = block

    # Body organs (static frontend list) + symptom ids (the symptoms master
    # the doctor portal already uses).
    for key, cap in (('body_organs', 40), ('symptoms', 100)):
        vals = _str_list(raw.get(key), cap)
        if vals:
            out[key] = vals

    flow = str(raw.get('flow_type') or '').strip().lower()
    if flow:
        if flow not in ('consultation_flow', 'plan_flow'):
            raise EligibilityRuleError(
                'targeting.flow_type must be consultation_flow or plan_flow')
        out['flow_type'] = flow

    # Call flow — intro call(s) → mid call(s) → end call.
    call_flow = raw.get('call_flow')
    if isinstance(call_flow, dict):
        block = {}
        for k in ('intro_calls', 'mid_calls', 'end_calls'):
            v = call_flow.get(k)
            if v in (None, ''):
                continue
            try:
                block[k] = max(0, int(v))
            except (TypeError, ValueError):
                raise EligibilityRuleError(f'targeting.call_flow.{k} must be a whole number')
        if block:
            out['call_flow'] = block

    # "Recommended for you" — admin-set, three INDEPENDENT lists. Display
    # priority when rendered (mobile): doctor > product > specialization.
    rec = raw.get('recommended')
    if isinstance(rec, dict):
        block = {}
        for k in ('doctor_ids', 'product_ids', 'specialization_ids'):
            vals = _str_list(rec.get(k), 50)
            if vals:
                block[k] = vals
        if block:
            out['recommended'] = block

    return out or None


def describe_experience_rule(rule):
    """Human-readable rendering, for API messages and admin display."""
    if not rule:
        return 'No experience requirement'
    labels = {'ug': 'UG', 'pg': 'PG', 'super_speciality': 'Super-speciality'}
    parts = [
        ' and '.join(f"{labels.get(c['level'], c['level'])} ≥ {c['years']}y" for c in group)
        for group in rule
    ]
    return ' or '.join(f'({p})' for p in parts) if len(parts) > 1 else parts[0]


def doctor_experience_by_level(doctor_id, tenant_id):
    """{level: years} the doctor has stated on their About-me profile.

    About-me is the only place a doctor states this. (An unreachable
    years_experience column on ProfileEducationSpecialization used to look
    like the source of truth; it was never writable and has been removed.)

    A level the doctor has not stated is simply absent, so it reads as unmet
    rather than as zero years served.
    """
    from app.models import ProfileAbout

    about = ProfileAbout.query.filter_by(
        tenant_id=tenant_id, doctor_id=doctor_id,
    ).first()
    return about.experience_by_level() if about else {}


def check_product_eligibility(product, doctor_id, tenant_id):
    """Return (ok, reason). reason is None when eligible.

    Every criterion the product leaves empty is skipped, so a product with no
    criteria is offerable by anyone.
    """
    from app.models.profile_shared import (
        ProfileEducationDegree, ProfileWorkQualification,
    )

    held_degree_ids = None

    def _held_degree_ids():
        """Degree category ids the doctor actually holds. Previously this gate
        compared required_degree_ids against ProfileEducationSpecialization
        (SPECIALIZATION categories) — a structural mismatch that made degree
        requirements essentially unsatisfiable. Degrees live on
        ProfileEducationDegree.degree_category_id."""
        nonlocal held_degree_ids
        if held_degree_ids is None:
            rows = ProfileEducationDegree.query.filter(
                ProfileEducationDegree.tenant_id == tenant_id,
                ProfileEducationDegree.doctor_id == doctor_id,
                ProfileEducationDegree.degree_category_id.isnot(None),
            ).all()
            held_degree_ids = {str(r.degree_category_id) for r in rows}
        return held_degree_ids

    required_degrees = product.required_degree_ids or []
    if required_degrees and not any(str(d) in _held_degree_ids() for d in required_degrees):
        return False, 'You do not hold a degree this product requires.'

    required_work_quals = product.required_work_qualification_ids or []
    if required_work_quals:
        # Read the MULTI ProfileWorkQualification store the About form writes
        # (a doctor may hold several); union the legacy single
        # ProfileAbout.work_qualification_id for back-compat with rows written
        # before the multi migration. Eligible if ANY held qual is required.
        from app.models import ProfileAbout
        held_wq = {
            str(r.category_id)
            for r in ProfileWorkQualification.query.filter(
                ProfileWorkQualification.tenant_id == tenant_id,
                ProfileWorkQualification.doctor_id == doctor_id,
            ).all()
        }
        about = ProfileAbout.query.filter_by(
            tenant_id=tenant_id, doctor_id=doctor_id,
        ).first()
        if about and about.work_qualification_id:
            held_wq.add(str(about.work_qualification_id))
        if not any(str(w) in held_wq for w in required_work_quals):
            return False, 'Your work qualification does not match what this product requires.'

    rule = product.experience_rule or []
    if rule:
        best = doctor_experience_by_level(doctor_id, tenant_id)
        satisfied = any(
            all(best.get(c['level'], 0) >= c['years'] for c in group)
            for group in rule
        )
        if not satisfied:
            return False, (
                'You do not meet the experience requirement: '
                + describe_experience_rule(rule)
            )

    return True, None
