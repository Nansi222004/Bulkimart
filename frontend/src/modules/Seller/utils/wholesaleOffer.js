const whole = value => String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000;
export function validateWholesaleOffer(pricing, stock) {
  const errors = {};
  if (!pricing?.enabled) return errors;
  const moq=Number(pricing.minimumQuantity),increment=Number(pricing.quantityIncrement);
  if(!whole(pricing.minimumQuantity))errors.minimumQuantity='MOQ must be a whole number from 1 to 100,000';
  else if(!Number.isSafeInteger(Number(stock))||moq>Number(stock))errors.minimumQuantity='Available stock must meet the MOQ';
  if(!whole(pricing.quantityIncrement))errors.quantityIncrement='Increment must be a whole number from 1 to 100,000';
  if(!pricing.priceTiers?.length)errors.priceTiers='Add at least one price tier';
  let previousQuantity=0,previousPrice=Infinity;
  (pricing.priceTiers || []).forEach((tier,index)=>{
    const quantity=Number(tier.minimumQuantity),price=String(tier.unitPrice ?? '');
    if(!whole(tier.minimumQuantity)||quantity<moq||(quantity-moq)%increment!==0||quantity<=previousQuantity||(index===0&&quantity!==moq))errors[`tier.${index}.quantity`]='Use increasing thresholds aligned to MOQ + increments; the first starts at MOQ';
    // Validation only: prices remain decimal rupees in the API contract. Server
    // quotes and checkout continue to compute money using integer paise.
    const parts=price.split('.'),paise=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
    if(!/^\d+(\.\d{1,2})?$/.test(price)||!Number.isSafeInteger(paise)||paise<=0||paise>10000000||paise>previousPrice)errors[`tier.${index}.price`]='Use a positive price up to ₹1,00,000, at most two decimals, and no increase at higher tiers';
    previousQuantity=quantity;previousPrice=paise;
  });
  return errors;
}
export const offerPayload = pricing => pricing?.enabled ? { enabled:true, minimumQuantity:Number(pricing.minimumQuantity),quantityIncrement:Number(pricing.quantityIncrement),priceTiers:pricing.priceTiers.map(t=>({minimumQuantity:Number(t.minimumQuantity),unitPrice:Number(t.unitPrice)})) } : {enabled:false};
