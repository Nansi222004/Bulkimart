const money = value => Math.round(Number(value || 0) * 100) / 100;

// Delivery in the server quote already includes the Same-Day premium. The
// optional checkout tip is a separate adjustment to that quote.
// COD handling fee: the quote carries what Cash on Delivery would add (totals.codFeeTotal on a
// basket, pricing.codFee on a single cart). It is added only when the customer picks COD;
// online payment always shows zero. The server recomputes it when the order is placed.
export const paymentSummary = (pricing = {}, { tipAmount = 0, cod = false } = {}) => {
  pricing = pricing || {};
  const premium = money(pricing.sameDayPremium ?? (Number(pricing.sameDayFee || 0) + Number(pricing.sameDayIncentive || 0)));
  const codFeeQuote = money(pricing.codFeeTotal ?? pricing.codFee?.codFeeTotal ?? 0);
  const codFee = cod ? codFeeQuote : 0;
  return {
    productTax: pricing.productTax,
    subtotal: pricing.productTax?.version === 'product-gst-v1' ? pricing.productTax.sellingPricePaise / 100 : money(pricing.subtotal),
    deliveryCharge: money(Math.max(0, Number(pricing.deliveryCharge || 0) - premium)),
    sameDayPremium: premium,
    couponDiscount: money(pricing.couponDiscount),
    tipAmount: money(tipAmount),
    codFee,
    codFeeQuote,
    codFeeLabel: pricing.codFeeDescription || pricing.codFee?.codFeeDescription || 'COD Handling Fee',
    totalAmount: money(Number(pricing.totalAmount || 0) + Number(tipAmount || 0) + codFee),
  };
};
