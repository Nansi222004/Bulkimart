import { notifyAllAdmins, notifySeller } from './notification.service.js';

// Call only after the campaign transaction commits. Versioned keys suppress
// duplicate deliveries without suppressing a later resubmission or decision.
export async function notifyAdvertisingChange(row, action) {
  const a = row.advertising, id = String(row._id);
  const metadata = { campaignId: id, sellerId: String(row.sellerId) };
  const dedupeKey = `advertising:${id}:${row.__v}:${action}`;
  if (action === 'submit') return notifyAllAdmins({
    event: 'ADVERTISING_SUBMITTED', title: 'Advertising campaign awaiting review',
    message: `A seller submitted “${row.title}”. Open the campaign to review it.`,
    metadata, dedupeKey, route: `/admin/advertising?campaign=${id}`,
  });
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
