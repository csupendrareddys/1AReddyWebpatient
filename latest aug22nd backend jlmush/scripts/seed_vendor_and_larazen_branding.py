"""Give the SaaS vendor and Larazen visibly different identities.

After the split the two sites were indistinguishable: ``platform_landing_configs``
was **empty** and Larazen's ``landing_configs.brand_name`` was NULL, so both
fell through to the same hardcoded ``'JLMush Hospital'`` placeholder in
PublicLandingLayout. Two different businesses rendering identical chrome makes
the separation impossible to eyeball -- and easy to get wrong in testing,
because you cannot tell which host you are looking at.

  * VENDOR  -> a LIVE ``MARKETING`` platform-landing config: software-company
    name, indigo theme. This is the SaaS seller's own site.
  * LARAZEN -> its existing tenant landing config gets ``brand_name='Larazen'``
    and a clearly different (teal) theme, promoted to LIVE.

Colours are deliberately far apart on the wheel; the point is contrast, not
taste. Both are editable afterwards from the respective landing builders.

Idempotent.
"""
from app import create_app
from app.extensions import db

VENDOR_BRAND = 'JLMush Cloud'
VENDOR_TAGLINE = 'Run your organisation on your own branded portal.'
# Must be a key in the frontend's LANDING_THEME_PRESETS
# (src/theme/landingThemePresets.js): ocean | emerald | royal | sunset |
# midnight. Anything else silently falls back to the default blue -- and
# writing straight through the ORM bypasses the marshmallow OneOf
# validator that would otherwise reject it.
VENDOR_THEME = 'royal'     # deep purple -- reads as a software vendor
VENDOR_COLOR = '#5e35b1'

LARAZEN_BRAND = 'Larazen Health'
LARAZEN_THEME = 'emerald'  # fresh green -- clearly not the vendor
LARAZEN_COLOR = '#2e7d32'


def main():
    app = create_app()
    with app.app_context():
        from app.models import Tenant
        from app.models.platform_landing_page_config import (
            PlatformLandingConfig, PlatformLandingScope,
        )
        from app.models.landing_page_config import LandingConfig
        from app.models._enums import ConfigStatus

        # ── Vendor marketing site ────────────────────────────────────
        cfg = (
            PlatformLandingConfig.query
            .filter_by(scope=PlatformLandingScope.MARKETING,
                       status=ConfigStatus.LIVE)
            .first()
        )
        created = cfg is None
        if created:
            cfg = PlatformLandingConfig(
                scope=PlatformLandingScope.MARKETING,
                status=ConfigStatus.LIVE,
                version=1,
            )
            db.session.add(cfg)
        cfg.brand_name = VENDOR_BRAND
        cfg.theme_preset = VENDOR_THEME
        cfg.primary_color = VENDOR_COLOR
        for attr, val in (
            ('brand_sub_tagline', VENDOR_TAGLINE),
            ('hero_title', 'Software for organisations that deliver services'),
            ('hero_subtitle', VENDOR_TAGLINE),
        ):
            if hasattr(cfg, attr):
                setattr(cfg, attr, val)
        db.session.flush()
        print('%s vendor marketing config -> %s / %s'
              % ('created' if created else 'updated', VENDOR_BRAND, VENDOR_COLOR))

        # ── Larazen tenant site ──────────────────────────────────────
        lz = Tenant.query.filter_by(slug='larazen').first()
        if lz is None:
            raise SystemExit('No larazen tenant -- run split_apex_tenant.py first.')

        rows = LandingConfig.query.filter_by(tenant_id=lz.id).all()
        if not rows:
            raise SystemExit('Larazen has no landing_configs row to brand.')

        for row in rows:
            row.brand_name = LARAZEN_BRAND
            row.theme_preset = LARAZEN_THEME
            row.primary_color = LARAZEN_COLOR

        # The public site renders the LIVE config; Larazen's only row was
        # DRAFT, which is why its brand never reached the page.
        if not any(r.status == ConfigStatus.LIVE for r in rows):
            rows[0].status = ConfigStatus.LIVE
            print('promoted Larazen landing config DRAFT -> LIVE')

        db.session.commit()
        print('updated larazen landing (%d row(s)) -> %s / %s'
              % (len(rows), LARAZEN_BRAND, LARAZEN_COLOR))


if __name__ == '__main__':
    main()
