export const DEFAULT_LANDING_FIELDS = [{ key: 'primary_color',       label: 'Primary Color',       type: 'color',     default: '#1976d2' },
    { key: 'secondary_color',     label: 'Secondary Color',     type: 'color',     default: '#dc004e' },
    { key: 'accent_color',        label: 'Accent Color',        type: 'color',     default: '#26a69a' },
    { key: 'background_color',    label: 'Background Color',    type: 'color',     default: '#ffffff' },
    { key: 'hero_style',          label: 'Hero Style',          type: 'select',    options: ['gradient', 'solid', 'pattern'], default: 'gradient' },
    // How deep the top-nav dropdown goes. Three-level groups each module's
    // features by their Category (set per feature in the module editor);
    // two-level lists them flat and ignores categories. A module with no
    // categorised features renders flat under either setting — three-level
    // is the default because it costs nothing until categories exist.
    {
        key: 'nav_hierarchy',
        label: 'Navbar Hierarchy',
        type: 'select',
        default: 'three_level',
        options: [
            { value: 'three_level', label: '3 levels — Module → Category → Service' },
            { value: 'two_level', label: '2 levels — Module → Service' },
        ],
        helpText: 'Three levels groups each module\'s services by their Category in the top-nav '
            + 'dropdown, the module page and the mobile menu. Two levels lists them flat. '
            + 'Categories are set per service in the module editor; a module with none renders '
            + 'flat either way.',
    },
    { key: 'hero_title',          label: 'Hero Title',          type: 'text',      translatable: true },
    { key: 'hero_subtitle',       label: 'Hero Subtitle',       type: 'text',      translatable: true },
    { key: 'hero_cta_label',      label: 'CTA Label',           type: 'text',      translatable: true },
    { key: 'hero_cta_href',       label: 'CTA Link',            type: 'text' },
    { key: 'marketing_tagline',   label: 'Marketing Tagline',   type: 'text',      translatable: true },
    { key: 'footer_text',         label: 'Footer Text',         type: 'textarea',  translatable: true },
    // Brand + contact — replaces the hardcoded "JLMush Hospital" and
    // support email across navbar / footer / utility strip. Two-word
    // values get rendered with the first word in the brand colour and
    // the rest in muted text (matches the two-tone logo treatment).
    { key: 'brand_name',          label: 'Brand Name',          type: 'text',      placeholder: 'JLMush Hospital', translatable: true },
    // Logo image — file picker uploads to S3 via the admin upload
    // endpoint and writes the public URL into this field. Admin can
    // also paste a URL directly (the text input under the picker is
    // independently editable). Empty → no logo, brand text alone.
    { key: 'brand_logo_url',      label: 'Brand Logo',          type: 'logo_upload', placeholder: 'https://cdn.example.com/logo.png' },
    // Small one-liner BELOW the brand name in the navbar / footer.
    // Tenants typically use this for a clinic motto, e.g.
    // "Compassionate care since 1998". Empty → just the brand name.
    { key: 'brand_sub_tagline',   label: 'Brand Sub-Tagline',   type: 'text',      placeholder: 'Compassionate care since 1998', translatable: true },
    { key: 'support_email',       label: 'Support Email',       type: 'text',      placeholder: 'support@example.com' },
    // Hero-zone badge under the search bar. Empty → falls back to the
    // generic "Trusted by 10,000+ Patients" copy.
    { key: 'trust_badge_text',    label: 'Trust Badge Text',    type: 'text',      placeholder: 'Trusted by 10,000+ Patients', translatable: true },
    // Body copy under the hero title/subtitle and above the search bar.
    // Empty → historical "Book appointments, consult doctors online…"
    // fallback. Multi-line allowed.
    { key: 'hero_body_text',          label: 'Hero Body Text',          type: 'textarea', placeholder: 'Book appointments, consult doctors online, get prescriptions, order medicines — all in one place.', translatable: true },
    // Placeholder text shown inside the hero search box.
    { key: 'hero_search_placeholder', label: 'Hero Search Placeholder', type: 'text',     placeholder: "Search 'Video Consultation' or 'Lab Tests'...", translatable: true },
    // "Are you a doctor?" recruitment CTA band rendered above the
    // booking widget. Clearing the title HIDES the band entirely.
    // ``cta_band_href`` is a URL — internal route like ``/join/doctor``
    // or an external link the operator wants to advertise.
    // ``section`` ties multiple rows to one visibility toggle (the
    // toggle in the Display column flips ``section_visibility[<key>]``
    // for the whole section).
    { key: 'cta_band_title',      label: 'CTA Band Title',      type: 'text',      placeholder: 'Are you a doctor?', translatable: true, section: 'cta_band' },
    { key: 'cta_band_subtitle',   label: 'CTA Band Subtitle',   type: 'textarea',  placeholder: 'Join thousands of doctors on our network...', translatable: true, section: 'cta_band' },
    { key: 'cta_band_label',      label: 'CTA Band Button',     type: 'text',      placeholder: 'Join Our Network', translatable: true, section: 'cta_band' },
    { key: 'cta_band_href',       label: 'CTA Band Link',       type: 'text',      placeholder: '/join/doctor', section: 'cta_band' },
    // "Why <brand>?" features section. Empty title falls back to the
    // historical "Why <brand>?" template using ``brand_name``.
    { key: 'why_section_title',     label: 'Why-Us Section Title',    type: 'text',     placeholder: 'Why our brand?', translatable: true, section: 'why_us' },
    { key: 'why_section_subtitle',  label: 'Why-Us Section Subtitle', type: 'textarea', placeholder: 'We combine modern technology with compassionate care...', translatable: true, section: 'why_us' },
    // "What Our Patients Say" testimonials carousel.
    { key: 'testimonials_section_title',    label: 'Testimonials Section Title',    type: 'text',     placeholder: 'What Our Patients Say', translatable: true, section: 'testimonials' },
    { key: 'testimonials_section_subtitle', label: 'Testimonials Section Subtitle', type: 'textarea', placeholder: 'Hear from people who trust us with their health', translatable: true, section: 'testimonials' },
    // "Popular Services" services-grid heading.
    { key: 'services_section_title',        label: 'Services Section Title',        type: 'text',     placeholder: 'Popular Services', translatable: true, section: 'services' },
    { key: 'services_section_subtitle',     label: 'Services Section Subtitle',     type: 'textarea', placeholder: 'Everything you need to manage your health', translatable: true, section: 'services' },
    // "Browse by Category" module-tiles heading.
    { key: 'categories_section_title',      label: 'Categories Section Title',      type: 'text',     placeholder: 'Browse by Category', translatable: true, section: 'categories' },
    { key: 'categories_section_subtitle',   label: 'Categories Section Subtitle',   type: 'textarea', placeholder: 'Select a service category to get started', translatable: true, section: 'categories' },
    // "Ready to start?" mini-CTA inside the Why-us stats panel. Empty
    // title → entire box hides. ``ready_cta_href`` accepts an internal
    // route or an external URL (the click handler picks the right
    // navigation method).
    { key: 'ready_cta_title',               label: 'Ready CTA Title',               type: 'text',     placeholder: 'Ready to start?', translatable: true, section: 'ready_cta' },
    { key: 'ready_cta_subtitle',            label: 'Ready CTA Subtitle',            type: 'textarea', placeholder: 'Talk to a healthcare expert today.', translatable: true, section: 'ready_cta' },
    { key: 'ready_cta_label',               label: 'Ready CTA Button',              type: 'text',     placeholder: 'Book Consultation', translatable: true, section: 'ready_cta' },
    { key: 'ready_cta_href',                label: 'Ready CTA Link',                type: 'text',     placeholder: '/auth/service-receiver/login', section: 'ready_cta' },
    // FAQ section heading.
    { key: 'faq_section_title',             label: 'FAQ Section Title',             type: 'text',     placeholder: 'Frequently Asked Questions', translatable: true, section: 'faq' },
    { key: 'faq_section_subtitle',          label: 'FAQ Section Subtitle',          type: 'textarea', placeholder: 'Got questions? We have answers.', translatable: true, section: 'faq' },
    // Repeating-row JSON arrays. Round-1 editor surfaces them as raw
    // JSON textareas — admin pastes/edits the array directly. A row-
    // based editor lands in a follow-up. Examples shown in the
    // placeholder; frontend renders defensively and skips malformed
    // rows so a typo doesn't crash the live page.
    // Repeating-row fields. ``type: 'rows'`` triggers the friendly
    // row-based editor (RepeatableRowsField) — labeled TextField
    // inputs per key, add/remove/reorder buttons. Per-field row
    // schemas live in ``REPEATABLE_ROW_SCHEMAS``. Stored value is
    // still a plain JSON array so no schema change is needed.
    { key: 'stats',           label: 'Stats',                  type: 'rows',
      helpText: 'Big-number trust tiles shown inside the Why-Us stats panel.',
      section: 'why_us' },
    { key: 'testimonials',    label: 'Testimonials',           type: 'rows',
      helpText: 'Quote cards in the testimonials carousel.',
      section: 'testimonials' },
    { key: 'hero_partners',   label: 'Hero Partner Logos',     type: 'rows',
      helpText: 'Faded partner-logos band under the hero search. Logo URLs render as images; bare names render as text.',
      section: 'hero_partners' },
    { key: 'why_features',    label: 'Why-Us Bullets',         type: 'rows',
      helpText: 'The bullet panel beside the stats card (Certified Doctors / 24-7 / etc.).',
      section: 'why_us' },
    { key: 'faqs',            label: 'FAQs',                   type: 'rows',
      helpText: 'Frequently-asked questions accordion. Empty list hides the section.',
      section: 'faq' },
    // Section-title overrides for the three above-footer carousels.
    // Empty value → public side falls back to a sensible default
    // (see LandingPage rendering).
    { key: 'doctors_section_title',  label: 'Doctors Section Title',  type: 'text', placeholder: 'Meet Our Doctors', section: 'doctors' },
    { key: 'reviews_section_title',  label: 'Reviews Section Title',  type: 'text', placeholder: 'What Our Clients Say', section: 'reviews' },
    { key: 'brands_section_title',   label: 'Brands Section Title',   type: 'text', placeholder: 'Trusted by Global Brands', section: 'brands' },
];