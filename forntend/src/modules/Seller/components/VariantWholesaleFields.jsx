import React from 'react';
import { validateWholesaleOffer } from '../utils/wholesaleOffer';

export default function VariantWholesaleFields({variant,index,onChange,disabled,eligible,allowUnsaved=false}) {
  const pricing=variant.wholesalePricing || {enabled:false}, errors=validateWholesaleOffer(pricing,variant.stock);
  const update=(key,value)=>onChange(index,current=>({...current,[key]:value}));
  const field=(key,label,value,onChangeField,props={})=><label className="seller-offer-field">{label}<input className="onboarding-input" type="number" min="1" step="1" value={value??''} disabled={disabled} aria-invalid={!!errors[key]} aria-describedby={errors[key]?`offer-${index}-${key}-error`:undefined} onChange={e=>onChangeField(e.target.value)} {...props}/>{errors[key]&&<span id={`offer-${index}-${key}-error`} className="seller-wholesale-errors" role="alert">{errors[key]}</span>}</label>;
  return <section className="seller-offer-fields" aria-label={`${variant.name || `Variant ${index+1}`} Wholesale settings`}>
    <label className="seller-offer-enabled"><input type="checkbox" disabled={disabled||(!eligible&&!pricing.enabled)||(!variant._id&&!allowUnsaved)} checked={!!pricing.enabled} onChange={e=>onChange(index,current=>({...current,enabled:e.target.checked,minimumQuantity:current.minimumQuantity||1,quantityIncrement:current.quantityIncrement||1,priceTiers:current.priceTiers?.length?current.priceTiers:[{minimumQuantity:current.minimumQuantity||1,unitPrice:''}]}))}/> Wholesale offer enabled</label>
    {!pricing.enabled && <p className="seller-products-hint">Enable this offer to set its minimum order, quantity increment and price tiers. Disabling keeps the product and its retail inventory available.</p>}
    {!variant._id&&!allowUnsaved&&<p>Save this variant first, then reopen the listing to configure its Wholesale offer.</p>}
    {!eligible&&<p role="status">An active approved physical product and category are required to enable offers.</p>}
    {pricing.enabled&&<div style={{display:'grid',gap:12,marginTop:12}}>
      {field('minimumQuantity','Minimum order quantity',pricing.minimumQuantity,value=>onChange(index,current=>({...current,minimumQuantity:value,priceTiers:(current.priceTiers||[]).map((t,i)=>i===0?{...t,minimumQuantity:value}:t)})))}
      {field('quantityIncrement','Quantity increment',pricing.quantityIncrement,value=>update('quantityIncrement',value))}
      <small>Shared available stock: {variant.stock}. Orders use MOQ plus multiples of the increment.</small>
      <h3>Quantity pricing tiers</h3>
      {(pricing.priceTiers||[]).map((tier,i)=><div key={i} className="seller-offer-tier">
        {field(`tier.${i}.quantity`,'From quantity',tier.minimumQuantity,value=>update('priceTiers',pricing.priceTiers.map((t,j)=>j===i?{...t,minimumQuantity:value}:t)))}
        {field(`tier.${i}.price`,'Unit price (₹)',tier.unitPrice,value=>update('priceTiers',pricing.priceTiers.map((t,j)=>j===i?{...t,unitPrice:value}:t)),{min:'0.01',step:'0.01'})}
        <button className="seller-products-button" type="button" disabled={disabled||pricing.priceTiers.length===1} aria-label={`Remove tier ${i+1}`} onClick={()=>update('priceTiers',pricing.priceTiers.filter((_,j)=>j!==i))}>×</button>
      </div>)}
      {errors.priceTiers&&<p role="alert">{errors.priceTiers}</p>}
      <button className="seller-products-button" type="button" disabled={disabled} onClick={()=>update('priceTiers',[...(pricing.priceTiers||[]),{minimumQuantity:pricing.priceTiers?.length?Number(pricing.priceTiers.at(-1).minimumQuantity)+Number(pricing.quantityIncrement||1):Number(pricing.minimumQuantity),unitPrice:''}])}>Add quantity tier</button>
    </div>}
  </section>;
}
