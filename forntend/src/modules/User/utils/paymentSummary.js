const money = value => Math.round(Number(value || 0) * 100) / 100;

// Delivery in the server quote already includes the Same-Day premium. Coins
// and the optional checkout tip are separate adjustments to that quote.
export const paymentSummary = (pricing = {}, { coinDiscount = 0, tipAmount = 0 } = {}) => {
  pricing = pricing || {};
  const premium = money(pricing.sameDayPremium ?? (Number(pricing.sameDayFee || 0) + Number(pricing.sameDayIncentive || 0)));
  return {
    subtotal: money(pricing.subtotal),
    deliveryCharge: money(Math.max(0, Number(pricing.deliveryCharge || 0) - premium)),
    sameDayPremium: premium,
    couponDiscount: money(pricing.couponDiscount),
    coinDiscount: money(coinDiscount),
    tipAmount: money(tipAmount),
    totalAmount: money(Number(pricing.totalAmount || 0) - Number(coinDiscount || 0) + Number(tipAmount || 0)),
  };
};
