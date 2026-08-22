"""Marshmallow schemas for landing-config inputs (v2 — 3-level hierarchy).

All POST/PUT bodies are validated with these. Failures return a 422 via
:func:`app.common.responses.validation_error_response`.
"""
from marshmallow import Schema, fields, validate, validates_schema, ValidationError


_HEX_COLOR = validate.Regexp(r'^#[0-9a-fA-F]{3,8}$', error='Must be a hex color like #1976d2')
_SLUG_RE = validate.Regexp(
    # Lowercase letters, digits, dashes, and underscores. Must start with an
    # alphanumeric character (URL safety — slugs become part of /service/:slug
    # and /module/:slug paths). Length 2-119.
    r'^[a-z0-9][a-z0-9_-]{1,118}$',
    error='Lowercase letters, digits, dashes, and underscores only',
)


class HeroDraftSchema(Schema):
    """PUT ``/admin/landing/draft`` body — hero + theme + translations only.

    Modules are not edited through this endpoint; they have their own routes.
    """
    hero_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    hero_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    hero_cta_label = fields.Str(validate=validate.Length(max=100), allow_none=True)
    hero_cta_href = fields.Str(validate=validate.Length(max=500), allow_none=True)
    hero_image_asset_id = fields.UUID(allow_none=True)

    # How deep the public top-nav dropdown goes — see
    # ``LandingConfig.nav_hierarchy``. Constrained rather than free text: the
    # public nav switches on the exact string, so a typo would silently land
    # a tenant on the fallback branch with nothing to say why.
    nav_hierarchy = fields.Str(
        validate=validate.OneOf(['two_level', 'three_level']),
        allow_none=True,
    )

    theme_preset = fields.Str(
        validate=validate.OneOf(
            ['ocean', 'emerald', 'royal', 'sunset', 'midnight', 'custom']
        ),
        allow_none=True,
    )
    primary_color = fields.Str(validate=_HEX_COLOR, allow_none=True)
    secondary_color = fields.Str(validate=_HEX_COLOR, allow_none=True)
    accent_color = fields.Str(validate=_HEX_COLOR, allow_none=True)
    background_color = fields.Str(validate=_HEX_COLOR, allow_none=True)
    hero_style = fields.Str(
        validate=validate.OneOf(['gradient', 'solid', 'pattern']),
        allow_none=True,
    )

    marketing_tagline = fields.Str(validate=validate.Length(max=500), allow_none=True)
    footer_text = fields.Str(allow_none=True)
    meta = fields.Dict(allow_none=True)
    translations = fields.Dict(allow_none=True)
    published_languages = fields.List(fields.Str(validate=validate.Length(min=2, max=8)), allow_none=True)

    # Brand + contact + trust-badge + CTA band — every visible line on
    # the public landing surface that used to be hardcoded.
    brand_name = fields.Str(validate=validate.Length(max=120), allow_none=True)
    brand_logo_url = fields.Str(validate=validate.Length(max=500), allow_none=True)
    brand_sub_tagline = fields.Str(validate=validate.Length(max=200), allow_none=True)
    support_email = fields.Str(validate=validate.Length(max=254), allow_none=True)
    trust_badge_text = fields.Str(validate=validate.Length(max=200), allow_none=True)
    hero_body_text = fields.Str(allow_none=True)
    hero_search_placeholder = fields.Str(
        validate=validate.Length(max=200), allow_none=True,
    )
    cta_band_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    cta_band_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    cta_band_label = fields.Str(validate=validate.Length(max=120), allow_none=True)
    cta_band_href = fields.Str(validate=validate.Length(max=500), allow_none=True)

    # Section headings — admin-editable with frontend fallbacks. Empty
    # string is treated like null at the rendering layer (falls back
    # to the historical default copy).
    why_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    why_section_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    testimonials_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    testimonials_section_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)

    # Repeating-row JSON. Round-1 shape validation is intentionally
    # loose (just "must be a list") — the frontend renders defensively
    # and skips rows missing required keys, so a row-editor UI can land
    # later without a schema migration. Required shapes (documented in
    # the model docstring):
    #   * stats           — [{value, label}, …]
    #   * testimonials    — [{quote, name, role}, …]
    #   * hero_partners   — [{name}, {name, logo_url}, …]
    #   * why_features    — [{title, description}, …]
    #   * faqs            — [{question, answer}, …]
    stats = fields.List(fields.Dict(), allow_none=True)
    testimonials = fields.List(fields.Dict(), allow_none=True)
    hero_partners = fields.List(fields.Dict(), allow_none=True)
    why_features = fields.List(fields.Dict(), allow_none=True)
    faqs = fields.List(fields.Dict(), allow_none=True)

    # Section-visibility map. Free-form dict keyed by section slug →
    # bool. Frontend treats missing keys as ``true`` (visible) so the
    # default state of every new tenant is "everything on".
    section_visibility = fields.Dict(allow_none=True)

    # "Popular Services" / "Browse by Category" / "Ready to start?" /
    # "Frequently Asked Questions" — remaining hardcoded copy blocks
    # that the user wanted admin-editable. Same shape as the other
    # section-title pairs above.
    services_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    services_section_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    categories_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    categories_section_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    ready_cta_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    ready_cta_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)
    ready_cta_label = fields.Str(validate=validate.Length(max=120), allow_none=True)
    ready_cta_href = fields.Str(validate=validate.Length(max=500), allow_none=True)
    faq_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    faq_section_subtitle = fields.Str(validate=validate.Length(max=500), allow_none=True)

    # Editable section titles for the doctors / reviews / brands strips
    # rendered above the public footer.
    doctors_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    reviews_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)
    brands_section_title = fields.Str(validate=validate.Length(max=200), allow_none=True)


