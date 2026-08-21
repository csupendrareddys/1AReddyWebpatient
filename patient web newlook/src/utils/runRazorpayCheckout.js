/**
 * Run a Razorpay checkout end-to-end for a marketplace order (service /
 * group-service). Mirrors the appointment checkout in BookAppointment, but
 * keyed on ``order_id`` instead of ``appointment_id``.
 *
 *   createOrder / verify : the RTK-Query mutation triggers
 *                          (useCreatePaymentOrderMutation / useVerifyPaymentMutation)
 *   orderId              : the MarketplaceOrder id to pay for
 *
 * Resolves with the verify response on success. Rejects on SDK-load failure,
 * gateway failure, or user cancel — the caller surfaces the message.
 */
import { loadRazorpayScript } from './loadRazorpayScript';

export async function runRazorpayCheckout({
    createOrder,
    verify,
    orderId,
    // Alternative payment targets — pass exactly one. When set, it overrides
    // orderId in the create-order body (e.g. a Group Offering plan installment).
    createOrderArgs,
    name = 'Healthcare Portal',
    description = 'Service payment',
    prefill = {},
}) {
    // Step 1: create the Razorpay order on the backend (amount read from DB).
    const res = await createOrder(createOrderArgs || { order_id: orderId }).unwrap();
    const data = res?.data || res;
    const { razorpay_order_id, amount, key_id, payment_id } = data;

    // The backend returns the patient's stored { name, email, contact } so the
    // checkout never re-asks for the phone. Caller-supplied prefill wins; the
    // backend only fills gaps (drop empty strings so they don't shadow it).
    const nonEmpty = (obj) => Object.fromEntries(
        Object.entries(obj || {}).filter(([, v]) => v)
    );
    const mergedPrefill = { ...nonEmpty(data?.prefill), ...nonEmpty(prefill) };

    // Step 2: inject the checkout SDK on demand.
    const ok = await loadRazorpayScript();
    if (!ok || !window.Razorpay) {
        throw new Error('Razorpay SDK failed to load. Check your internet connection and try again.');
    }

    // Step 3: open the popup, verify on success.
    return new Promise((resolve, reject) => {
        const rzp = new window.Razorpay({
            key: key_id,
            amount,
            currency: 'INR',
            name,
            description,
            order_id: razorpay_order_id,
            handler: async (response) => {
                try {
                    const verified = await verify({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature,
                        payment_id,
                    }).unwrap();
                    resolve(verified);
                } catch (verifyErr) {
                    reject(verifyErr);
                }
            },
            prefill: mergedPrefill,
            theme: { color: '#2563eb' },
            modal: {
                ondismiss: () => reject(new Error('Payment cancelled.')),
            },
        });

        rzp.on('payment.failed', (response) => {
            const e = response?.error || {};
            try { rzp.close(); } catch { /* SDK is forgiving */ }
            reject(new Error(
                e.description ? `Payment failed: ${e.description}` : 'Payment failed at Razorpay.'
            ));
        });

        rzp.open();
    });
}

export default runRazorpayCheckout;
