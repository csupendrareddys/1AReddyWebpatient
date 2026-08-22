"""Audience-targeting rank — scores an offering's ``targeting`` config
against the browsing patient so targeted items surface first.

Phase 2 of the targeting feature: the configs are authored on the admin
product / group-offering forms and the doctor's Slot Visibility tab
(``clean_targeting`` shape); this module is the read side. Scoring is
additive per dimension so multiple matches stack:

  * age    — patient age inside a *priority* range +2, a *general* range +1
  * gender — *priority* exact match +2, *general* exact match +1
             ('all' adds nothing: it targets nobody in particular)
  * entity — patient's entity type in the *priority* list +2

An offering with no targeting scores 0, so untargeted catalogs keep their
existing created_at ordering (the sort is stable).
"""
import logging
from datetime import date

logger = logging.getLogger(__name__)


def _age_years(dob):
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _in_ranges(age, ranges):
    """True when ``age`` falls inside any 'lo-hi' string in ``ranges``."""
    if age is None or not isinstance(ranges, list):
        return False
    for r in ranges:
        try:
            lo, hi = str(r).split('-', 1)
            if float(lo) <= age <= float(hi):
                return True
        except (ValueError, AttributeError):
            continue
    return False


def patient_targeting_profile(user):
    """The browsing patient's attributes the score reads: age (from DOB),
    gender, and entity type (their primary EntityProfile; 'individual'
    when none). One small query; failures degrade to a neutral profile."""
    profile = {
        'age_years': _age_years(getattr(user, 'dob', None)),
        'gender': (user.gender.value if getattr(user, 'gender', None) else None),
        'entity_type': 'individual',
    }
    try:
        from app.models import Patient, EntityProfile
        patient = Patient.query.filter_by(
            user_id=user.id, is_deleted=False).first()
        if patient:
            ep = EntityProfile.query.filter_by(
                tenant_id=user.tenant_id, patient_id=patient.id,
            ).order_by(EntityProfile.is_primary.desc()).first()
            if ep and ep.entity_type:
                profile['entity_type'] = (
                    ep.entity_type.value
                    if hasattr(ep.entity_type, 'value') else str(ep.entity_type)
                )
    except Exception:  # pragma: no cover — never break browsing over ranking
        logger.exception('[TARGETING] profile resolution failed')
        # A failed statement poisons the whole transaction ("current
        # transaction is aborted…") — roll back so the browse queries that
        # follow still run.
        try:
            from app.extensions import db
            db.session.rollback()
        except Exception:
            pass
    return profile


def targeting_score(targeting, profile):
    """Additive match score of one offering's targeting vs the patient."""
    if not targeting or not isinstance(targeting, dict):
        return 0
    score = 0

    age = profile.get('age_years')
    age_block = targeting.get('age') or {}
    if _in_ranges(age, age_block.get('priority')):
        score += 2
    elif _in_ranges(age, age_block.get('general')):
        score += 1

    gender = profile.get('gender')
    gender_block = targeting.get('gender') or {}
    if gender:
        if gender_block.get('priority') == gender:
            score += 2
        elif gender_block.get('general') == gender:
            score += 1

    entity = profile.get('entity_type')
    entity_block = targeting.get('entity') or {}
    if entity and isinstance(entity_block.get('priority'), list) \
            and entity in entity_block['priority']:
        score += 2

    return score
