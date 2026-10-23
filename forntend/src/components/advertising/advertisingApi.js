import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
export async function advertisingApi(admin, path, options = {}) {
  const key = admin ? 'adminToken' : 'sellerToken', token = localStorage.getItem(key);
  if (!token) throw Error('Sign in to continue');
  const response = await boundedFetch(apiUrl(`/api/${admin ? 'admin' : 'sellers'}/advertising${path}`), {
    ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (token !== localStorage.getItem(key)) throw Error('Session changed. Reopen Advertising.');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.message || 'Advertising is unavailable. Retry when connected.');
  return body;
}
export const advertisingMoney = paise => Number.isSafeInteger(paise) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100) : 'Not configured';
export const campaignLabel = row => {
  if (!row) return 'UNKNOWN';
  if (row.delivery && row.delivery !== 'NOT_SCHEDULED') return String(row.delivery).replaceAll('_', ' ');
  if (row.review === 'APPROVED') return 'APPROVED AWAITING PAYMENT';
  if (row.review) return String(row.review).replaceAll('_', ' ');
  return 'DRAFT';
};
export function packagePayload(form) {
  const { attribution: previousAttribution, ...policies } = form.policies;
  const attribution = form.windowHours ? { windowHours: Number(form.windowHours), conversionEvent: form.conversionEvent, model: form.model } : undefined;
  return { name: form.name, description: form.description, module: form.module, placement: 'CATEGORY_SPONSORED',
    amountPaise: Math.round(Number(form.price) * 100), durationDays: Number(form.durationDays), maxProducts: Number(form.maxProducts),
    categories: form.categories.split(',').map(s => s.trim()).filter(Boolean), isActive: form.isActive, archived: form.archived,
    version: form.version, reason: form.reason,
    policies: { ...policies, ...(attribution ? { attribution } : {}) } };
}
