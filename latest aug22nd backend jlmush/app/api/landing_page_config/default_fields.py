"""Seed data for a new tenant's initial LIVE LandingConfig.

Kept deliberately minimal: one empty hero + one placeholder module with one
feature so the public site renders something on day zero. Tenants replace
these via the admin editor.
"""
import copy


DEFAULT_HERO = {
    'hero_title': 'Welcome',
    'hero_subtitle': 'Configure your landing page from the admin dashboard.',
    'hero_cta_label': 'Get Started',
    'hero_cta_href': '#',
    'theme_preset': 'ocean',
    'primary_color': '#1976d2',
    'secondary_color': '#dc004e',
    'accent_color': '#26a69a',
    'background_color': '#ffffff',
    'hero_style': 'gradient',
    'marketing_tagline': '',
    'footer_text': '',
    'meta': {},
}


# No seeded modules. Earlier this carried a placeholder "Startup" module
# full of company-registration demo copy (sole proprietorship, PAN card,
# "Rs 299"...) left over from a business-services prototype — every fresh
# tenant's public nav rendered it as if the tenant had authored it. A new
# tenant should start with NO modules; curated starter content belongs in
# the platform owner's DEFAULT_TEMPLATE landing config, which
# ``_seed_tenant_landing`` copies when present. This list is only the
# last-resort fallback for installs without a template.
DEFAULT_MODULES = []


def get_default_hero():
    return dict(DEFAULT_HERO)


def get_default_modules():
    # Deep copy so callers can mutate without corrupting the module-level seed.
    return copy.deepcopy(DEFAULT_MODULES)
