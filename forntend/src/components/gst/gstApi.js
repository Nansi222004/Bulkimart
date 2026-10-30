import { apiUrl } from '../../utils/api';
import { portalRequest } from '../../utils/portalRequests';
export async function gstApi(admin, path = '', options = {}) {
  const portal = admin ? 'admin' : 'seller', key = `${portal}Token`, token = localStorage.getItem(key);
  if (!token) throw Error('Sign in to continue');
  const url = `/api/${admin ? 'admin' : 'sellers'}/gst-assistance${path}`;
  const response = options.body || options.json ? await fetch(apiUrl(url), { ...options, ...(options.json ? {body:JSON.stringify(options.json)} : {}), headers: { Authorization: `Bearer ${token}`, ...(options.json ? {'Content-Type':'application/json'} : {}), ...options.headers }, signal: AbortSignal.timeout(30000) })
    : await portalRequest(portal, token, url, { cacheMs: 0 });
  if (token !== localStorage.getItem(key)) throw Error('Session changed. Reopen GST assistance.');
  if (options.download && response.ok) return response.blob();
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(body.message || 'GST assistance is temporarily unavailable'), { status: response.status });
  return body.data;
}
export const gstLabels = { pending: 'Pending assistance review', under_review: 'Assistance under review',
  additional_information_required: 'Additional information required', approved: 'Approved — GST work in progress',
  rejected: 'Assistance request rejected', completed: 'Assistance completed — GSTIN independently reviewed by admin', cancelled: 'Assistance request cancelled' };
// What each choice does, for the admin's "Move to" list.
export const gstActionLabels = { under_review: 'Move back to review', additional_information_required: 'Ask the seller for more information',
  approved: 'Approve — start the GST work', completed: 'Mark as completed', rejected: 'Reject the request', cancelled: 'Cancel the request' };
export const gstTransitions = { pending: ['under_review', 'rejected', 'cancelled'], under_review: ['additional_information_required', 'approved', 'rejected', 'cancelled'],
  additional_information_required: ['under_review', 'rejected', 'cancelled'], approved: ['additional_information_required', 'completed', 'rejected', 'cancelled'] };
export function gstDecisionValid(value) {
  if (value.choice === 'has_gstin') return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.gstin || '');
  return value.choice === 'without_gstin' || (value.choice === 'assistance' && value.consent === true && !!value.contactName?.trim() && value.contactName.length <= 100 && (value.message || '').length <= 2000);
}
