// Razorpay checkout with the official native SDK, same as the user app (mobile-user/src/lib/razorpay.js).
// The gateway result is never proof of payment: it is sent to the backend's verify endpoint, which checks the
// signature and fetches the payment from Razorpay before marking anything paid.
import RazorpayCheckout from 'react-native-razorpay';
import { api } from './apiClient';

const VERIFY_PATHS = ['/api/sellers/shiprocket-fees/verify'];

let opening = false;

/** Opens checkout for a server-issued Razorpay order and verifies the result. Returns { ok, cancelled?, message? }. */
export async function openRazorpayCheckout(checkout) {
  if (!checkout?.keyId || !checkout?.razorpayOrderId) return { ok: false, message: 'Payment details are missing. Refresh and try again.' };
  if (!VERIFY_PATHS.includes(checkout.verificationPath)) return { ok: false, message: 'Unsupported payment. Refresh and try again.' };
  if (opening) return { ok: false, message: 'A payment window is already open.' };
  opening = true;
  let result;
  try {
    result = await RazorpayCheckout.open({
      key: checkout.keyId,
      order_id: checkout.razorpayOrderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      retry: { enabled: false },
      theme: { color: '#08B9E8' },
    });
  } catch (error) {
    const description = String(error?.description || error?.error?.description || '');
    // Android SDK: code 0 = the seller closed the payment sheet.
    if (error?.code === 0 || /cancel/i.test(description)) return { ok: false, cancelled: true, message: 'Payment cancelled' };
    let message = description;
    try { message = JSON.parse(description)?.error?.description || description; } catch { /* plain text */ }
    return { ok: false, message: message || 'Payment failed' };
  } finally {
    opening = false;
  }
  try {
    const body = await api.post(checkout.verificationPath, {
      orderId: checkout.orderId,
      razorpay_payment_id: result?.razorpay_payment_id,
      razorpay_order_id: result?.razorpay_order_id,
      razorpay_signature: result?.razorpay_signature,
    }, { timeout: 30000 });
    if (body?.data?.status !== 'paid') return { ok: false, message: body?.message || 'Payment has not been confirmed yet. Check status before retrying.' };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || 'Could not verify the payment. Check status before retrying.' };
  }
}
