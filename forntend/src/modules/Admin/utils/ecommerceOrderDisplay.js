const text = value => typeof value === 'string' ? value.trim() : '';
const completed = order => ['delivered', 'returned', 'refunded'].includes(order.status);

export function ecommerceDeliveryDisplay(order) {
  const items = order.items || [];
  if (items.length && items.every(item => item.fulfillmentType === 'digital')) {
    return { courier: 'Digital delivery', tracking: 'Not applicable' };
  }
  const partner = order.deliveryPartnerId;
  if (order.deliveryType === 'internal' || order.fulfillment?.method === 'manual' || (!order.deliveryType && partner)) {
    const rider = text(partner?.userId?.name) || text(partner?.userId?.phone);
    return { courier: rider ? `Bulkimart Delivery · ${rider}` : 'Bulkimart Delivery', tracking: 'Not applicable' };
  }
  const courier = text(order.shiprocket?.courier);
  const awb = text(order.shiprocket?.awb);
  if (courier || awb || order.deliveryType === 'shiprocket' || order.fulfillment?.method === 'shiprocket') {
    return {
      courier: courier || (completed(order) || awb ? 'Courier not recorded' : order.status === 'cancelled' ? 'Courier not assigned' : 'Shiprocket · courier pending'),
      tracking: awb || (completed(order) ? 'Not recorded' : order.status === 'cancelled' ? 'Not assigned' : 'Awaiting tracking number'),
    };
  }
  if (order.fulfillment?.method === 'third_party') {
    return { courier: 'Third-party courier · name not recorded', tracking: 'Not recorded' };
  }
  return {
    courier: completed(order) ? 'Delivery partner not recorded' : order.status === 'cancelled' ? 'Not assigned' : 'Awaiting delivery assignment',
    tracking: completed(order) ? 'Not recorded' : order.status === 'cancelled' ? 'Not assigned' : 'Awaiting delivery assignment',
  };
}

export function ecommerceOrderRow(order) {
  const amount = order.pricing?.totalAmount;
  return {
    id: order.orderNo || order._id,
    customer: order.userId?.name || order.userId?.phone || 'Customer',
    items: (order.items || []).length,
    amount: amount !== null && amount !== undefined && amount !== '' && Number.isFinite(Number(amount))
      ? `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Amount not recorded',
    ...ecommerceDeliveryDisplay(order),
    status: order.status || 'Unknown',
  };
}
