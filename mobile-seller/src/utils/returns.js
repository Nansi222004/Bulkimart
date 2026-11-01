// Labels and guidance copied from frontend/src/modules/Seller/components/SellerReturnsTab.jsx.

export const RETURN_STATUS_LABEL = {
  RETURN_REQUESTED: 'Requested', UNDER_REVIEW: 'Under Review', APPROVED: 'Approved', AWAITING_RETURN: 'Awaiting Return',
  RETURN_RECEIVED: 'Received', REFUND_PENDING: 'Refund Pending', REFUND_FAILED: 'Refund Failed', REFUNDED: 'Refunded',
  REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export const PICKUP_LABEL = {
  NOT_ASSIGNED: 'Awaiting rider acceptance', ASSIGNED: 'Rider on the way', PICKED_UP: 'Picked up — in transit to you',
  DELIVERED_TO_SELLER: 'Received', CANCELLED: 'Pickup cancelled',
};

export const RETURN_COLORS = {
  RETURN_REQUESTED: ['#fef3c7', '#92400e'], UNDER_REVIEW: ['#fef3c7', '#92400e'], APPROVED: ['#dbeafe', '#1e40af'],
  AWAITING_RETURN: ['#dbeafe', '#1e40af'], RETURN_RECEIVED: ['#e0e7ff', '#3730a3'], REFUND_PENDING: ['#ede9fe', '#6d28d9'],
  REFUND_FAILED: ['#fee2e2', '#b91c1c'], REFUNDED: ['#dcfce7', '#166534'], REJECTED: ['#fee2e2', '#b91c1c'], CANCELLED: ['#f1f5f9', '#475569'],
};

export const KPI_GROUPS = {
  requested: ['RETURN_REQUESTED', 'UNDER_REVIEW'],
  pickup: ['APPROVED', 'AWAITING_RETURN', 'RETURN_RECEIVED'],
  refunded: ['REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'],
};

// Same status conditions the web uses to show the panels; the server enforces every transition.
export const canDecide = (r) => ['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(r?.status);
export const canArrangePickup = (r) => ['APPROVED', 'AWAITING_RETURN'].includes(r?.status);
export const canMarkReceived = (r) => r?.pickup?.status === 'PICKED_UP'
  || (r?.reverseBooking?.trackingState === 'DELIVERED' && r?.pickup?.status !== 'DELIVERED_TO_SELLER');
export const canCancelManualRequest = (r) => r?.pickupMethod === 'MANUAL' && r?.pickup?.status === 'NOT_ASSIGNED';
export const canCancelCourier = (r) => r?.pickupMethod === 'SHIPROCKET' && r?.reverseBooking?.state === 'booked' && (r?.reverseBooking?.trackingRank || 0) < 2;

export function nextStep(r) {
  switch (r.status) {
    case 'RETURN_REQUESTED':
    case 'UNDER_REVIEW': return 'Review the reason and photos, then approve or reject this return.';
    case 'APPROVED':
    case 'AWAITING_RETURN':
      if (r.pickup?.status === 'DELIVERED_TO_SELLER') return 'You confirmed receipt. Bulkimart will inspect the item and process the refund.';
      if (r.pickup?.status === 'PICKED_UP') return 'The rider has collected the item. Mark it received once it reaches you.';
      if (r.pickup?.status === 'ASSIGNED') return 'A rider is on the way to collect the item from the customer.';
      if (r.pickupMethod === 'SHIPROCKET') return 'Shiprocket reverse pickup is booked. Refresh courier tracking for the latest scan.';
      if (r.pickupMethod === 'MANUAL') return 'Waiting for the requested delivery partner to accept. Cancel the request to choose again or use Shiprocket.';
      return 'Choose a pickup method: a local rider (same city only) or Shiprocket reverse pickup.';
    case 'RETURN_RECEIVED': return 'You confirmed receipt. Bulkimart will inspect the item and process the refund.';
    case 'REFUND_PENDING': return 'Inspection is complete. The customer refund is being processed.';
    case 'REFUND_FAILED': return 'The refund attempt failed. Bulkimart will retry it.';
    case 'REFUNDED': return 'The customer has been refunded. Your earning for this item is adjusted in Earnings.';
    case 'REJECTED': return 'This return was rejected. No pickup is needed.';
    default: return '';
  }
}

export const humanize = (value) => String(value || '').replace(/_/g, ' ');
export const formatDate = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
