// Labels for server states. Unknown values fall back to a readable form, never to a guess.
const readable = (value) => String(value || '').replace(/_/g, ' ').toLowerCase();

// Delivery.status (backend/models/Delivery.js) as the rider sees it.
export const STAGE_LABEL = {
  assigned: 'Head to the store',
  accepted: 'Head to the store',
  arrived_at_store: 'At the store',
  picked_up: 'Picked up — deliver to customer',
  in_transit: 'On the way to customer',
  arrived_at_customer: 'At the customer',
  delivered: 'Delivered',
  rejected: 'Cancelled',
  failed: 'Failed',
};
export const stageLabel = (stage) => STAGE_LABEL[stage] || readable(stage) || 'Head to the store';

// GET /api/delivery/orders/history item.type (deliveryPartner.controller.js getRiderHistory).
export const HISTORY_TYPES = [
  { key: 'ALL', label: 'All' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'CANCELLED_BY_RIDER', label: 'Cancelled' },
  { key: 'DECLINED_BY_RIDER', label: 'Declined' },
  { key: 'OFFER_EXPIRED', label: 'Missed' },
  { key: 'FAILED', label: 'Failed' },
];
export const HISTORY_TONE = { DELIVERED: 'success', CANCELLED_BY_RIDER: 'danger', DECLINED_BY_RIDER: 'neutral', OFFER_EXPIRED: 'warning', FAILED: 'danger' };
export const historyLabel = (type) => HISTORY_TYPES.find((t) => t.key === type)?.label || readable(type);

// Return.pickup.status for the Quick Commerce reverse pickup.
export const RETURN_STATUS = {
  ASSIGNED: { label: 'Collect from customer', tone: 'info' },
  PICKED_UP: { label: 'Drop at seller', tone: 'warning' },
  DELIVERED_TO_SELLER: { label: 'Delivered to seller', tone: 'success' },
};
export const returnStatus = (status) => RETURN_STATUS[status] || { label: readable(status) || 'assigned', tone: 'neutral' };

// COD cash states (orderFinance.service.js) — same wording as the web DeliveryFinancePanel.
export const CASH_LABEL = {
  expected: 'Collect cash',
  collected: 'Cash with you — hand it over',
  remittance_reported: 'Handed over — Bulkimart is checking',
  verified: 'Cash received by Bulkimart',
  allocated: 'Cash received by Bulkimart',
  discrepancy: 'Amount mismatch — Bulkimart will contact you',
  disputed: 'Under review',
};
export const CASH_TONE = { expected: 'warning', collected: 'warning', remittance_reported: 'info', verified: 'success', allocated: 'success', discrepancy: 'danger', disputed: 'danger' };

export const LEDGER_BUCKET = {
  held: 'On hold (waiting for payment check)',
  eligible: 'Available to withdraw',
  reserved: 'Payout requested',
  settled: 'Paid to you',
  pending: 'Pending',
};

export const PAYOUT_TONE = { pending: 'warning', approved: 'info', processing: 'info', completed: 'success', paid: 'success', rejected: 'danger', failed: 'danger' };

// Partner application status (VENDOR_STATUSES).
export const PARTNER_STATUS = {
  incomplete: 'Registration not finished',
  pending: 'Application under review',
  under_review: 'Application under review',
  approved: 'Active',
  rejected: 'Application rejected',
  suspended: 'Account suspended',
};
export const partnerStatusLabel = (status) => PARTNER_STATUS[status] || readable(status) || 'Unknown';

// Parcel delivery (frontend/src/components/parcels/parcelRiderText.js).
export const parcelStatus = (value) => ({
  searching_for_driver: 'New parcel request', driver_assigned: 'Ready for pickup', driver_arriving: 'On the way to pickup',
  arrived_at_pickup: 'At the pickup address', picked_up: 'Parcel collected', in_transit: 'On the way to delivery',
  arrived_at_dropoff: 'At the delivery address', delivered: 'Delivery complete', cancelled: 'Booking cancelled',
  cancellation_review: 'Delivery paused', delivery_failed: 'Waiting for support',
}[value] || 'Parcel update');

export const PARCEL_NEXT_STEP = {
  driver_assigned: { action: 'driver_arriving', label: 'Start pickup', help: 'Head to the sender to collect the parcel.' },
  driver_arriving: { action: 'arrived_at_pickup', label: 'I’m at pickup', help: 'Tap once you reach the pickup address.' },
  picked_up: { action: 'in_transit', label: 'Start delivery', help: 'Keep the parcel secure and head to the recipient.' },
  in_transit: { action: 'arrived_at_dropoff', label: 'I’m at the delivery address', help: 'Tap once you reach the recipient.' },
};

export const PARCEL_PROBLEMS = [
  ['unreachable_recipient', 'Contact person is not answering'],
  ['invalid_address', 'Cannot find the address'],
  ['prohibited_parcel', 'Parcel contains an item that is not allowed'],
  ['recipient_refusal', 'Recipient does not want the parcel'],
  ['payment_refusal', 'Cash payment was refused'],
  ['operational_failure', 'Another pickup or delivery problem'],
];

export const PARCEL_ACTION_NOTICE = {
  driver_arriving: 'Pickup started. Head to the sender.', arrived_at_pickup: 'Arrival recorded. Ask the sender for the pickup code.',
  pickup_code: 'Pickup code is ready in the customer’s tracking page.', verify_pickup: 'Pickup confirmed. You can start delivery.',
  in_transit: 'Delivery started. Head to the recipient.', arrived_at_dropoff: 'Arrival recorded. Ask for the delivery code.',
  delivery_code: 'Delivery code is ready in the customer’s tracking page.', verify_delivery: 'Delivery completed. Thank you!',
  collect_cash: 'Cash payment recorded.', exception: 'Support has been notified. Keep any collected parcel safe.',
};

export function parcelFriendlyError(error) {
  const message = error?.message || 'Could not update the parcel.';
  if (/Invalid proof code/i.test(message)) return 'That code is incorrect. Ask for the code again and retry.';
  if (/Valid proof required|Arrive before requesting proof/i.test(message)) return 'Request a pickup or delivery code at the address before confirming.';
  if (/Exact fee collection|Collect the exact pickup fee/i.test(message)) return 'Record the cash delivery fee before confirming.';
  return message;
}

export const shortParcelNumber = (b) => `Parcel #${String(b?.reference || b?._id || '').slice(-6).toUpperCase()}`;
