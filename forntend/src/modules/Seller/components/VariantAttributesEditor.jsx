import React from 'react';

export default function VariantAttributesEditor({ value = [], onChange, disabled }) {
  const update = (index, key, next) => onChange(value.map((attribute, i) => i === index ? { ...attribute, [key]: next } : attribute));
  return <fieldset className="seller-offer-attributes" disabled={disabled}><legend>Variant attributes</legend>
    {value.map((attribute,index)=><div className="seller-offer-tier" key={index}>
      <label className="seller-offer-field">Attribute name<input className="onboarding-input" value={attribute.name} onChange={e=>update(index,'name',e.target.value)} required/></label>
      <label className="seller-offer-field">Attribute value<input className="onboarding-input" value={attribute.value} onChange={e=>update(index,'value',e.target.value)} required/></label>
      <button type="button" className="seller-products-button" aria-label={`Remove attribute ${index+1}`} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>×</button>
    </div>)}
    <button type="button" className="seller-products-button" onClick={()=>onChange([...value,{name:'',value:''}])}>Add attribute</button>
  </fieldset>;
}
