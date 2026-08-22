"""Seed a FULL dummy landing page for ONE customer tenant (UI testing)."""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, '/app'):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Tenant to seed — matched by EXACT slug, then EXACT domain. Never the apex.
TENANT = os.environ.get('LANDING_TENANT_SLUG', 'aitaxfillings-3')

BRAND_LOGO = 'https://placehold.co/200x56/1565c0/ffffff?text=AI+Tax+Filing'
YT = [
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    'https://www.youtube.com/watch?v=ScMzIvxBSi4',
    'https://www.youtube.com/watch?v=ysz5S6PUM-U',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
]

MODULES = [
    ('company-registration', 'Company Registration', 'business',
     'Register your business the right way — Pvt Ltd, LLP, OPC and more.',
     [('Private Limited Company', 'Most popular structure for startups raising funds.'),
      ('LLP Registration', 'Limited-liability partnership with lighter compliance.')]),
    ('gst-services', 'GST Services', 'receipt_long',
     'End-to-end GST registration, returns and reconciliation.',
     [('GST Registration', 'Get your GSTIN in a few working days.'),
      ('GST Return Filing', 'Monthly / quarterly GSTR filing by experts.')]),
    ('income-tax', 'Income Tax Filing', 'description',
     'ITR filing for individuals, professionals and businesses.',
     [('Salaried ITR', 'File your salaried return with maximum refund.'),
      ('Business ITR', 'Presumptive & regular business return filing.')]),
    ('trademark-ip', 'Trademark & IP', 'verified',
     'Protect your brand with trademark, copyright and patent services.',
     [('Trademark Registration', 'Secure your brand name and logo.'),
      ('Copyright Registration', 'Protect your original creative work.')]),
    ('roc-compliance', 'ROC Compliance', 'gavel',
     'Annual filings and secretarial compliance for companies & LLPs.',
     [('Annual ROC Filing', 'AOC-4 & MGT-7 filed on time, every year.'),
      ('Director KYC (DIR-3)', 'Keep every director KYC-compliant.')]),
    ('accounting', 'Accounting & Bookkeeping', 'calculate',
     'Monthly books, MIS and payroll handled by professionals.',
     [('Monthly Bookkeeping', 'Clean, audit-ready books every month.'),
      ('Payroll Management', 'Salary, PF, ESI and payslips, done for you.')]),
    ('licenses', 'Licenses & Registrations', 'badge',
     'Every statutory license your business needs, in one place.',
     [('MSME / Udyam', 'Register as MSME and unlock benefits.'),
      ('Shop & Establishment', 'Get your Gumasta / S&E license.')]),
    ('fssai', 'FSSAI & Food License', 'restaurant',
     'Food safety licenses for manufacturers, traders and restaurants.',
     [('FSSAI Basic', 'For small food businesses under 12 lakh turnover.'),
      ('FSSAI State License', 'For medium food businesses and restaurants.')]),
    ('iec', 'Import Export Code', 'local_shipping',
     'Start importing / exporting with a lifetime-valid IEC.',
     [('IEC Registration', 'Get your Import Export Code quickly.'),
      ('IEC Modification', 'Update your existing IEC details.')]),
    ('startup-india', 'Startup India', 'rocket_launch',
     'DPIIT recognition, tax exemptions and startup funding readiness.',
     [('DPIIT Recognition', 'Get recognised under Startup India.'),
      ('80-IAC Tax Exemption', 'Apply for the 3-year tax holiday.')]),
]

RECOGNITIONS = [
    ('ISO 9001:2015 Certified', 'Quality Management', 'Audited quality systems you can trust.'),
    ('MSME Registered', 'Govt. of India', 'A recognised MSME service provider.'),
    ('Startup India Partner', 'DPIIT', 'Empanelled to serve DPIIT-recognised startups.'),
    ('GST Suvidha Provider', 'GSTN', 'Authorised GST filing intermediary.'),
]