class ModuleCreateSchema(Schema):
    slug = fields.Str(required=True, validate=_SLUG_RE)
    name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    icon_key = fields.Str(validate=validate.Length(max=100), allow_none=True)
    description = fields.Str(allow_none=True)
    logo_asset_id = fields.UUID(allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)
    is_additional = fields.Bool(load_default=False)
    show_in_slider = fields.Bool(load_default=False)
    faq_json = fields.List(fields.Dict(), load_default=list)
    vid_json = fields.Dict(allow_none=True)
    img_json = fields.Dict(allow_none=True)
    sections_enabled_json = fields.Dict(allow_none=True)
    translations = fields.Dict(allow_none=True)


class ModuleUpdateSchema(ModuleCreateSchema):
    # Slug is immutable after create; name optional for partial updates.
    slug = fields.Str(validate=_SLUG_RE)
    name = fields.Str(validate=validate.Length(min=1, max=200))


class ProcessStepSchema(Schema):
    title = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    desc = fields.Str(validate=validate.Length(max=500), allow_none=True)


class CareTeamDoctorSchema(Schema):
    """One entry in a feature's "Our care team" strip.

    A row pins EITHER a single ``doctor_id`` OR a whole ``team_id`` (group
    offerings are delivered by a team). Every field toggle defaults to off, so a
    freshly added doctor shows just their name until the admin turns fields on;
    the toggles are ignored for team rows.
    """
    doctor_id = fields.UUID(required=False, allow_none=True)
    team_id = fields.UUID(required=False, allow_none=True)
    photo = fields.Bool(load_default=False)
    experience = fields.Bool(load_default=False)
    languages = fields.Bool(load_default=False)
    location = fields.Bool(load_default=False)
    work_qualification = fields.Bool(load_default=False)
    description = fields.Str(allow_none=True)
    display_order = fields.Int(load_default=0)
    # ``team_members`` is a display-only echo from the client; ignore extras
    # rather than reject them.
    team_members = fields.Raw(required=False, allow_none=True)

    @validates_schema
    def _one_of_doctor_or_team(self, data, **kwargs):
        if not data.get('doctor_id') and not data.get('team_id'):
            raise ValidationError('Each care-team row needs a doctor_id or team_id.')


class FeatureCreateSchema(Schema):
    slug = fields.Str(required=True, validate=_SLUG_RE)
    title = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    description = fields.Str(allow_none=True)
    # Which group this feature sits in under its module — the middle level of
    # the public nav. Free-form label; the editor suggests the ones already in
    # use on sibling features so the same group isn't spelled two ways.
    category = fields.Str(validate=validate.Length(max=120), allow_none=True)
    logo_asset_id = fields.UUID(allow_none=True)
    starting_price = fields.Str(validate=validate.Length(max=50), allow_none=True)
    timeline = fields.Str(validate=validate.Length(max=100), allow_none=True)
    rating = fields.Str(validate=validate.Length(max=20), allow_none=True)
    what_is = fields.Str(allow_none=True)
    requirements = fields.List(fields.Str(), load_default=list)
    documents = fields.List(fields.Str(), load_default=list)
    benefits = fields.List(fields.Str(), load_default=list)
    disadvantages = fields.List(fields.Str(), load_default=list)
    process = fields.List(fields.Nested(ProcessStepSchema), load_default=list)
    # "Who Should Join the Program" / "What's Included" / "Expected Outcome"
    # cards — same {title, desc} shape as ``process``, so they all reuse
    # ProcessStepSchema.
    who_should_join = fields.List(fields.Nested(ProcessStepSchema), load_default=list)
    whats_included = fields.List(fields.Nested(ProcessStepSchema), load_default=list)
    expected_outcomes = fields.List(fields.Nested(ProcessStepSchema), load_default=list)
    book_cta_label = fields.Str(validate=validate.Length(max=100), allow_none=True)
    # The bookable product (DoctorProduct) this feature's "Book Now" links to.
    product_id = fields.UUID(allow_none=True)
    sections_enabled_json = fields.Dict(allow_none=True)
    # Image / video galleries — same ``{ images: [...] }`` / ``{ videos: [...] }``
    # shape as modules (see ModuleCreateSchema). Without these the feature
    # editor's galleries would be silently dropped on save.
    vid_json = fields.Dict(allow_none=True)
    img_json = fields.Dict(allow_none=True)
    translations = fields.Dict(allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)
    show_in_slider = fields.Bool(load_default=False)
    # Deliberately NO load_default: the list is a full replacement of the
    # feature's care team, so an omitted key must mean "leave it alone" on
    # PUT rather than "clear it".
    care_team = fields.List(fields.Nested(CareTeamDoctorSchema))
    vid_json=fields.Dict(allow_none=True)
    img_json=fields.Dict(allow_none=True)
    faq_json=fields.Dict(allow_none=True)
    # Back-office product/provider linking (not a public section). Same
    # full-replacement semantics as ``care_team`` — NO load_default, so an
    # omitted key leaves the stored links untouched on PUT.
    product_links_json = fields.List(fields.Dict(), allow_none=True)


