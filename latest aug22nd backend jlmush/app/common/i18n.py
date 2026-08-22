"""Centralized i18n utilities.

Every config-style model in this product stores text in English defaults plus
an optional ``translations`` JSON column shaped as::

    {
        "<field_key>": {"hi": "...", "te": "...", ...},
        ...
    }

Historically each consumer (login page config, patient profile fields, landing
features) rolled its own :func:`apply_translations` function with a hardcoded
``translatable_fields`` list. That duplication is why adding a new language or
a new translatable field meant editing several files. This module is the one
place callers should reach for.

Supported languages live in :data:`SUPPORTED_LANGUAGES`. New languages are
added here; no consumer needs to change.
"""
from typing import Iterable, Mapping, Optional


# Keep in sync with Frontend/src/common/i18n/languages.js
SUPPORTED_LANGUAGES = [
    {'code': 'en', 'label': 'English',  'native': 'English',    'direction': 'ltr'},
    {'code': 'hi', 'label': 'Hindi',    'native': 'हिन्दी',        'direction': 'ltr'},
    {'code': 'te', 'label': 'Telugu',   'native': 'తెలుగు',      'direction': 'ltr'},
    {'code': 'ta', 'label': 'Tamil',    'native': 'தமிழ்',       'direction': 'ltr'},
    {'code': 'kn', 'label': 'Kannada',  'native': 'ಕನ್ನಡ',       'direction': 'ltr'},
    {'code': 'ml', 'label': 'Malayalam', 'native': 'മലയാളം',     'direction': 'ltr'},
    {'code': 'bn', 'label': 'Bengali',  'native': 'বাংলা',        'direction': 'ltr'},
    {'code': 'mr', 'label': 'Marathi',  'native': 'मराठी',        'direction': 'ltr'},
    {'code': 'gu', 'label': 'Gujarati', 'native': 'ગુજરાતી',      'direction': 'ltr'},
    {'code': 'pa', 'label': 'Punjabi',  'native': 'ਪੰਜਾਬੀ',       'direction': 'ltr'},
    {'code': 'or', 'label': 'Odia',     'native': 'ଓଡ଼ିଆ',        'direction': 'ltr'},
    {'code': 'as', 'label': 'Assamese', 'native': 'অসমীয়া',     'direction': 'ltr'},
    {'code': 'ur', 'label': 'Urdu',     'native': 'اردو',         'direction': 'rtl'},
]

SUPPORTED_LANGUAGE_CODES = {l['code'] for l in SUPPORTED_LANGUAGES}
DEFAULT_LANGUAGE = 'en'


def is_supported(lang: Optional[str]) -> bool:
    return lang in SUPPORTED_LANGUAGE_CODES


def apply_translations(
    config_dict: Optional[Mapping],
    lang: str = DEFAULT_LANGUAGE,
    translatable_fields: Optional[Iterable[str]] = None,
) -> Optional[Mapping]:
    """Replace each ``translatable_fields`` key on ``config_dict`` with its
    value from ``config_dict['translations'][field][lang]`` when present.

    Fields with no translation for the requested language fall back to whatever
    the base English value already was. When ``lang`` is the default language
    or ``config_dict`` is empty/None, the dict is returned unchanged.

    The caller supplies ``translatable_fields`` so each model decides which of
    its keys are subject to translation; when omitted, the function translates
    *every* key found under ``config_dict['translations']`` (useful for ad-hoc
    dicts whose shape is not known in advance).

    Args:
        config_dict: A model-to-dict payload, possibly containing a
            ``translations`` sub-dict.
        lang: Target language code; pass one of :data:`SUPPORTED_LANGUAGE_CODES`.
        translatable_fields: Explicit whitelist of top-level keys that may be
            translated. When None, falls back to whatever ``translations``
            contains.
    Returns:
        The same dict instance, mutated in place, or unchanged when no work is
        needed.
    """
    if not config_dict or lang == DEFAULT_LANGUAGE:
        return config_dict

    translations = config_dict.get('translations') or {}
    if not translations:
        return config_dict

    keys = translatable_fields if translatable_fields is not None else translations.keys()
    for field in keys:
        lang_map = translations.get(field)
        if isinstance(lang_map, dict) and lang in lang_map and lang_map[lang] not in (None, ''):
            config_dict[field] = lang_map[lang]

    return config_dict


def translation_completion(
    translations: Optional[Mapping],
    translatable_fields: Iterable[str],
    lang: str,
) -> dict:
    """Report how many of ``translatable_fields`` have a non-empty string for
    ``lang``. Used by admin UIs that show per-language progress ("4/17 translated").
    """
    if lang == DEFAULT_LANGUAGE:
        total = len(list(translatable_fields))
        return {'translated': total, 'total': total, 'percent': 100}

    translations = translations or {}
    fields_list = list(translatable_fields)
    translated = 0
    for field in fields_list:
        val = (translations.get(field) or {}).get(lang)
        if val:
            translated += 1
    total = len(fields_list)
    return {
        'translated': translated,
        'total': total,
        'percent': int((translated / total) * 100) if total else 0,
    }
