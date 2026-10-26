export function sellerOrderTotal(order) {
  if (Number.isFinite(order.pricing?.totalAmount)) return { label: 'Order total', value: order.pricing.totalAmount };
  if (Number.isFinite(order.sellerAmounts?.customerItemsTotal)) return { label: 'Your items after discounts', value: order.sellerAmounts.customerItemsTotal };
  return { label: 'Item subtotal', value: order.subtotal ?? order.pricing?.subtotal };
}

export function sellerPricingRows(order) {
  const amounts = order.sellerAmounts, pricing = order.pricing;
  if (amounts?.totalDiscount != null) return [
    ['Items subtotal', amounts.subtotal], ['Item discount', amounts.discount], ['Coupon discount', amounts.couponDiscount],
    ['CDS discount', amounts.cdsDiscount], ['Coin discount', amounts.coinDiscount],
    ...(pricing ? [['Delivery charge', pricing.deliveryCharge], ['Tax', pricing.tax ?? pricing.taxAmount], ['Tip', pricing.tipAmount], ['Donation', pricing.donationAmount]] : []),
    [pricing ? 'Order total' : 'Your items after discounts', pricing?.totalAmount ?? amounts.customerItemsTotal],
  ].filter(([label, value]) => value != null && (!label.toLowerCase().includes('discount') || value > 0));
  const labels = { subtotal: 'Items subtotal', discount: 'Item discount', couponDiscount: 'Coupon discount', cdsDiscount: 'CDS discount', coinDiscount: 'Coin discount', deliveryCharge: 'Delivery charge', tax: 'Tax', taxAmount: 'Tax', totalAmount: 'Order total', tipAmount: 'Tip', donationAmount: 'Donation' };
  return pricing ? Object.entries(pricing).filter(([key]) => labels[key]).map(([key, value]) => [labels[key], value]) : [['Seller items subtotal', order.subtotal]];
}
