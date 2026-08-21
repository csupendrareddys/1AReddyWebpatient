/**
 * Canonical list of toggleable landing-page section slugs + helper.
 *
 * The admin's Section Toggles panel renders one switch per entry here,
 * and the public landing page wraps each section in
 * ``isSectionVisible(landingData, '<slug>')`` so an admin can hide any
 * section without deleting its content.
 *
 * Adding a new section: append to ``LANDING_SECTIONS``, wrap the
 * rendering site with the helper, that's it — schema (free-form JSON
 * column) doesn't need a migration.
 */

export const LANDING_SECTIONS = [
    { key: 'hero_partners',  label: 'Hero — Partner Logos',
      description: 'The faded logo strip under the hero search bar.' },
    { key: 'recognitions',   label: 'Recognitions / Accreditations',
      description: 'Carousel of accreditation cards directly below the hero.' },
    { key: 'categories',     label: 'Browse by Category',
      description: 'Service-category tiles (also self-hides when no modules).' },
    { key: 'services',       label: 'Popular Services',
      description: 'Grid of featured service cards.' },
    { key: 'why_us',         label: 'Why-Us Panel',
      description: 'Two-column block: bullet panel + stats card + Ready CTA.' },
    { key: 'ready_cta',      label: 'Ready-To-Start Box',
      description: 'Mini-CTA inside the Why-Us stats panel.' },
    { key: 'videos',         label: 'Video Gallery Strip',
      description: 'Three-video strip with link to the dedicated gallery page.' },
    { key: 'join_network',   label: 'Join Our Network Band',
      description: 'Apex-only — funnels providers into the marketplace.' },
    { key: 'testimonials',   label: 'Testimonials Carousel',
      description: 'Quote cards (Patient stories).' },
    { key: 'faq',            label: 'FAQ Accordion',
      description: 'Frequently asked questions list.' },
    { key: 'cta_band',       label: 'For-Doctors CTA Band',
      description: '"Are you a doctor?" recruitment band.' },
    { key: 'booking',        label: 'Booking Widget',
      description: 'Public anonymous-booking section (also self-hides when no specializations).' },
    { key: 'doctors',        label: 'Meet Our Doctors',
      description: 'Carousel of doctor profile cards.' },
    { key: 'reviews',        label: 'Client Reviews',
      description: 'Play-Store-style review carousel.' },
    { key: 'brands',         label: 'Trusted by Global Brands',
      description: 'Continuous marquee of brand logos above the footer.' },
];


/**
 * Return ``true`` if section ``key`` is visible.
 *
 * Visibility rules:
 *   * ``section_visibility[key] === false`` → hidden (admin explicit off).
 *   * ``section_visibility[key] === true`` → visible.
 *   * key missing entirely → visible (default-on for un-configured tenants).
 *
 * Designed to be permissive: a typo'd slug or null landingData always
 * shows the section. This is the right default — content sections
 * have their own empty-state hiding (e.g. no doctors → DoctorsSection
 * returns null), so the visibility flag is a SECOND layer of hide on
 * top of the content layer.
 */
export function isSectionVisible(landingData, key) {
    const map = landingData?.section_visibility;
    if (!map || typeof map !== 'object') return true;
    return map[key] !== false;
}
