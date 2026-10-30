const money = value => Math.round(Number(value || 0) * 100) / 100;

// Delivery in the server quote already includes the Same-Day premium. The
// optional checkout tip is a separate adjustment to that quote.
export const paymentSummary = (pricing = {}, { tipAmount = 0 } = {}) => {
  pricing = pricing || {};
  const premium = money(pricing.sameDayPremium ?? (Number(pricing.sameDayFee || 0) + Number(pricing.sameDayIncentive || 0)));
  return {
    productTax: pricing.productTax,
    subtotal: pricing.productTax?.version === 'product-gst-v1' ? pricing.productTax.sellingPricePaise / 100 : money(pricing.subtotal),
    deliveryCharge: money(Math.max(0, Number(pricing.deliveryCharge || 0) - premium)),
    sameDayPremium: premium,
    couponDiscount: money(pricing.couponDiscount),
    tipAmount: money(tipAmount),
    totalAmount: money(Number(pricing.totalAmount || 0) + Number(tipAmount || 0)),
  };
};
