import { apiUrl } from './api';
import { boundedFetch } from './portalRequests';

let checkoutScriptPromise;

const loadCheckoutScript = () => {
  if (typeof window.Razorpay === 'function') return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove?.(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Razorpay Checkout took too long to load. Check your connection and retry.')),15000);
    script.onload = () => finish(typeof window.Razorpay === 'function' ? null : new Error('Could not load Razorpay Checkout. Please retry.'));
    script.onerror = () => finish(new Error('Could not load Razorpay Checkout. Check your connection and retry.'));
    document.head.appendChild(script);
  }).finally(() => { checkoutScriptPromise = null; });
  return checkoutScriptPromise;
};

/**
 * Open Razorpay Checkout and send its signed result to the backend. The
 * browser response is never treated as proof of payment; the backend verifies
 * the signature and fetches the payment from Razorpay before settling it.
 */
export const openRazorpayCheckout = async (checkout, requestHeaders) => {
  await loadCheckoutScript();

  return new Promise((resolve) => {
    let settled = false, verifying = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      // Retry is disabled below. Close a terminal provider window before the
      // application switches to success/recovery; never restyle its iframe.
      try { instance.close?.(); } catch { /* The SDK may already have closed. */ }
      resolve(result);
    };
    const instance = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.razorpayOrderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      handler: async (result) => {
        if (settled || verifying) return;
        verifying = true;
        try {
          const response = await boundedFetch(apiUrl(['/api/services/payments/verify', '/api/wallet/topup/verify', '/api/sellers/gst-assistance/payments/verify', '/api/sellers/advertising/payment-verification', '/api/sellers/shiprocket-fees/verify', '/api/customer-services/payments/verify', '/api/parcel-delivery/payments/verify'].includes(checkout.verificationPath) ? checkout.verificationPath : '/api/payments/razorpay/verify'), {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify({ orderId: checkout.orderId, ...result }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.data?.status !== 'paid') {
            return finish({ ok: false, message: body.message || 'Payment has not been confirmed' });
          }
          finish({ ok: true, verified: true, status: body.data.status, ...(body.data.bookingStatus?{bookingStatus:body.data.bookingStatus}:{}) });
        } catch (error) {
          finish({ ok: false, message: error.message });
        }
      },
      modal: {
        // Captured payments must finish server verification even if SDK
        // dismissal races its handler. A UI dismissal cannot undo capture.
        ondismiss: () => { if (!verifying) finish({ ok: false, cancelled: true, message: 'Payment cancelled' }); },
      },
      retry: { enabled: false },
      theme: { color: '#08B9E8' },
    });
    instance.on('payment.failed', (response) => {
      if (verifying) return;
      finish({
        ok: false,
        message: response?.error?.description || 'Payment failed',
      });
    });
    instance.open();
  });
};