VIDEOS = [
    ('How to Register a Private Limited Company', 'A 3-minute walkthrough of the incorporation process.', YT[0], 'Company'),
    ('GST Filing Explained', 'Everything you need to know about monthly GST returns.', YT[1], 'GST'),
    ('Income Tax Filing for Salaried', 'File your ITR in minutes with these steps.', YT[2], 'Income Tax'),
    ('Trademark Your Brand', 'Why and how to protect your brand name.', YT[3], 'Trademark'),
]

EXPERTS = [
    ('CA Ananya Sharma', 'Chartered Accountant', 'CA, B.Com (Hons)', '12+ years in tax & audit for startups and SMEs.'),
    ('CS Rohan Mehta', 'Company Secretary', 'CS, LLB', 'Specialist in ROC compliance and secretarial work.'),
    ('Adv. Priya Nair', 'IP Attorney', 'LLB, Trademark Agent', 'Handles trademark, copyright and patent filings.'),
    ('CA Vikram Rao', 'GST Consultant', 'CA, DISA', 'Leads GST advisory and litigation support.'),
]

REVIEWS = [
    ('Suresh Kumar', 'Founder, Kumar Textiles', 5, 'Registered my Pvt Ltd in a week. Smooth and transparent.'),
    ('Meena Iyer', 'Freelance Designer', 5, 'ITR filing was effortless and I got a great refund.'),
    ('Arjun Patel', 'Restaurant Owner', 4, 'Got my FSSAI license without any hassle. Recommended.'),
    ('Nisha Verma', 'D2C Brand Owner', 5, 'Trademark process was clearly explained end to end.'),
    ('Rahul Deshpande', 'CFO, TechNova', 5, 'Their monthly accounting keeps our books audit-ready.'),
]

BRANDS = [
    ('Apollo Ventures', 'https://example.com'),
    ('Zenith Capital', 'https://example.com'),
    ('BlueOcean Labs', 'https://example.com'),
    ('Nimbus Retail', 'https://example.com'),
    ('Orbit Foods', 'https://example.com'),
    ('Vertex Motors', 'https://example.com'),
]


def _feature_payload(mod_slug, idx, title, desc):
    return dict(
        slug=f'{mod_slug}-feature-{idx}',
        title=title,
        description=desc,
        starting_price=f'₹{999 + idx * 500:,}',
        timeline=f'{5 + idx}-{9 + idx} working days',
        rating='4.8/5',
        what_is=f'{title} is a fully managed service. Our experts handle the '
                'paperwork, government filings and follow-ups so you can focus '
                'on running your business.',
        requirements=['Valid PAN & Aadhaar', 'Business address proof',
                      'Passport-size photographs', 'Email & mobile number'],
        documents=['PAN card', 'Aadhaar card', 'Address proof',
                   'Bank statement / cancelled cheque'],
        benefits=['100% online process', 'Dedicated expert support',
                  'Transparent pricing', 'On-time delivery'],
        disadvantages=['Requires accurate documents upfront',
                       'Government processing time is not in our control'],
        process=[{'title': 'Share details', 'desc': 'Fill a short form and upload documents.'},
                 {'title': 'Expert review', 'desc': 'Our team verifies and prepares the filing.'},
                 {'title': 'Government filing', 'desc': 'We submit to the relevant authority.'},
                 {'title': 'Delivery', 'desc': 'Receive your certificate / acknowledgement.'}],
        who_should_join=[
            {'title': 'Early-stage founders',
             'desc': 'Setting up their first legal entity.'},
            {'title': 'Growing small businesses',
             'desc': 'That have outgrown an informal setup.'},
            {'title': 'Freelancers & consultants',
             'desc': 'Who need to invoice clients formally.'},
        ],
        whats_included=[
            {'title': 'Dedicated expert',
             'desc': 'One point of contact from kickoff to delivery.'},
            {'title': 'Document preparation',
             'desc': 'We draft and format everything the authority expects.'},
            {'title': 'Government filing fees',
             'desc': 'Covered in the quoted price — no surprise add-ons.'},
        ],
        expected_outcomes=[
            {'title': 'Filing completed end-to-end',
             'desc': 'Submitted to the relevant authority without you chasing anyone.'},
            {'title': 'Certificate in hand',
             'desc': 'Delivered digitally as soon as the authority issues it.'},
            {'title': 'Compliance-ready records',
             'desc': 'All acknowledgements stored and downloadable any time.'},
        ],
        book_cta_label='Book Now',
        sections_enabled_json={'what_is': True, 'eligibility': True,
                               'who_should_join': True, 'whats_included': True,
                               'benefits': True, 'disadvantages': True,
                               'expected_outcomes': True,
                               'how_it_works': True, 'documents': True,
                               'pricing': True, 'rating': True, 'book_now': True},
        display_order=idx,
        is_visible=True,
    )


