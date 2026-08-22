"""Seed the platform (apex marketing) landing.

Fixes two things at once:
  * The platform landing config editor (``/dashboard/platform/landing-config``)
    hangs on "Draft is loading…" because ``platform_landing_configs`` is empty
    — this seeds a DRAFT so the editor loads.
  * The apex (localhost) public landing has no modules — so the "featured
    slider" (third sliding bar), Popular Services, etc. are all empty. This
    seeds a LIVE config with modules + services, some flagged
    ``show_in_slider`` so the slider actually shows.

Not tenant-scoped (platform_landing_* has no tenant_id). Idempotent per
(scope=marketing, status): re-running won't duplicate.

    docker compose exec backend python scripts/seed_platform_landing.py
"""
import os
import sys

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from app import create_app
from app.extensions import db
from app.models import ConfigStatus
from app.models.platform_landing_page_config import (
    PlatformLandingConfig, PlatformLandingModule, PlatformLandingFeature,
    PlatformLandingScope,
)

# (module slug, name, show_in_slider, [ (feature slug, title, show_in_slider) ])
MODULES = [
    ('consultations', 'Consultations', True, [
        ('video-consultation', 'Video Consultation', True),
        ('audio-consultation', 'Audio Consultation', False),
    ]),
    ('lab-tests', 'Lab Tests', True, [
        ('blood-test', 'Blood Test', True),
    ]),
    ('pharmacy', 'Pharmacy', False, [
        ('order-medicines', 'Order Medicines', False),
    ]),
]


def _build(status):
    cfg = PlatformLandingConfig.query.filter_by(
        scope=PlatformLandingScope.MARKETING, status=status,
    ).first()
    if cfg:
        print(f'[--] marketing config already exists (status={status.value})')
        return cfg
    cfg = PlatformLandingConfig(
        scope=PlatformLandingScope.MARKETING, status=status, version=1,
        hero_title='Healthcare,', hero_subtitle='Simplified.',
        marketing_tagline='One platform for consultations, tests and medicines.',
        brand_name='Larazen',
    )
    db.session.add(cfg)
    db.session.flush()
    for mi, (mslug, mname, mslider, feats) in enumerate(MODULES):
        m = PlatformLandingModule(
            landing_config_id=cfg.id, slug=mslug, name=mname,
            display_order=mi, is_visible=True, is_additional=False,
            show_in_slider=mslider,
        )
        db.session.add(m)
        db.session.flush()
        for fi, (fslug, ftitle, fslider) in enumerate(feats):
            db.session.add(PlatformLandingFeature(
                module_id=m.id, slug=fslug, title=ftitle,
                display_order=fi, is_visible=True, is_popular=(fi == 0),
                show_in_slider=fslider,
            ))
    print(f'[OK] created marketing config (status={status.value}) with '
          f'{len(MODULES)} modules')
    return cfg


def main():
    app = create_app()
    with app.app_context():
        _build(ConfigStatus.LIVE)   # public apex landing renders this
        _build(ConfigStatus.DRAFT)  # editor loads this
        db.session.commit()
        print('[OK] platform landing seeded (LIVE + DRAFT, scope=marketing).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
