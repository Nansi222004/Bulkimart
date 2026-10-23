import React,{useState} from 'react';
import ParcelLocationPicker from './ParcelLocationPicker';
import { validParcelLocation } from './parcelApi';
const fieldGroups=[
  {title:'Customer delivery charges',fields:[
    ['basePaise','Starting delivery fee (₹)','The fixed charge for every delivery.'],
    ['perKmPaise','Charge for each kilometre (₹)','Added to the starting fee for the delivery distance.'],
    ['minimumPaise','Lowest delivery fee (₹)','The customer pays at least this amount.'],
    ['maximumPaise','Highest delivery fee (₹)','Bookings above this amount are not accepted.'],
    ['taxRateBps','Tax included in the fee (%)','Enter 0 for your local test. Enter 18 for 18%.'],
  ]},
  {title:'Driver earnings',fields:[
    ['driverBasePaise','Starting driver earning (₹)','The fixed amount the driver earns for a completed delivery.'],
    ['driverPerKmPaise','Driver earning for each kilometre (₹)','Added to the starting earning for the delivery distance.'],
  ]},
  {title:'Parcel limits',fields:[
    ['maxWeightKg','Heaviest parcel we accept (kg)','Example: 5 allows parcels weighing up to 5 kg.'],
    ['maxDimensionCm','Longest parcel side allowed (cm)','Each side of the parcel must fit within this limit.'],
    ['maxRouteKm','Longest delivery distance (km)','Bookings beyond this route distance are not accepted.'],
  ]},
];
const matchingFields=[
  ['assignmentRadiusKm','Look for drivers within (km)','How far from the pickup we look for an available driver.'],
  ['quoteSeconds','Keep the quoted price valid for (minutes)','The customer must confirm within this time, then request a new price.'],
  ['acceptanceSeconds','Give each driver this long to accept (minutes)','If the driver does not respond, the next eligible driver can be offered the parcel.'],
  ['maxAttempts','Number of drivers to try','After these offers, an admin needs to assign a driver.'],
  ['locationMaxAgeSeconds','Driver location must be updated within (minutes)','Only drivers with a recent location update receive offers. For example, 5 means within the last 5 minutes.'],
];
const numericFields=[...fieldGroups.flatMap(group=>group.fields),...matchingFields];
const minuteFields=['quoteSeconds','acceptanceSeconds','locationMaxAgeSeconds'];
const matchingDefaults={quoteSeconds:300,acceptanceSeconds:120,maxAttempts:3,locationMaxAgeSeconds:300,assignmentRadiusKm:5};
const listFields=[['categories','Parcel types we deliver'],['prohibitedItems','Items we do not deliver'],['payDriverCategories','Parcel types eligible for cash payment']];
const fieldScale=key=>key.endsWith('Paise')||key==='taxRateBps'?100:minuteFields.includes(key)?60:1;
const displayConfig=config=>({...config,...Object.fromEntries(numericFields.filter(([key])=>fieldScale(key)!==1&&config?.[key]!=null).map(([key])=>[key,config[key]/fieldScale(key)]))});
const list=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
export default function ParcelPolicyEditor({value,onSave,busy}) {
  const [error,setError]=useState('');
  const [c,setC]=useState(()=>({...displayConfig({...matchingDefaults,...value?.config}),areas:(value?.config?.areas||[]).map(a=>({...a,_locationKey:crypto.randomUUID()}))})),[lists,setLists]=useState(Object.fromEntries(listFields.map(([k])=>[k,(value?.config?.[k]||[]).join('\n')])));
  const set=(k,v)=>setC(old=>({...old,[k]:v}));
  const area=(index,k,v)=>set('areas',(c.areas||[]).map((a,i)=>i===index?{...a,[k]:v}:a));
  const renderNumber=([k,title,help])=><label key={k}>{title}<input name={k} required type="number" step={minuteFields.includes(k)?'any':fieldScale(k)!==1||['maxWeightKg','maxDimensionCm','maxRouteKm','assignmentRadiusKm'].includes(k)?'0.01':'1'} min={k==='quoteSeconds'||k==='locationMaxAgeSeconds'?0.5:k==='acceptanceSeconds'?0.25:k==='maxAttempts'?1:0} max={k==='taxRateBps'?100:k==='quoteSeconds'||k==='locationMaxAgeSeconds'?60:k==='acceptanceSeconds'?10:k==='maxAttempts'?20:undefined} value={c[k]??''} onChange={e=>set(k,e.target.value===''?'':Number(e.target.value))}/><small>{help}</small></label>;
  return <form className="parcel-card" onSubmit={e=>{e.preventDefault();if((c.areas||[]).some(a=>!validParcelLocation(a))){setError('Select the centre of each service area using address search or current location.');return;}setError('');onSave({...c,...Object.fromEntries(numericFields.filter(([key])=>fieldScale(key)!==1).map(([key])=>[key,c[key]===''||c[key]==null?c[key]:Math.round(Number(c[key])*fieldScale(key))])),areas:c.areas?.map(({_locationKey,...a})=>a),...Object.fromEntries(listFields.map(([k])=>[k,list(lists[k])])),maxActiveTasks:1,taxTreatment:'inclusive',surcharges:'none',cancellationMode:'admin_review',failureMode:'admin_review',cashCollectionPoint:'delivery',partialCash:false,payDriverEnabled:c.payDriverEnabled===true});}}>
    <h2>Parcel pricing and driver settings · version {value?.version||0}</h2><p>Set delivery charges, service areas and driver matching rules. Enter amounts in rupees: 100 means ₹100. Taxes are included in the delivery fee.</p>
    {error&&<p role="alert" className="parcel-error">{error}</p>}
    <label>Policy note<input name="approvalReference" placeholder="e.g. Local parcel delivery test" aria-describedby="parcel-policy-note-help" required value={c.approvalReference||''} maxLength={500} onChange={e=>set('approvalReference',e.target.value)}/><small id="parcel-policy-note-help">Briefly explain why you are saving these settings. No special code is needed. This note is kept in the change history.</small></label><label>Start using these settings from<input type="datetime-local" required value={c.effectiveAt?new Date(new Date(c.effectiveAt).getTime()-new Date(c.effectiveAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>set('effectiveAt',e.target.value?new Date(e.target.value).toISOString():'')}/></label>
    {fieldGroups.map(group=><fieldset key={group.title} className="parcel-settings-group"><legend>{group.title}</legend><div className="parcel-grid">{group.fields.map(renderNumber)}</div></fieldset>)}
    <details className="parcel-settings-advanced"><summary>Driver matching and time limits</summary><p>These settings are filled in for you. The suggested starting values are a 5-minute price, 2 minutes to accept an offer, and a driver location updated within the last 5 minutes.</p><div className="parcel-grid">{matchingFields.map(renderNumber)}</div></details>
    {listFields.map(([k,title])=><label key={k}>{title} (one per line)<textarea required value={lists[k]} onChange={e=>setLists({...lists,[k]:e.target.value})}/></label>)}
    <label><input type="checkbox" checked={c.payDriverEnabled===true} onChange={e=>set('payDriverEnabled',e.target.checked)}/>Let customers pay cash to the driver at delivery</label>
    <h3>Where we deliver</h3>{(c.areas||[]).map((a,i)=><fieldset key={a._locationKey}><legend>Area {i+1}</legend><label>Area name<input required value={a.name||''} onChange={e=>area(i,'name',e.target.value)}/></label><label>Pincodes (comma separated)<input required value={(a.pincodes||[]).join(',')} onChange={e=>area(i,'pincodes',e.target.value.split(',').map(v=>v.trim()))}/></label><ParcelLocationPicker mode="admin" value={a} initialQuery={a.name||''} label="Find the centre of this service area" onChange={point=>setC(old=>({...old,areas:old.areas.map((entry,index)=>index===i?{...entry,lat:point.lat,lng:point.lng}:entry)}))}/><div className="parcel-grid">{[['radiusKm','Radius (km)']].map(([k,title])=><label key={k}>{title}<input type="number" required step="any" value={a[k]??''} onChange={e=>area(i,k,e.target.value===''?'':Number(e.target.value))}/></label>)}</div><button type="button" onClick={()=>set('areas',c.areas.filter((_,n)=>n!==i))}>Remove area</button></fieldset>)}<button type="button" onClick={()=>set('areas',[...(c.areas||[]),{name:'',pincodes:[],_locationKey:crypto.randomUUID()}])}>Add service area</button>
    <label>Delivery, cancellation and refund rules shown to customers<textarea required maxLength={10000} rows={8} value={c.terms||''} onChange={e=>set('terms',e.target.value)}/></label>
    <p>This version supports one active task per driver, exact cash at delivery, and admin review of cancellations and failed delivery. Surcharges and partial cash collection are unavailable.</p><button disabled={busy}>Save parcel settings</button>
  </form>;
}
