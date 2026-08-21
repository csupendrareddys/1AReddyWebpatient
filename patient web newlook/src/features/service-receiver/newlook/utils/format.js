/** Money + date formatting shared by the new-look screens. */

/** ₹ with Indian digit grouping, as the mobile MVP's ``inr`` helper. */
export const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

/** "Mon, 3 Sep 2025" — the same format the existing AppointmentCard uses. */
export const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    })
    : '');

/** "09:30" → "9:30 AM". */
export const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = String(t).split(':');
    const hour = parseInt(h, 10);
    if (Number.isNaN(hour)) return String(t);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}:${m ?? '00'} ${ampm}`;
};

/** "pending_payment" → "Pending payment". */
export const humanise = (s) => {
    const raw = String(s || '').replace(/_/g, ' ').trim();
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
};
