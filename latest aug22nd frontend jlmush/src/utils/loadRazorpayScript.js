/**
 * Razorpay checkout SDK loader.
 *
 * The SDK script is injected on demand so admin / non-payment pages
 * don't pull ~1MB of Razorpay chunks on every page load. Resolves to
 * true once `window.Razorpay` is available (or already was), false
 * if the script tag failed to load.
 *
 * Usage:
 *     const ok = await loadRazorpayScript();
 *     if (!ok) { alert('Razorpay SDK failed to load.'); return; }
 *     const rzp = new window.Razorpay(options);
 *     rzp.open();
 */
export function loadRazorpayScript() {
    return new Promise((resolve) => {
        if (typeof window === 'undefined') return resolve(false);
        if (window.Razorpay) return resolve(true);

        const existing = document.querySelector(
            'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
        );
        if (existing) {
            existing.addEventListener('load', () => resolve(true), { once: true });
            existing.addEventListener('error', () => resolve(false), { once: true });
            return;
        }

        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
    });
}

export default loadRazorpayScript;
