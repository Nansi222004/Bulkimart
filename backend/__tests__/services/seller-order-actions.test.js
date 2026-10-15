import { sellerOrderActions } from '../../services/sellerOrderActions.service.js';
const order = (status, deliveryType = 'internal') => ({ status, deliveryType, vendorDecision: { status: 'accepted' }, fulfillment: { assignmentPolicy: 'seller_after_acceptance' } });
test.each(['internal', 'shiprocket', undefined])('seller action matrix preserves cancellation policy for %s while terminal states stay immutable', carrier => {
  expect(sellerOrderActions({ ...order('placed', carrier), vendorDecision: { status: 'pending' } }).map(a => a.label)).toEqual(['Accept order', 'Reject']);
  expect(sellerOrderActions(order('confirmed', carrier)).map(a => a.label)).toEqual(['Start preparing', 'Cancel order']);
  expect(sellerOrderActions(order('preparing', carrier)).map(a => a.label)).toEqual(['Ready for pickup', 'Cancel order']);
  expect(sellerOrderActions({ ...order('preparing', carrier), fulfillment: { assignmentPolicy: 'seller_after_acceptance', readyAt: new Date() } }).map(a => a.label)).toEqual(['Choose delivery', 'Cancel order']);
  for (const status of ['delivered','cancelled','return_requested','returned','refunded']) expect(sellerOrderActions(order(status, carrier))).toEqual([]);
});
test.each(['creating','assigning','reconciliation_required'])('shipment lock %s disables mutations', status => {
  for (const state of ['placed','confirmed','preparing','dispatched','out_for_delivery']) expect(sellerOrderActions({ ...order(state), shiprocket: { status } })).toEqual([]);
});
test('assignment prevents cancellation; internal delivery completion is rider-only; payment gates acceptance', () => {
  expect(sellerOrderActions({ ...order('placed'), vendorDecision: { status: 'pending' } }, false).map(a => a.to)).toEqual(['cancelled']);
  expect(sellerOrderActions(order('dispatched'))).toEqual([]);
  expect(sellerOrderActions(order('out_for_delivery'))).toEqual([]);
  expect(sellerOrderActions({ ...order('preparing'), deliveryId: 'assigned' }).some(a => a.reject)).toBe(false);
  expect(sellerOrderActions({ ...order('preparing', 'shiprocket'), fulfillment: { assignmentPolicy: 'seller_after_acceptance', method: 'shiprocket' }, shiprocket: { orderId: 'real', shipmentId: 'real', awb: 'real', courier: 'real' } }).map(a => a.to)).toEqual(['dispatched']);
});
