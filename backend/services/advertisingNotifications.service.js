import Seller from '../models/Seller.js';
import { notifyAllAdmins, notifySeller } from './notification.service.js';

// The store name admins see in the review notification; a failed lookup keeps the generic wording.
const storeName = async sellerId => {
  const seller = await Seller.findById(sellerId).select('businessName storeDetails.name').lean().catch(() => null);
  return seller?.storeDetails?.name || seller?.businessName || '';
};

// Call only after the campaign transaction commits. Versioned keys suppress
// duplicate deliveries without suppressing a later resubmission or decision.
const rupees = paise => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

export async function notifyAdvertisingChange(row, action, extra = {}) {
  const a = row.advertising, id = String(row._id);
  const metadata = { campaignId: id, sellerId: String(row.sellerId) };
  const dedupeKey = `advertising:${id}:${row.__v}:${action}`;
  if (action === 'submit') return notifyAllAdmins({
    event: 'ADVERTISING_SUBMITTED', title: 'Advertising campaign awaiting review',
    message: `${await storeName(row.sellerId) || 'A seller'} submitted “${row.title}”. Open the campaign to review it.`,
    metadata, dedupeKey, route: `/admin/advertising?campaign=${id}`,
  });
  // A paid campaign was cancelled: nothing is refunded automatically, so admins are told a refund is
  // waiting (when the seller cancelled) and the seller is told it will be reviewed.
  if (action === 'cancel' && extra.refundPaise !== undefined) {
    const limit = extra.refundPaise > 0 ? `up to ${rupees(extra.refundPaise)}` : 'under the package terms';
    if (extra.bySeller) await notifyAllAdmins({ event: 'ADVERTISING_REFUND_WAITING', title: 'Advertising refund waiting',
      message: `${await storeName(row.sellerId) || 'A seller'} cancelled “${row.title}”. A refund ${limit} is waiting for your review.`,
      metadata, dedupeKey: `${dedupeKey}:admins`, route: `/admin/advertising?campaign=${id}` });
    return notifySeller(row.sellerId, { event: 'ADVERTISING_CANCELLED', title: 'Advertising campaign cancelled',
      message: `“${row.title}”: your ad has stopped. Bulkimart will review your refund (${limit}) to your original payment method.`,
      metadata, dedupeKey, route: `/seller/advertising?campaign=${id}` });
  }
  // Refund progress, once per Razorpay refund (its id keys the notice).
  if (['refund-started', 'refund-processed', 'refund-failed'].includes(action)) {
    const amount = rupees(extra.amountPaise), key = `advertising:${id}:${action}:${extra.refundId}`;
    if (action === 'refund-failed') return notifyAllAdmins({ event: 'ADVERTISING_REFUND_FAILED', title: 'Advertising refund failed',
      message: `The refund of ${amount} for “${row.title}” failed at Razorpay. Open the campaign to send it again.`,
      metadata, dedupeKey: key, route: `/admin/advertising?campaign=${id}` });
    const [title, text] = action === 'refund-started'
      ? ['Advertising refund started', `your refund of ${amount} has been sent to Razorpay. It usually reaches your original payment method within a few working days.`]
      : ['Advertising refund completed', `Razorpay has processed your refund of ${amount} to your original payment method. Your bank may take a few working days to show it.`];
    return notifySeller(row.sellerId, { event: action === 'refund-started' ? 'ADVERTISING_REFUND_STARTED' : 'ADVERTISING_REFUNDED',
      title, message: `“${row.title}”: ${text}`, metadata, dedupeKey: key, route: `/seller/advertising?campaign=${id}` });
  }
  const payable = a.review === 'APPROVED' && a.approvedRevision === a.revision && a.paid?.authorizedBy && a.paid.revision === a.revision;
  const messages = {
    approve: ['Advertising campaign approved', payable ? 'Open your campaign to pay and start advertising.' : 'We will notify you when payment is ready.'],
    'billing-authorize': ['Advertising payment requested', 'Your payment is ready. Open your campaign to pay and start advertising.'],
    'request-payment': ['Advertising payment reminder', 'Your approved campaign is awaiting payment. Open it to pay.'],
    'request-changes': ['Changes requested for your campaign', 'Open your campaign to read the review, make changes and submit again.'],
    reject: ['Advertising campaign not approved', 'Open your campaign to read the review.'],
    suspend: ['Advertising campaign suspended', 'Open your campaign to read the reason.'],
  };
  const message = messages[action];
  if (!message) return;
  return notifySeller(row.sellerId, { event: `ADVERTISING_${action.replaceAll('-', '_').toUpperCase()}`,
    title: message[0], message: `“${row.title}”: ${message[1]}`, metadata, dedupeKey,
    route: `/seller/advertising?campaign=${id}` });
}
