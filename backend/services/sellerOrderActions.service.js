import { vendorTransitions } from '../constants/enums.js';

export const shipmentLocked = order => Boolean(order.shiprocket?.orderId || order.shiprocket?.shipmentId
  || ['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status));

export function sellerOrderActions(order, paymentReady = true) {
  if (['creating', 'assigning', 'reconciliation_required'].includes(order.shiprocket?.status)) return [];
  const actions = [];
  const transitions = vendorTransitions(order.deliveryType)[order.status] || [];
  const locked = shipmentLocked(order) || Boolean(order.deliveryId || order.deliveryPartnerId);
  if (!paymentReady) return [];
  if (order.status === 'dispatched' && order.deliveryType !== 'shiprocket' && !order.deliveryPartnerId && !order.deliveryId) {
    actions.push({ setup: true, label: 'Reassign delivery partner' });
  }
  if (transitions.includes('confirmed')) actions.push({ to: 'confirmed', label: 'Accept order' });
  if (order.status === 'confirmed' && order.vendorDecision?.status !== 'accepted') actions.push({ to: 'confirmed', label: 'Accept order' });
  if (transitions.includes('preparing') && order.vendorDecision?.status === 'accepted' && paymentReady) actions.push({ to: 'preparing', label: 'Start preparing' });
  if (order.status === 'preparing' && order.vendorDecision?.status === 'accepted' && paymentReady) {
    if (order.deliveryType === 'shiprocket' && order.shiprocket?.awb && order.shiprocket?.courier) actions.push({ to: 'dispatched', label: 'Confirm courier hand-off' });
    else if (!order.fulfillment?.readyAt && !order.fulfillment?.method) actions.push({ to: 'ready_for_pickup', label: 'Ready for pickup' });
    else if (!order.fulfillment?.method) actions.push({ setup: true, label: 'Choose delivery' });
    else if (order.deliveryType !== 'shiprocket') actions.push({ to: 'dispatched', label: 'Offer to Bulkimart riders' });
    else if (order.shiprocket?.awb && order.shiprocket?.courier) actions.push({ to: 'dispatched', label: 'Confirm courier hand-off' });
  }
  // Existing courier reporting policy remains; internal delivery is rider-only.
  if (transitions.includes('out_for_delivery')) actions.push({ to: 'out_for_delivery', label: 'Out for delivery' });
  if (transitions.includes('delivered')) actions.push({ to: 'delivered', label: 'Mark delivered' });
  if (transitions.includes('cancelled') && !locked) actions.push({ to: 'cancelled', label: order.vendorDecision?.status === 'accepted' ? 'Cancel order' : 'Reject', reject: true });
  return actions;
}

