import React from 'react';
export default function AdvertisingBillingPolicyEditor({value,onChange}){
  const set=(key,next)=>onChange({...value,[key]:next});
  const selects={taxTreatment:['NONE','INCLUSIVE','EXCLUSIVE'],taxRecognition:['ON_RECEIPT'],invoiceMode:['NOT_REQUIRED','EXTERNAL_REFERENCE'],creditNoteMode:['NOT_REQUIRED','EXTERNAL_REFERENCE'],startCondition:['VERIFIED_PAYMENT_OR_REQUESTED_START'],interruption:['STOP_AND_REVIEW'],recognition:['MANUAL_AFTER_COMPLETION']};
  return <fieldset><legend>Approved operational billing policy</legend>
    <p>Enter only finance-approved values. No tax rate, entitlement or issuer is supplied by the application. Saving this package still requires separate financial authorization for each campaign.</p>
    <label><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked?{}:undefined)}/>Configure an approved structured policy</label>
    {value&&<>
      {['approvalReference','issuer'].map(key=><label key={key}>{key}<input required maxLength={200} value={value[key]||''} onChange={e=>set(key,e.target.value)}/></label>)}
      {Object.entries(selects).map(([key,options])=><label key={key}>{key}<select required value={value[key]||''} onChange={e=>set(key,e.target.value)}><option value="">Select approved rule</option>{options.map(option=><option key={option}>{option}</option>)}</select></label>)}
      <label>Approved tax rate (basis points; 100 basis points = 1%)<input required type="number" min="0" max="10000" step="1" value={value.taxRateBps??''} onChange={e=>set('taxRateBps',e.target.value===''?undefined:Number(e.target.value))}/></label>
      {['cancellationBps','suspensionBps','unavailableBps','unusedBps'].map(key=><label key={key}>Maximum refund {key} (basis points)<input required type="number" min="0" max="10000" step="1" value={value.refunds?.[key]??''} onChange={e=>set('refunds',{...value.refunds,[key]:e.target.value===''?undefined:Number(e.target.value)})}/></label>)}
    </>}
  </fieldset>;
}
