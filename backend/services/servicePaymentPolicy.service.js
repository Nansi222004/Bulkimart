import { validateRazorpayConfig } from './razorpay.service.js';
import { fail } from './serviceForms.service.js';

export function requireServiceGateway() {
  const production = ['NODE_ENV', 'DEPLOYMENT_ENV', 'APP_ENV', 'VERCEL_ENV', 'RENDER_ENV'].some(key =>
    ['production', 'prod', 'deployment-production'].includes(String(process.env[key] || '').trim().toLowerCase()));
  if (process.env.PAYMENT_GATEWAY !== 'razorpay' || process.env.RAZORPAY_MODE !== (production ? 'live' : 'test')) {
    fail('Service payments require Razorpay live mode in production and test mode locally', 503);
  }
  try { validateRazorpayConfig(); } catch { fail('Service payment gateway is not configured. Contact support.', 503); }
}
