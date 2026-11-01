// Ports of frontend/src/modules/Seller/utils/{sellerOrderAmounts,sellerTimeline}.js and OrdersTab helpers.
// These pick which server field to show. They never compute amounts.

export function sellerOrderTotal(order) {
  if (Number.isFinite(order.pricing?.totalAmount)) return { label: 'Order total', value: order.pricing.totalAmount };
  if (Number.isFinite(order.sellerAmounts?.customerItemsTotal)) return { label: 'Your items after discounts', value: order.sellerAmounts.customerItemsTotal };
  return { label: 'Item subtotal', value: order.subtotal ?? order.pricing?.subtotal };
}

export function sellerPricingRows(order) {
  const amounts = order.sellerAmounts;
  const pricing = order.pricing;
  if (amounts?.totalDiscount != null) {
    return [
      ['Items subtotal', amounts.subtotal], ['Item discount', amounts.discount], ['Coupon discount', amounts.couponDiscount],
      ['CDS discount', amounts.cdsDiscount], ['Coin discount', amounts.coinDiscount],
      ...(pricing ? [['Delivery charge', pricing.deliveryCharge], ['Tax', pricing.tax ?? pricing.taxAmount], ['Tip', pricing.tipAmount]] : []),
      [pricing ? 'Order total' : 'Your items after discounts', pricing?.totalAmount ?? amounts.customerItemsTotal],
    ].filter(([label, value]) => value != null && (!label.toLowerCase().includes('discount') || value > 0));
  }
  const labels = {
    subtotal: 'Items subtotal', discount: 'Item discount', couponDiscount: 'Coupon discount', cdsDiscount: 'CDS discount',
    coinDiscount: 'Coin discount', deliveryCharge: 'Delivery charge', tax: 'Tax', taxAmount: 'Tax', totalAmount: 'Order total', tipAmount: 'Tip',
  };
  return pricing
    ? Object.entries(pricing).filter(([key]) => labels[key]).map(([key, value]) => [labels[key], value])
    : [['Seller items subtotal', order.subtotal]];
}

export const sellerTimeline = (timeline) => (timeline || []).filter((event) =>
  !(event.status === 'placed' && /^online payment verified\.?$/i.test(String(event.note || '').trim())));

// Actions come from the authorized order API. Missing data shows no buttons (fail closed).
export const actionsFor = (order) => (Array.isArray(order?.permittedActions) ? order.permittedActions : []);

export const byCourier = (order) =>
  order.deliveryType ? order.deliveryType === 'shiprocket' : order.channel === 'ecommerce';

export const ORDER_LABEL = {
  placed: 'New', confirmed: 'Confirmed', preparing: 'Preparing', dispatched: 'Dispatched',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  return_requested: 'Return requested', returned: 'Returned', refunded: 'Refunded',
};

export const ORDER_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'New', value: 'placed' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Dispatched', value: 'dispatched' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
];

// Same tab matching as web OrdersTab.
export const matchesOrderTab = (order, tab) =>
  tab === 'all' ? true
    : tab === 'pending' ? ['placed', 'confirmed', 'preparing'].includes(order.status)
      : order.status === tab || (tab === 'confirmed' && order.status === 'preparing');
