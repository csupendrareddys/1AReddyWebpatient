/**
 * usePatientCheckout — settle one booking, whoever is driving the screen.
 *
 * The three booking flows (consultation, marketplace service/product, health
 * plan) all end the same way: a row exists in the DB, unpaid, and something
 * has to settle it. Who is at the keyboard decides what that something is:
 *
 *   * **the patient** — the real Razorpay checkout, unchanged;
 *   * **a super-admin in Operations** — an offline settlement recorded through
 *     ``/admin/operations/patients/<id>/settle-payment``, because an admin
 *     cannot complete someone else's card payment and no proxy should let
 *     them try. They either leave the booking unpaid (the patient pays from
 *     their own app) or record that it was already paid at the counter — the
 *     choice lives on {@link usePatientScope} so one control governs all three
 *     flows.
 *
 * Call it with exactly one target:
 *
 *     const { checkout, isOps } = usePatientCheckout();
 *     await checkout({ appointmentId, description: 'Consultation with …' });
 *     await checkout({ orderId, description: product.name });
 *     await checkout({ bookingInstallmentId, description: plan.name });
 *
 * Resolves on success and throws on failure — same contract in both modes, so
 * a caller's try/catch doesn't have to know which one ran. The amount is
 * always read server-side from the row being settled; nothing here can name a
 * price.
 */
import { useCallback } from 'react';

import { usePatientScope } from '../ProfileSetting/context/PatientScopeContext';
import {
    useCreatePaymentOrderMutation,
    useVerifyPaymentMutation,
} from './patientEndpoints';
import { useSettleOpsPaymentMutation } from
    '../../admin/Operations/api/operationsEndpoints';
import { runRazorpayCheckout } from '../../../utils/runRazorpayCheckout';

/** Booking target → (ops settle `kind`, Razorpay create-order body). */
const targetOf = ({ appointmentId, orderId, bookingInstallmentId }) => {
    if (appointmentId) {
        return { kind: 'appointment', id: appointmentId,
            createOrderArgs: { appointment_id: appointmentId } };
    }
    if (orderId) {
        return { kind: 'order', id: orderId,
            createOrderArgs: { order_id: orderId } };
    }
    if (bookingInstallmentId) {
        return { kind: 'booking_installment', id: bookingInstallmentId,
            createOrderArgs: { booking_installment_id: bookingInstallmentId } };
    }
    return null;
};

export default function usePatientCheckout() {
    const { patientId, isOps, markAsPaid, scopeKind } = usePatientScope();
    const [createPaymentOrder] = useCreatePaymentOrderMutation();
    const [verifyPayment] = useVerifyPaymentMutation();
    const [settleOpsPayment] = useSettleOpsPaymentMutation();

    const checkout = useCallback(async ({ description, payNow = false, ...ids }) => {
        const target = targetOf(ids);
        if (!target) {
            throw new Error(
                'checkout() needs one of appointmentId / orderId / bookingInstallmentId.',
            );
        }
        if (isOps) {
            return settleOpsPayment({
                patientId, kind: target.kind, id: target.id, markAsPaid,
            }).unwrap();
        }
        // A support-staff CAREGIVER ('staff' scope) defers to the patient UNLESS
        // they were granted ``can_pay_on_behalf`` and chose to pay now — in which
        // case they settle it from their OWN gateway session (the same unscoped
        // /api/payment/* endpoints, which the backend now authorizes for a
        // can-pay caregiver). Without that, the booking waits for the patient and
        // the 20-minute reservation timer runs in their account.
        if (scopeKind === 'staff' && !payNow) {
            return { deferred: true };
        }
        return runRazorpayCheckout({
            createOrder: createPaymentOrder,
            verify: verifyPayment,
            createOrderArgs: target.createOrderArgs,
            description: description || 'Booking payment',
        });
    }, [isOps, scopeKind, patientId, markAsPaid, settleOpsPayment,
        createPaymentOrder, verifyPayment]);

    return {
        checkout,
        isOps,
        markAsPaid,
        /** What the confirm button should promise the operator it will do. */
        settlementLabel: !isOps
            ? null
            : (markAsPaid ? 'Record as paid (offline)' : 'Book, leave unpaid'),
    };
}
