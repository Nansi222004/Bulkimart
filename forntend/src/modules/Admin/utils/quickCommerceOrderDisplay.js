import { ecommerceOrderRow } from './ecommerceOrderDisplay';

export function quickCommerceOrderRow(order) {
  const stores = [...new Set((order.items || []).map(item => item.sellerId?.storeDetails?.name || item.sellerId?.businessName).filter(Boolean))];
  const rider = order.deliveryPartnerId?.userId;
  const promised = order.delivery?.promisedBy;
  return {
    id: order.orderNo || order._id,
    customer: order.shippingAddress?.name || order.userId?.name || order.userId?.phone || 'Customer',
    hub: stores.join(', ') || 'Store not recorded',
    rider: rider?.name || rider?.phone || (order.deliveryPartnerId ? 'Rider name not recorded' : 'Not assigned'),
    eta: promised && !Number.isNaN(new Date(promised).getTime()) ? new Date(promised).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Not recorded',
    amount: ecommerceOrderRow(order).amount,
    status: order.status || 'Unknown',
  };
}
