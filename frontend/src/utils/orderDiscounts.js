export const orderDiscountRows = pricing => {
  if (!pricing) return [];
  const rows = pricing.discountRepresentation === 'components-v1'
    ? [['Promotion discount', pricing.discount], ['Coupon discount', pricing.couponDiscount], ['Legacy membership discount', pricing.cdsDiscount], ['Coins discount', pricing.coinDiscount]]
    : [['Total Discount', pricing.discount]];
  return rows.filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount) && amount > 0);
};
