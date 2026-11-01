const asDate = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export const formatDateTime = (value) => asDate(value)?.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) || '—';
export const formatTime = (value) => asDate(value)?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) || '—';
export const formatDate = (value) => asDate(value)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) || '—';

/** Last four digits only. Bank account numbers are never shown in full. */
export const maskAccount = (value) => (value ? `•••• ${String(value).slice(-4)}` : 'Not added');

/** Display ID derived from the partner record (same format as the web profile). */
export const partnerCode = (id) => (id ? `NHC-DEL-${String(id).slice(-5).toUpperCase()}` : '—');

export const capitalize = (text) => (text ? String(text).charAt(0).toUpperCase() + String(text).slice(1) : '');

/** Same output as frontend/src/modules/Delivery/utils/riderRating.js. */
export function ratingSummary(profile) {
  const count = Number(profile?.ratingCount) || 0;
  const rating = Number(profile?.rating);
  return count > 0 && Number.isFinite(rating)
    ? { value: `${rating.toFixed(1)} / 5`, count: `${count} customer ${count === 1 ? 'rating' : 'ratings'}` }
    : { value: 'Not rated yet', count: 'No customer ratings yet' };
}
