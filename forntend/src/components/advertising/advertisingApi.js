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
// Plain words for the campaign's review, payment and ad states (unknown codes are shown as they are).
const PLAIN = {
  review: { DRAFT: 'Draft', PENDING_REVIEW: 'Waiting for review', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', REJECTED: 'Not approved' },
  funding: { UNPAID: 'Not paid', PAYMENT_PENDING: 'Payment in progress', FUNDED: 'Paid', PAYMENT_FAILED: 'Payment failed', REFUND_PENDING: 'Refund in progress',
    PARTIALLY_REFUNDED: 'Partly refunded', REFUNDED: 'Refunded', RECONCILIATION_REQUIRED: 'Payment needs checking' },
  delivery: { NOT_SCHEDULED: 'Not scheduled', SCHEDULED: 'Scheduled', ACTIVE: 'Live', SELLER_PAUSED: 'Paused by seller', UNAVAILABLE: 'Paused (products unavailable)',
    EXHAUSTED: 'Finished', COMPLETED: 'Finished', CANCELLED: 'Cancelled', ADMIN_SUSPENDED: 'Suspended by Bulkimart' },
};
export const plainStatus = (kind, value) => PLAIN[kind]?.[value] || String(value ?? '—').replaceAll('_', ' ').toLowerCase();
// The package form asks only for what an admin decides: name, storefront, categories, price, days,
// product limit and GST. Billing rules, refund limits, sales tracking and the seller-facing terms
// get standard values here; an edited package keeps any it already had.
export const GST_CHOICES = { EXCLUSIVE: 'GST added on top of the price', INCLUSIVE: 'Price already includes GST', NONE: 'No GST' };
const STANDARD_BILLING = { approvalReference: 'Standard advertising package', issuer: 'Bulkimart', taxRecognition: 'ON_RECEIPT',
  invoiceMode: 'NOT_REQUIRED', creditNoteMode: 'NOT_REQUIRED', startCondition: 'VERIFIED_PAYMENT_OR_REQUESTED_START',
  interruption: 'STOP_AND_REVIEW', recognition: 'MANUAL_AFTER_COMPLETION',
  refunds: { cancellationBps: 10000, suspensionBps: 10000, unavailableBps: 10000, unusedBps: 10000 } };
const STANDARD_TERMS = {
  sellerPause: 'You can pause your ad at any time. Paused days are not added back to the campaign.',
  cancellation: 'You can cancel your campaign. Any refund is reviewed by Bulkimart and paid to your original payment method.',
  rejection: 'You pay only after Bulkimart approves your campaign, so a rejected campaign is never charged.',
  suspension: 'Bulkimart may suspend an ad that breaks marketplace rules. Any refund for unused days is reviewed by Bulkimart.',
  unusedService: 'If your ad cannot be shown, for example because a product is out of stock, unused days are reviewed for a refund.',
  refunds: 'Approved refunds are returned to your original payment method.',
};
const gstText = (treatment, rate) => treatment === 'NONE' ? 'No GST is charged on this package.'
  : treatment === 'INCLUSIVE' ? `The price includes ${rate}% GST.` : `${rate}% GST is added on top of the package price.`;

// Mirrors the server's charge so the admin sees exactly what the seller will pay.
export function packageCharge(pricePaise, treatment, ratePercent) {
  const bps = treatment === 'NONE' ? 0 : Math.round(Number(ratePercent) * 100);
  if (!Number.isSafeInteger(pricePaise) || pricePaise < 1 || !Number.isFinite(bps)) return null;
  const basePaise = treatment === 'INCLUSIVE' ? Math.round(pricePaise * 10000 / (10000 + bps)) : pricePaise;
  const taxPaise = treatment === 'NONE' ? 0 : treatment === 'INCLUSIVE' ? pricePaise - basePaise : Math.round(pricePaise * bps / 10000);
  return { basePaise, taxPaise, totalPaise: basePaise + taxPaise };
}

export const blankPackageForm = () => ({ name: '', description: '', module: 'ECOMMERCE', allCategories: true, categories: [],
  price: '', durationDays: '7', maxProducts: '5', gst: 'EXCLUSIVE', gstRate: '18', isActive: true, archived: false, policies: {} });

export function packageFormFromRow(row) {
  const billing = row.policies?.billing;
  return { ...blankPackageForm(), id: row.id, version: row.version, name: row.name, description: row.description || '', module: row.module,
    allCategories: !row.categories?.length, categories: (row.categories || []).map(String), price: String(row.amountPaise / 100),
    durationDays: String(row.durationDays), maxProducts: String(row.maxProducts), isActive: row.isActive, policies: row.policies || {},
    ...(billing ? { gst: billing.taxTreatment, gstRate: String((billing.taxRateBps || 0) / 100) } : {}) };
}

export function packagePayload(form) {
  const rate = form.gst === 'NONE' ? 0 : Number(form.gstRate);
  const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined && value[k] !== null && value[k] !== '').map(k => [k, value[k]]));
  const saved = form.policies || {}, terms = pick(saved, Object.keys(STANDARD_TERMS));
  const tax = pick(saved.tax, ['invoiceIssuer', 'calculation', 'creditNotes']);
  const attribution = saved.attribution?.windowHours ? pick(saved.attribution, ['windowHours', 'conversionEvent', 'model']) : null;
  const billing = pick(saved.billing, ['approvalReference', 'issuer', 'taxRecognition', 'invoiceMode', 'creditNoteMode', 'startCondition', 'interruption', 'recognition']);
  const refunds = pick(saved.billing?.refunds, ['cancellationBps', 'suspensionBps', 'unavailableBps', 'unusedBps']);
  if (Object.keys(refunds).length === 4) billing.refunds = refunds;
  return { name: form.name.trim(), description: form.description.trim(), module: form.module, placement: 'CATEGORY_SPONSORED',
    amountPaise: Math.round(Number(form.price) * 100), durationDays: Number(form.durationDays), maxProducts: Number(form.maxProducts),
    categories: form.allCategories ? [] : form.categories, isActive: form.isActive && !form.archived, archived: form.archived,
    version: form.version, reason: form.id ? 'Package updated by admin' : 'Package created by admin',
    policies: { ...STANDARD_TERMS, ...terms,
      tax: { ...tax, treatment: gstText(form.gst, rate) },
      attribution: attribution || { windowHours: 24, conversionEvent: 'PAID', model: 'LAST_CLICK' },
      billing: { ...STANDARD_BILLING, ...billing, taxTreatment: form.gst, taxRateBps: Math.round(rate * 100) } } };
}
