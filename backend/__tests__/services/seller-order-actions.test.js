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


import { riderIneligibility } from '../../services/riderEligibility.service.js';
const pickup = { lat: 19.1, lng: 72.9, pincode: '400001' };
const eligible = { status: 'approved', isAvailable: true, zones: ['400001'], baseLocation: { lat: 19.1, lng: 72.9 } };
const account = { isActive: true, roles: ['delivery'] };
const parcel = { type: 'ecommerce', shippingAddress: { pincode: '400002' } };
test.each([
  [{}, {}, null],
  [{ isAvailable: false }, {}, 'off_duty'],
  [{ status: 'suspended' }, {}, 'not_approved'],
  [{}, { isActive: false }, 'inactive_account'],
  [{}, { roles: ['buyer'] }, 'inactive_account'],
  [{ zones: ['110001'] }, {}, 'outside_coverage'],
  [{ baseLocation: {} }, {}, 'outside_pickup_radius'],
  [{ baseLocation: { lat: 28.6, lng: 77.2 } }, {}, 'outside_pickup_radius'],
  [{ currentLocation: { lat: 19.2, lng: 73 }, deliveryRadiusKm: 1 }, {}, 'outside_rider_radius'],
])('rider eligibility enforces operational data independently of approval: %p', (changes, user, reason) => {
  expect(riderIneligibility({ ...eligible, ...changes }, { ...account, ...user }, parcel, pickup)).toBe(reason);
});
test('Quick zone coverage and geo-only base points use the same eligibility predicate', () => {
  expect(riderIneligibility({ ...eligible, baseLocation: { point: { coordinates: [72.9,19.1] } } }, account, parcel, pickup)).toBeNull();
  expect(riderIneligibility({ ...eligible, zones: ['110001'] }, account, { ...parcel, type: 'grocery' }, pickup)).toBe('outside_coverage');
});


test('legacy preparing orders expose readiness and delivery setup instead of skipping straight to dispatch', () => {
  const legacy = { status: 'preparing', deliveryType: 'internal', vendorDecision: { status: 'accepted' } };
  expect(sellerOrderActions(legacy).map(a => a.to)).toEqual(['ready_for_pickup','cancelled']);
  expect(sellerOrderActions({ ...legacy, fulfillment: { readyAt: new Date() } }).some(a => a.setup)).toBe(true);
  expect(sellerOrderActions({ ...legacy, deliveryType: 'shiprocket', shiprocket: { orderId: 'recorded-order', shipmentId: 'recorded-shipment', awb: 'existing-awb', courier: 'existing-courier' } }).map(a => a.to)).toEqual(['dispatched']);
});
