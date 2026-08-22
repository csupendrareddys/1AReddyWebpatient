/**
 * Usage-cap label helpers — turn the backend's ``-1 / 0 / int`` sentinels
 * into the friendly text the UI shows.
 *
 * Backend convention (kept in commits / API):
 *   -1  → unlimited
 *    0  → disabled
 *   >0  → cap value
 */

const METRIC_UNITS = {
    video_minutes: 'minutes',
    audio_minutes: 'minutes',
    video_calls:   'calls',
    audio_calls:   'calls',
    chat_messages: 'messages',
    sms_sends:     'SMS',
    email_sends:   'emails',
};


const METRIC_DISPLAY_NAMES = {
    video_minutes: 'Video minutes',
    audio_minutes: 'Audio minutes',
    video_calls:   'Video calls',
    audio_calls:   'Audio calls',
    chat_messages: 'Chat messages',
    sms_sends:     'SMS sends',
    email_sends:   'Email sends',
};


const WINDOW_LABELS = {
    monthly: 'per month',
    daily:   'per day',
    rolling: 'per window',
};


/** Format a single (metric, window, value) triple into UI text. */
export const formatUsageLimit = (metric, window, value) => {
    if (value === undefined || value === null) return null;
    if (value === -1) return 'Unlimited';
    if (value === 0) return 'Disabled';
    const unit = METRIC_UNITS[metric] || '';
    const win = WINDOW_LABELS[window] || '';
    return `${value.toLocaleString()} ${unit} ${win}`.trim();
};


/** Display name for a metric — for table headers, tooltips, etc. */
export const formatMetricName = (metric) =>
    METRIC_DISPLAY_NAMES[metric] || metric.replace(/_/g, ' ');


/**
 * Walk a plan's ``usage_limits`` block and return one row per
 * (metric, window) pair the platform owner has configured. Skips
 * empty windows so the UI doesn't render blanks.
 */
export const flattenUsageLimits = (usageLimits) => {
    const rows = [];
    if (!usageLimits || typeof usageLimits !== 'object') return rows;
    for (const [metric, windows] of Object.entries(usageLimits)) {
        if (!windows || typeof windows !== 'object') continue;
        for (const [window, value] of Object.entries(windows)) {
            // rolling has paired keys; surface as one row using rolling_limit + rolling_days.
            if (window === 'rolling_days' || window === 'rolling_limit') continue;
            const formatted = formatUsageLimit(metric, window, value);
            if (formatted === null) continue;
            rows.push({ metric, window, value, formatted });
        }
        // Add the rolling row if both keys present.
        if (Number.isInteger(windows.rolling_days) && Number.isInteger(windows.rolling_limit)) {
            const v = windows.rolling_limit;
            const formatted = v === -1
                ? 'Unlimited'
                : v === 0
                    ? 'Disabled'
                    : `${v.toLocaleString()} ${METRIC_UNITS[metric] || ''} per ${windows.rolling_days} day(s)`;
            rows.push({
                metric,
                window: 'rolling',
                value: v,
                rollingDays: windows.rolling_days,
                formatted,
            });
        }
    }
    return rows;
};


/** Short summary string for the pricing card — "1,000 video min/mo · 60/day". */
export const summariseMetric = (metric, windows) => {
    if (!windows || typeof windows !== 'object') return null;
    const parts = [];
    const monthly = formatUsageLimit(metric, 'monthly', windows.monthly);
    const daily = formatUsageLimit(metric, 'daily', windows.daily);
    if (monthly) parts.push(monthly);
    if (daily) parts.push(daily);
    if (Number.isInteger(windows.rolling_days) && Number.isInteger(windows.rolling_limit)) {
        const formatted = formatUsageLimit(metric, 'rolling', windows.rolling_limit);
        if (formatted) parts.push(`${formatted.replace('per window', `per ${windows.rolling_days}d`)}`);
    }
    return parts.length ? parts.join(' · ') : null;
};