class FeatureUpdateSchema(FeatureCreateSchema):
    slug = fields.Str(validate=_SLUG_RE)
    title = fields.Str(validate=validate.Length(min=1, max=200))


class ReorderItemSchema(Schema):
    id = fields.UUID(required=True)
    display_order = fields.Int(required=True)


class ReorderSchema(Schema):
    items = fields.List(fields.Nested(ReorderItemSchema), required=True)


# --------------------------------------------------------------------------- #
# Recognitions / accreditation carousel
# --------------------------------------------------------------------------- #

class RecognitionCreateSchema(Schema):
    title = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    subtitle = fields.Str(validate=validate.Length(max=300), allow_none=True)
    description = fields.Str(allow_none=True)
    logo_asset_id = fields.UUID(allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)


class RecognitionUpdateSchema(RecognitionCreateSchema):
    # Title becomes optional for partial PUT.
    title = fields.Str(validate=validate.Length(min=1, max=200))


# --------------------------------------------------------------------------- #
# Videos / gallery
# --------------------------------------------------------------------------- #

# Tolerant URL check — accepts http(s) URLs only. We don't validate that the
# host is YouTube / Vimeo / etc. so admins can paste any direct mp4 link.
_HTTP_URL = validate.Regexp(
    r'^https?://[^\s]+$',
    error='Must be a full URL starting with http:// or https://',
)


class VideoCreateSchema(Schema):
    title = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    description = fields.Str(allow_none=True)
    video_url = fields.Str(validate=_HTTP_URL, allow_none=True)
    video_asset_id = fields.UUID(allow_none=True)
    thumbnail_asset_id = fields.UUID(allow_none=True)
    category = fields.Str(validate=validate.Length(max=120), allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)


class VideoUpdateSchema(VideoCreateSchema):
    title = fields.Str(validate=validate.Length(min=1, max=200))


# --------------------------------------------------------------------------- #
# Doctors — "Meet our doctors" carousel
# --------------------------------------------------------------------------- #

class DoctorCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    specialty = fields.Str(validate=validate.Length(max=200), allow_none=True)
    qualifications = fields.Str(validate=validate.Length(max=300), allow_none=True)
    bio = fields.Str(allow_none=True)
    photo_asset_id = fields.UUID(allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)


class DoctorUpdateSchema(DoctorCreateSchema):
    name = fields.Str(validate=validate.Length(min=1, max=200))


# --------------------------------------------------------------------------- #
# Reviews — "What our clients say" Play-Store-style cards
# --------------------------------------------------------------------------- #

class ReviewCreateSchema(Schema):
    reviewer_name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    reviewer_role = fields.Str(validate=validate.Length(max=200), allow_none=True)
    # 1–5 inclusive when set; null means "no star rating shown".
    rating = fields.Int(validate=validate.Range(min=1, max=5), allow_none=True)
    content = fields.Str(required=True, validate=validate.Length(min=1))
    avatar_asset_id = fields.UUID(allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)


class ReviewUpdateSchema(ReviewCreateSchema):
    reviewer_name = fields.Str(validate=validate.Length(min=1, max=200))
    content = fields.Str(validate=validate.Length(min=1))


# --------------------------------------------------------------------------- #
# Trusted Brands — logo carousel above the footer
# --------------------------------------------------------------------------- #

class TrustedBrandCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=200))
    logo_asset_id = fields.UUID(allow_none=True)
    link_url = fields.Str(validate=_HTTP_URL, allow_none=True)
    display_order = fields.Int(load_default=0)
    is_visible = fields.Bool(load_default=True)


class TrustedBrandUpdateSchema(TrustedBrandCreateSchema):
    name = fields.Str(validate=validate.Length(min=1, max=200))
