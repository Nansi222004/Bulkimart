// Razorpay checkout with the official native SDK (react-native-razorpay 3, new-architecture TurboModule).
// Replaces frontend/src/utils/razorpayCheckout.js (checkout.js in the browser). The contract is unchanged:
// the gateway result is never treated as proof of payment — it is sent to the backend's verify endpoint, which
// checks the signature and fetches the payment from Razorpay before marking anything paid.
import RazorpayCheckout from 'react-native-razorpay';
import { boundedFetch } from '../api/client';

const VERIFY_PATHS = [
  '/api/services/payments/verify', '/api/wallet/topup/verify', '/api/customer-services/payments/verify',
  '/api/parcel-delivery/payments/verify',
];

let opening = false;

export async function openRazorpayCheckout(checkout, requestHeaders) {
  if (opening) return { ok: false, message: 'A payment window is already open.' };
  opening = true;
  const options = {
    key: checkout.keyId,
    order_id: checkout.razorpayOrderId,
    amount: checkout.amountPaise,
    currency: checkout.currency,
    name: checkout.name,
    description: checkout.description,
    retry: { enabled: false },
    theme: { color: '#08B9E8' },
  };
  let result;
  try {
    result = await RazorpayCheckout.open(options);
  } catch (error) {
    opening = false;
    const description = String(error?.description || error?.error?.description || '');
    // Android SDK: code 0 = cancelled by the customer (dismissed the sheet / pressed back).
    if (error?.code === 0 || /cancel/i.test(description)) return { ok: false, cancelled: true, message: 'Payment cancelled' };
    let message = description;
    try { message = JSON.parse(description)?.error?.description || description; } catch { /* plain text */ }
    return { ok: false, message: message || 'Payment failed' };
  }
  opening = false;
  try {
    const path = VERIFY_PATHS.includes(checkout.verificationPath) ? checkout.verificationPath : '/api/payments/razorpay/verify';
    const response = await boundedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...requestHeaders },
      body: JSON.stringify({
        orderId: checkout.orderId,
        razorpay_payment_id: result?.razorpay_payment_id,
        razorpay_order_id: result?.razorpay_order_id,
        razorpay_signature: result?.razorpay_signature,
      }),
    }, 30000);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.data?.status !== 'paid') return { ok: false, message: body.message || 'Payment has not been confirmed' };
    return { ok: true, verified: true, status: body.data.status, ...(body.data.bookingStatus ? { bookingStatus: body.data.bookingStatus } : {}) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}
