import { apiUrl } from './api';

let checkoutScriptPromise;

const loadCheckoutScript = () => {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;
  checkoutScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Razorpay Checkout'));
    document.head.appendChild(script);
  });
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
    const instance = new window.Razorpay({
      key: checkout.keyId,
      order_id: checkout.razorpayOrderId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      handler: async (result) => {
        try {
          const response = await fetch(apiUrl('/api/payments/razorpay/verify'), {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify({ orderId: checkout.orderId, ...result }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.data?.status !== 'paid') {
            return resolve({ ok: false, message: body.message || 'Payment has not been confirmed' });
          }
          resolve({ ok: true, verified: true, status: body.data.status });
        } catch (error) {
          resolve({ ok: false, message: error.message });
        }
      },
      modal: {
        ondismiss: () => resolve({ ok: false, cancelled: true, message: 'Payment cancelled' }),
      },
      retry: { enabled: false },
      theme: { color: '#08B9E8' },
    });
    instance.on('payment.failed', (response) => {
      resolve({
        ok: false,
        message: response?.error?.description || 'Payment failed',
      });
    });
    instance.open();
  });
};

