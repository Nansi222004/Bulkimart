import Fee from '../models/GstAssistanceFee.js';
import { httpError } from '../utils/response.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
export const feeView = row => row ? { amountPaise: row.amountPaise, currency: row.currency, terms: row.terms, version: row.version } : null;
export async function currentGstFee(session = null) { return feeView(await Fee.findById('gst-assistance').session(session)); }
export function validateGstFee(body) {
  if (!Number.isSafeInteger(body.amountPaise) || body.amountPaise < 1 || body.amountPaise > MAX_CHECKOUT_PAISE) throw httpError(400, 'Enter a positive service fee with at most two decimal places');
  if (typeof body.terms !== 'string' || !body.terms.trim() || body.terms.length > 5000) throw httpError(400, 'Specify the service payment and cancellation terms');
  if (!Number.isSafeInteger(body.version) || body.version < 0) throw httpError(400, 'Reload the current service fee before saving');
  return { amountPaise: body.amountPaise, currency: 'INR', terms: body.terms.trim() };
}