def main():
    from app import create_app
    from app.extensions import db
    from app.common.tenant_context import with_tenant_context
    from app.models._base import utcnow
    from app.models._enums import ConfigStatus
    from app.models import Tenant
    from app.models.landing_page_config import (
        LandingConfig, LandingModule, LandingFeature, LandingRecognition,
        LandingVideo, LandingDoctor, LandingReview, LandingTrustedBrand,
    )

    app = create_app()
    with app.app_context():
        # ── Resolve EXACTLY ONE target tenant (exact slug OR exact domain) ──
        tenant = Tenant.query.filter_by(slug=TENANT, is_deleted=False).first()
        if not tenant:
            tenant = (Tenant.query
                      .filter(db.func.lower(Tenant.domain) == TENANT.lower(),
                              Tenant.is_deleted.is_(False))
                      .first())
        if not tenant:
            print(f'[ERR] No tenant whose slug or domain equals "{TENANT}". Available:')
            for t in Tenant.query.filter_by(is_deleted=False).all():
                mark = '   <-- APEX (do not use)' if t.is_default else ''
                print(f'    - slug={t.slug!r:24} domain={t.domain!r}{mark}')
            return 1
        # Never seed the apex/platform tenant with this script.
        if tenant.is_default:
            print(f'[ABORT] "{tenant.slug}" is the APEX/platform tenant. '
                  "Set LANDING_TENANT_SLUG to ONE customer tenant's slug or domain.")
            return 1

        print('=' * 64)
        print(f' Seeding landing page for tenant: {tenant.slug}  ({tenant.id})')
        print('=' * 64)

        with with_tenant_context(tenant.id):
            # ── 1. LIVE LandingConfig (enrich existing, else create) ───
            config = (LandingConfig.query
                      .filter_by(tenant_id=tenant.id, status=ConfigStatus.LIVE)
                      .first())
            if not config:
                config = LandingConfig(tenant_id=tenant.id,
                                       status=ConfigStatus.LIVE, version=1)
                db.session.add(config)
                db.session.flush()

            config.hero_title = 'File Taxes & Register Your Business, Effortlessly'
            config.hero_subtitle = ('Company registration, GST, ITR, trademarks and '
                                    'compliance — all handled by verified experts.')
            config.hero_cta_label = 'Get Started'
            config.hero_cta_href = '/services'
            config.hero_body_text = ('From incorporation to annual compliance, we take '
                                     'care of the paperwork so you can focus on growth.')
            config.hero_search_placeholder = 'Search a service (e.g. GST, Pvt Ltd, ITR)…'
            config.hero_style = 'gradient'
            config.theme_preset = 'ocean'
            config.primary_color = '#1565c0'
            config.secondary_color = '#ff6f00'
            config.accent_color = '#26a69a'
            config.background_color = '#ffffff'
            config.marketing_tagline = 'India’s trusted tax & compliance partner'
            config.brand_name = 'AI Tax Filing'
            config.brand_logo_url = BRAND_LOGO
            config.brand_sub_tagline = 'Taxes. Registrations. Compliance.'
            config.support_email = 'support@aitaxfillings.in'
            config.trust_badge_text = 'Trusted by 25,000+ businesses across India'
            config.footer_text = '© 2026 AI Tax Filing. All rights reserved.'

            config.cta_band_title = 'Are you a CA or Tax Professional?'
            config.cta_band_subtitle = 'Partner with us and grow your practice.'
            config.cta_band_label = 'Become a Partner'
            config.cta_band_href = '/join/partner'
            config.ready_cta_title = 'Ready to get started?'
            config.ready_cta_subtitle = 'Talk to an expert in minutes.'
            config.ready_cta_label = 'Talk to an Expert'
            config.ready_cta_href = '/contact'

            config.why_section_title = 'Why AI Tax Filing?'
            config.why_section_subtitle = 'Everything you need, under one roof.'
            config.services_section_title = 'Popular Services'
            config.services_section_subtitle = 'The services businesses ask for most.'
            config.categories_section_title = 'Browse by Category'
            config.categories_section_subtitle = 'Find the right service for your stage.'
            config.testimonials_section_title = 'What Our Clients Say'
            config.testimonials_section_subtitle = 'Real results for real businesses.'
            config.faq_section_title = 'Frequently Asked Questions'
            config.faq_section_subtitle = 'Answers to the questions we hear most.'
            config.doctors_section_title = 'Meet Our Experts'
            config.reviews_section_title = 'Client Reviews'
            config.brands_section_title = 'Trusted by Leading Brands'

            config.stats = [
                {'value': '25,000+', 'label': 'Businesses Served'},
                {'value': '4.8/5', 'label': 'Average Rating'},
                {'value': '50+', 'label': 'Services'},
                {'value': '99%', 'label': 'On-time Delivery'},
            ]
            config.testimonials = [
                {'quote': 'Fast, transparent and reliable. Highly recommended.',
                 'name': 'Suresh Kumar', 'role': 'Founder, Kumar Textiles'},
                {'quote': 'They made GST filing completely stress-free.',
                 'name': 'Meena Iyer', 'role': 'Freelance Designer'},
                {'quote': 'Best decision for our startup’s compliance.',
                 'name': 'Arjun Patel', 'role': 'Co-founder, FreshBite'},
            ]
            config.hero_partners = [
                {'name': 'MSME'}, {'name': 'Startup India'}, {'name': 'GSTN'},
                {'name': 'MCA'}, {'name': 'ISO'},
            ]
            config.why_features = [
                {'title': 'Verified Experts', 'description': 'CAs, CSs and lawyers on every case.'},
                {'title': '100% Online', 'description': 'No office visits — do it all from home.'},
                {'title': 'Transparent Pricing', 'description': 'No hidden fees, ever.'},
                {'title': 'On-time Delivery', 'description': 'We track every deadline for you.'},
            ]
            config.faqs = [
                {'question': 'How long does company registration take?',
                 'answer': 'Typically 7–10 working days once documents are ready.'},
                {'question': 'Do I need to visit an office?',
                 'answer': 'No. The entire process is online and paperless.'},
                {'question': 'What documents are required?',
                 'answer': 'Usually PAN, Aadhaar, address proof and photographs.'},
                {'question': 'Is GST registration mandatory?',
                 'answer': 'It depends on your turnover and business type — we’ll advise you.'},
                {'question': 'Do you offer ongoing compliance?',
                 'answer': 'Yes, we offer annual compliance and accounting packages.'},
            ]
            config.section_visibility = {
                'hero_partners': True, 'categories': True, 'services': True,
                'why_us': True, 'ready_cta': True, 'videos': True,
                'testimonials': True, 'faq': True, 'cta_band': True,
                'doctors': True, 'reviews': True, 'brands': True,
                'recognitions': True,
            }
            config.translations = config.translations or {}
            config.published_languages = config.published_languages or ['en']
            config.published_at = config.published_at or utcnow()
            db.session.commit()
            print(f'  [OK] LIVE config updated (id={config.id})')

            # ── 2. Replace modules + features ──────────────────────────
            old_mod_ids = [
                m.id for m in LandingModule.query.filter_by(
                    tenant_id=tenant.id, landing_config_id=config.id).all()
            ]
            if old_mod_ids:
                LandingFeature.query.filter(
                    LandingFeature.tenant_id == tenant.id,
                    LandingFeature.module_id.in_(old_mod_ids),
                ).delete(synchronize_session=False)
            LandingModule.query.filter_by(
                tenant_id=tenant.id, landing_config_id=config.id,
            ).delete(synchronize_session=False)
            db.session.flush()

            n_feat = 0
            for order, (slug, name, icon, desc, feats) in enumerate(MODULES, start=1):
                module = LandingModule(
                    tenant_id=tenant.id, landing_config_id=config.id,
                    slug=slug, name=name, icon_key=icon, description=desc,
                    display_order=order, is_visible=True,
                    faq_json=[
                        {'question': f'What is {name}?',
                         'answer': f'{name} covers all sub-services listed on this page.'},
                        {'question': f'How much does {name} cost?',
                         'answer': 'Pricing starts at the amount shown on each feature.'},
                    ],
                    sections_enabled_json={'hero': True, 'features_grid': True, 'faq': True},
                )
                db.session.add(module)
                db.session.flush()
                for fidx, (ftitle, fdesc) in enumerate(feats, start=1):
                    db.session.add(LandingFeature(
                        tenant_id=tenant.id, module_id=module.id,
                        **_feature_payload(slug, fidx, ftitle, fdesc),
                    ))
                    n_feat += 1
            db.session.commit()
            print(f'  [OK] {len(MODULES)} modules + {n_feat} features seeded')

            # ── 3. Standalone carousels (replace all for this tenant) ──
            for Model in (LandingRecognition, LandingVideo, LandingDoctor,
                          LandingReview, LandingTrustedBrand):
                Model.query.filter_by(tenant_id=tenant.id).delete(synchronize_session=False)
            db.session.flush()

            for i, (title, subtitle, desc) in enumerate(RECOGNITIONS):
                db.session.add(LandingRecognition(
                    tenant_id=tenant.id, title=title, subtitle=subtitle,
                    description=desc, display_order=i, is_visible=True))
            for i, (title, desc, url, cat) in enumerate(VIDEOS):
                db.session.add(LandingVideo(
                    tenant_id=tenant.id, title=title, description=desc,
                    video_url=url, category=cat, display_order=i, is_visible=True))
            for i, (name, role, quals, bio) in enumerate(EXPERTS):
                db.session.add(LandingDoctor(
                    tenant_id=tenant.id, name=name, specialty=role,
                    qualifications=quals, bio=bio, display_order=i, is_visible=True))
            for i, (name, role, rating, content) in enumerate(REVIEWS):
                db.session.add(LandingReview(
                    tenant_id=tenant.id, reviewer_name=name, reviewer_role=role,
                    rating=rating, content=content, display_order=i, is_visible=True))
            for i, (name, link) in enumerate(BRANDS):
                db.session.add(LandingTrustedBrand(
                    tenant_id=tenant.id, name=name, link_url=link,
                    display_order=i, is_visible=True))
            db.session.commit()

            print('  [OK] carousels seeded:')
            print(f'       recognitions : {LandingRecognition.query.filter_by(tenant_id=tenant.id).count()}')
            print(f'       videos       : {LandingVideo.query.filter_by(tenant_id=tenant.id).count()}')
            print(f'       experts      : {LandingDoctor.query.filter_by(tenant_id=tenant.id).count()}')
            print(f'       reviews      : {LandingReview.query.filter_by(tenant_id=tenant.id).count()}')
            print(f'       brands       : {LandingTrustedBrand.query.filter_by(tenant_id=tenant.id).count()}')

        print('=' * 64)
        print(' Done. Open the tenant’s landing page to see the dummy content.')
        print('=' * 64)
        return 0


if __name__ == '__main__':
    sys.exit(main())