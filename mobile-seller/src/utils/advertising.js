// Ports of frontend/src/components/advertising/advertisingApi.js helpers. Display only.

export const adMoney = (paise) => (Number.isSafeInteger(paise)
  ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : 'Not configured');

export const MODULE_LABEL = { ECOMMERCE: 'Shop All', QUICK: 'Quick Commerce' };

const PLAIN = {
  review: { DRAFT: 'Draft', PENDING_REVIEW: 'Waiting for review', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved', REJECTED: 'Not approved' },
  funding: { UNPAID: 'Not paid', PAYMENT_PENDING: 'Payment in progress', FUNDED: 'Paid', PAYMENT_FAILED: 'Payment failed', REFUND_PENDING: 'Refund in progress',
    PARTIALLY_REFUNDED: 'Partly refunded', REFUNDED: 'Refunded', RECONCILIATION_REQUIRED: 'Payment needs checking' },
  delivery: { NOT_SCHEDULED: 'Not scheduled', SCHEDULED: 'Scheduled', ACTIVE: 'Live', SELLER_PAUSED: 'Paused by seller', UNAVAILABLE: 'Paused (products unavailable)',
    EXHAUSTED: 'Finished', COMPLETED: 'Finished', CANCELLED: 'Cancelled', ADMIN_SUSPENDED: 'Suspended by Bulkimart' },
};
export const plainStatus = (kind, value) => PLAIN[kind]?.[value] || String(value ?? '—').replaceAll('_', ' ').toLowerCase();

export const campaignLabel = (row) => {
  if (!row) return 'UNKNOWN';
  if (row.funding === 'REFUNDED') return 'REFUNDED';
  if (row.funding === 'PARTIALLY_REFUNDED') return 'PARTIALLY REFUNDED';
  if (row.delivery && row.delivery !== 'NOT_SCHEDULED') return String(row.delivery).replaceAll('_', ' ');
  if (row.review === 'APPROVED') return 'APPROVED AWAITING PAYMENT';
  if (row.review) return String(row.review).replaceAll('_', ' ');
  return 'DRAFT';
};

// Same conditions as the backend (advertising.service.js `editable`, `changeAdvertisingCampaign`).
export const isEditable = (c) => ['DRAFT', 'CHANGES_REQUESTED'].includes(c?.review) && c?.funding === 'UNPAID' && c?.delivery === 'NOT_SCHEDULED';
export const canCancelUnpaid = (c) => c?.funding === 'UNPAID' && c?.delivery === 'NOT_SCHEDULED';
export const canCancelPaid = (c) => !canCancelUnpaid(c) && !['COMPLETED', 'CANCELLED', 'ADMIN_SUSPENDED'].includes(c?.delivery);

// IST date + time typed by the seller → ISO string with an offset (the backend requires a timezone).
export function istToIso(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return null;
  const iso = `${date}T${time}:00+05:30`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
}
export function isoToIstParts(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(new Date(iso).getTime() + 330 * 60000); // shift to IST, then read as UTC
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—');
