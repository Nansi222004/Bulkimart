import React,{useState} from 'react';
import ParcelLocationPicker from './ParcelLocationPicker';
import { validParcelLocation } from './parcelApi';
import useUrlState from '../../utils/useUrlState';
const fieldGroups=[
  {title:'Customer delivery charges',fields:[
    ['basePaise','Starting delivery fee (₹)','The fixed charge for every delivery. Covers the included kilometres below.'],
    ['includedKm','Kilometres included in the starting fee','Example: 3 means the first 3 km cost only the starting fee. 0 = distance is charged from the first metre.'],
    ['perKmPaise','Charge per km after the last slab (₹)','Used beyond the last distance slab (or for the whole distance if you add no slabs).'],
    ['handlingFeePaise','Handling fee per booking (₹)','A fixed Bulkimart fee added to every booking. 0 for none.'],
    ['minimumPaise','Lowest delivery fee (₹)','The customer pays at least this amount.'],
    ['maximumPaise','Highest delivery fee (₹)','Bookings above this amount are not accepted.'],
    ['taxRateBps','Tax included in the fee (%)','Enter 0 for your local test. Enter 18 for 18%.'],
  ]},
  {title:'Driver earnings',fields:[
    ['driverBasePaise','Starting driver earning (₹)','The fixed amount the driver earns for a completed delivery, covering the included kilometres.'],
    ['driverPerKmPaise','Driver earning per km after the last slab (₹)','Used beyond the last distance slab (or for the whole distance if you add no slabs).'],
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
  ['acceptanceSeconds','Time to accept each broadcast (minutes)','All eligible nearby drivers receive the offer. The first driver to accept gets the parcel.'],
  ['maxAttempts','Maximum offer rounds','If nobody accepts, broadcast again to eligible drivers who have not rejected. After these rounds, an admin needs to assign a driver.'],
  ['locationMaxAgeSeconds','Driver location must be updated within (minutes)','Only drivers with a recent location update receive offers. For example, 5 means within the last 5 minutes.'],
];
const numericFields=[...fieldGroups.flatMap(group=>group.fields),...matchingFields];
const optionalFields=['includedKm','handlingFeePaise'];
// Rupees on screen, paise in the policy.
const toRupees=p=>p==null||p===''?'':p/100;
const toPaise=r=>r===''||r==null?r:Math.round(Number(r)*100);
const slabsFromConfig=config=>(config?.distanceSlabs||[]).map(s=>({upToKm:s.upToKm,perKm:toRupees(s.perKmPaise),driverPerKm:toRupees(s.driverPerKmPaise),_key:crypto.randomUUID()}));
const tiersFromConfig=config=>(config?.weightTiers||[]).map(t=>({aboveKg:t.aboveKg,surcharge:toRupees(t.surchargePaise),driverShare:toRupees(t.driverPaise),_key:crypto.randomUUID()}));
// Vehicles customers choose on the Select vehicle screen. Each one is matched to rider vehicle types.
export const RIDER_VEHICLE_TYPES=[['bicycle','Bicycle'],['bike','Bike'],['auto','Auto'],['car','Car']];
const vehicleMoney=[['basePaise','Starting fare (₹)'],['includedKm','Km included in starting fare',false],['perKmPaise','Charge per km (₹)'],['minimumPaise','Lowest fare (₹)'],['driverBasePaise','Driver starting earning (₹)'],['driverPerKmPaise','Driver earning per km (₹)']];
const vehiclesFromConfig=config=>(config?.vehicles||[]).map(v=>({...v,...Object.fromEntries(vehicleMoney.filter(([,,money])=>money!==false).map(([k])=>[k,toRupees(v[k])])),length:v.dimensionsCm?.[0]??'',width:v.dimensionsCm?.[1]??'',height:v.dimensionsCm?.[2]??'',_key:crypto.randomUUID()}));
const vehicleToConfig=v=>({id:String(v.id||'').trim().toLowerCase(),name:v.name,...(v.icon?{icon:v.icon}:{}),description:v.description||'',enabled:v.enabled!==false,riderVehicleTypes:v.riderVehicleTypes||[],maxWeightKg:Number(v.maxWeightKg),dimensionsCm:[v.length,v.width,v.height].map(Number),includedKm:v.includedKm===''||v.includedKm==null?0:Number(v.includedKm),...Object.fromEntries(vehicleMoney.filter(([,,money])=>money!==false).map(([k])=>[k,toPaise(v[k])]))});
// Choosing a picture ticks the partner vehicle that matches it (still editable). Van and truck have no
// matching partner vehicle yet, so they leave the ticks as they are.
export const PICTURE_RIDER_TYPES={bike:['bike'],scooter:['bike'],auto:['auto'],car:['car']};
// A new vehicle starts with nothing ticked: the admin picks a picture (which ticks its partners) or ticks them.
const newVehicle=()=>({id:'',name:'',description:'',enabled:true,riderVehicleTypes:[],maxWeightKg:20,length:40,width:40,height:40,basePaise:'',includedKm:0,perKmPaise:'',minimumPaise:'',driverBasePaise:'',driverPerKmPaise:'',_key:crypto.randomUUID()});
// Settings are one form shown a section at a time; Save still sends every section.
const SECTIONS=[['charges','Charges'],['vehicles','Vehicles'],['areas','Service areas'],['matching','Driver matching'],['rules','Payment & rules']];
const minuteFields=['quoteSeconds','acceptanceSeconds','locationMaxAgeSeconds'];
const matchingDefaults={quoteSeconds:300,acceptanceSeconds:120,maxAttempts:3,locationMaxAgeSeconds:300,assignmentRadiusKm:5};
const listFields=[['categories','Parcel types we deliver'],['prohibitedItems','Items we do not deliver'],['payDriverCategories','Parcel types eligible for cash payment']];
const fieldScale=key=>key.endsWith('Paise')||key==='taxRateBps'?100:minuteFields.includes(key)?60:1;
const displayConfig=config=>({...config,...Object.fromEntries(numericFields.filter(([key])=>fieldScale(key)!==1&&config?.[key]!=null).map(([key])=>[key,config[key]/fieldScale(key)]))});
const list=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
// The editor is rebuilt after every save (one per settings version). This lets the new editor say "Saved"
// next to the button.
let savedFromVersion=null;
export default function ParcelPolicyEditor({value,onSave,busy}) {
  const [error,setError]=useState('');
  const [c,setC]=useState(()=>({...displayConfig({...matchingDefaults,...value?.config}),areas:(value?.config?.areas||[]).map(a=>({...a,_locationKey:crypto.randomUUID()}))})),[lists,setLists]=useState(Object.fromEntries(listFields.map(([k])=>[k,(value?.config?.[k]||[]).join('\n')])));
  const [boost,setBoost]=useState(()=>({enabled:value?.config?.boostEnabled===true,options:(value?.config?.boostOptionsPaise||[2000,3000,5000,8000,10000]).map(p=>p/100).join(', '),sharePct:(value?.config?.boostDriverShareBps??10000)/100,max:(value?.config?.maxBoostPaise??20000)/100}));
  const [slabs,setSlabs]=useState(()=>slabsFromConfig(value?.config)),[tiers,setTiers]=useState(()=>tiersFromConfig(value?.config));
  const [vehicles,setVehicles]=useState(()=>vehiclesFromConfig(value?.config)),[customerCancel,setCustomerCancel]=useState(value?.config?.customerCancel||'instant_before_assignment');
  const vehicle=(i,k,v)=>setVehicles(rows=>rows.map((r,n)=>n===i?{...r,[k]:v}:r));
  // The open settings tab is in the URL (?section=vehicles): it survives both a page refresh and the
  // editor being rebuilt after a save.
  const [section,setSection]=useUrlState('section','charges',SECTIONS.map(([id])=>id));
  // Shown only when this editor replaced the one that saved (its version is newer).
  const [justSaved]=useState(()=>{const saved=savedFromVersion!=null&&(value?.version||0)>savedFromVersion;savedFromVersion=null;return saved;});
  const set=(k,v)=>setC(old=>({...old,[k]:v}));
  const slab=(i,k,v)=>setSlabs(rows=>rows.map((r,n)=>n===i?{...r,[k]:v}:r));
  const tier=(i,k,v)=>setTiers(rows=>rows.map((r,n)=>n===i?{...r,[k]:v}:r));
  const num=v=>v===''?'':Number(v);
  const area=(index,k,v)=>set('areas',(c.areas||[]).map((a,i)=>i===index?{...a,[k]:v}:a));
  const renderNumber=([k,title,help])=><label key={k}>{title}<input name={k} required={!optionalFields.includes(k)} type="number" step={minuteFields.includes(k)?'any':fieldScale(k)!==1||['maxWeightKg','maxDimensionCm','maxRouteKm','assignmentRadiusKm','includedKm'].includes(k)?'0.01':'1'} min={k==='quoteSeconds'||k==='locationMaxAgeSeconds'?0.5:k==='acceptanceSeconds'?0.25:k==='maxAttempts'?1:0} max={k==='taxRateBps'?100:k==='quoteSeconds'||k==='locationMaxAgeSeconds'?60:k==='acceptanceSeconds'?10:k==='maxAttempts'?20:undefined} value={c[k]??''} onChange={e=>set(k,e.target.value===''?'':Number(e.target.value))}/><small>{help}</small></label>;
  return <form className="parcel-card" onInvalidCapture={e=>{const sec=e.target.closest?.('[data-section]')?.dataset.section;if(sec&&sec!==section)setSection(sec);}} onSubmit={e=>{e.preventDefault();if((c.areas||[]).some(a=>!validParcelLocation(a))){setSection('areas');setError('Select the centre of each service area using address search or current location.');return;}setError('');savedFromVersion=value?.version||0;onSave({...c,...Object.fromEntries(numericFields.filter(([key])=>fieldScale(key)!==1).map(([key])=>[key,c[key]===''||c[key]==null?c[key]:Math.round(Number(c[key])*fieldScale(key))])),areas:c.areas?.map(({_locationKey,...a})=>a),includedKm:c.includedKm===''||c.includedKm==null?0:Number(c.includedKm),handlingFeePaise:c.handlingFeePaise===''||c.handlingFeePaise==null?0:Math.round(Number(c.handlingFeePaise)*100),distanceSlabs:slabs.map(r=>({upToKm:Number(r.upToKm),perKmPaise:toPaise(r.perKm),driverPerKmPaise:toPaise(r.driverPerKm)})),boostEnabled:boost.enabled,boostOptionsPaise:boost.options.split(',').map(v=>v.trim()).filter(Boolean).map(v=>Math.round(Number(v)*100)),boostDriverShareBps:Math.round(Number(boost.sharePct)*100),maxBoostPaise:Math.round(Number(boost.max)*100),weightTiers:tiers.map(r=>({aboveKg:Number(r.aboveKg),surchargePaise:toPaise(r.surcharge),driverPaise:toPaise(r.driverShare===''?0:r.driverShare)})),...Object.fromEntries(listFields.map(([k])=>[k,list(lists[k])])),vehicles:vehicles.map(vehicleToConfig),customerCancel,maxActiveTasks:1,taxTreatment:'inclusive',surcharges:tiers.length?'weight':'none',cancellationMode:'admin_review',failureMode:'admin_review',cashCollectionPoint:c.cashCollectionPoint||'delivery',partialCash:false,payDriverEnabled:c.payDriverEnabled===true});}}>
    <h2>Parcel pricing and driver settings · version {value?.version||0}</h2><p>Set delivery charges, service areas and driver matching rules. Enter amounts in rupees: 100 means ₹100. Taxes are included in the delivery fee.</p><p>Customer fee = starting fee (covers the included km) + each distance slab × its rate + any weight surcharge + handling fee, with the minimum fee applied. Quotes above the maximum are rejected. Driver earning = starting driver earning + each slab × its driver rate + the weight tier's driver share. Distance charges round up to the nearest paisa. Earnings are recorded after confirmed delivery and remain held for finance review.</p>
    {error&&<p role="alert" className="parcel-error">{error}</p>}
    <label>Policy note<input name="approvalReference" placeholder="e.g. Local parcel delivery test" aria-describedby="parcel-policy-note-help" required value={c.approvalReference||''} maxLength={500} onChange={e=>set('approvalReference',e.target.value)}/><small id="parcel-policy-note-help">Briefly explain why you are saving these settings. No special code is needed. This note is kept in the change history.</small></label><label>Start using these settings from<input type="datetime-local" required value={c.effectiveAt?new Date(new Date(c.effectiveAt).getTime()-new Date(c.effectiveAt).getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>set('effectiveAt',e.target.value?new Date(e.target.value).toISOString():'')}/></label>
    <nav className="parcel-settings-tabs" aria-label="Settings sections">{SECTIONS.map(([id,title])=><button type="button" key={id} className={section===id?'active':''} aria-current={section===id?'true':undefined} onClick={()=>setSection(id)}>{title}</button>)}</nav>
    <div data-section="charges" hidden={section!=='charges'}>
    {vehicles.length>0&&<p className="parcel-vehicle-help" role="note"><strong>You have vehicles set up, so each vehicle's own fare, driver earning, capacity and size are used instead of:</strong> starting fee, km included, charge per km, lowest fee, driver earnings, distance slabs, weight surcharge, and heaviest parcel / longest side. Still used for every booking: <strong>handling fee, highest delivery fee, tax and longest delivery distance</strong>. The rest only applies if you remove all vehicles (the single "Doorstep delivery" service).</p>}
    {fieldGroups.map(group=><fieldset key={group.title} className="parcel-settings-group"><legend>{group.title}</legend><div className="parcel-grid">{group.fields.map(renderNumber)}</div></fieldset>)}
    <fieldset className="parcel-settings-group"><legend>Distance slabs</legend><p>Each slab runs from the end of the previous one (or the included kilometres) up to its end distance. Example: included 3 km, then a slab up to 10 km at ₹10 (driver ₹8), then the rate after the last slab (₹8, driver ₹6) for longer trips.</p>
      {slabs.map((r,i)=><div className="parcel-grid" key={r._key}><label>Slab {i+1} ends at (km)<input type="number" required min="0.01" step="0.01" value={r.upToKm} onChange={e=>slab(i,'upToKm',num(e.target.value))}/></label><label>Customer charge per km (₹)<input type="number" required min="0" step="0.01" value={r.perKm} onChange={e=>slab(i,'perKm',num(e.target.value))}/></label><label>Driver earning per km (₹)<input type="number" required min="0" step="0.01" value={r.driverPerKm} onChange={e=>slab(i,'driverPerKm',num(e.target.value))}/></label><button type="button" onClick={()=>setSlabs(rows=>rows.filter((_,n)=>n!==i))}>Remove slab</button></div>)}
      <button type="button" disabled={slabs.length>=20} onClick={()=>setSlabs(rows=>[...rows,{upToKm:'',perKm:'',driverPerKm:'',_key:crypto.randomUUID()}])}>Add distance slab</button></fieldset>
    <fieldset className="parcel-settings-group"><legend>Weight surcharge</legend><p>A parcel heavier than a tier's weight pays that tier's surcharge (the highest matching tier applies). Part of it can go to the driver.</p>
      {tiers.map((r,i)=><div className="parcel-grid" key={r._key}><label>Heavier than (kg)<input type="number" required min="0" step="0.01" value={r.aboveKg} onChange={e=>tier(i,'aboveKg',num(e.target.value))}/></label><label>Surcharge (₹)<input type="number" required min="0" step="0.01" value={r.surcharge} onChange={e=>tier(i,'surcharge',num(e.target.value))}/></label><label>Driver share (₹)<input type="number" min="0" step="0.01" value={r.driverShare} onChange={e=>tier(i,'driverShare',num(e.target.value))}/></label><button type="button" onClick={()=>setTiers(rows=>rows.filter((_,n)=>n!==i))}>Remove tier</button></div>)}
      <button type="button" disabled={tiers.length>=20} onClick={()=>setTiers(rows=>[...rows,{aboveKg:'',surcharge:'',driverShare:0,_key:crypto.randomUUID()}])}>Add weight tier</button></fieldset>
    <fieldset className="parcel-settings-group"><legend>Fare boost (when no driver accepts)</legend><p>While nobody has accepted a cash booking, the customer can add one of these amounts to the fare. The new fare goes to nearby drivers straight away, including drivers who declined the lower fare. Cash bookings add the boost to the cash due; online-paid bookings pay it from the customer's Bulkimart wallet (they can top it up with Razorpay first).</p>
      <label><input type="checkbox" checked={boost.enabled} onChange={e=>setBoost(b=>({...b,enabled:e.target.checked}))}/>Let customers add to the fare</label>
      <div className="parcel-grid"><label>Boost amounts (₹, comma separated)<input value={boost.options} disabled={!boost.enabled} onChange={e=>setBoost(b=>({...b,options:e.target.value}))} placeholder="20, 30, 50, 80, 100"/><small>Up to 8 amounts, shown as buttons to the customer.</small></label>
      <label>Driver gets (% of each boost)<input type="number" min="0" max="100" step="0.01" value={boost.sharePct} disabled={!boost.enabled} onChange={e=>setBoost(b=>({...b,sharePct:e.target.value}))}/><small>100 = the whole boost goes to the driver.</small></label>
      <label>Maximum total boost per booking (₹)<input type="number" min="0" step="0.01" value={boost.max} disabled={!boost.enabled} onChange={e=>setBoost(b=>({...b,max:e.target.value}))}/><small>Customers cannot add more than this in total.</small></label></div></fieldset>
    </div>
    <div data-section="vehicles" hidden={section!=='vehicles'}>
    <fieldset className="parcel-settings-group parcel-vehicle-settings"><legend>Vehicles customers can choose</legend>
      <p className="parcel-vehicle-help">Each vehicle appears on the customer's Select vehicle screen with its own price. A booking is sent only to riders whose registered vehicle is ticked under "Riders who can carry it". With no vehicles, customers book the single "Doorstep delivery" service priced in Charges.</p>
      {vehicles.length===0&&<p className="parcel-vehicle-empty">No vehicles yet. Add one to show the Select vehicle screen to customers.</p>}
      {vehicles.map((r,i)=>{const move=to=>setVehicles(rows=>{const next=[...rows];[next[i],next[to]]=[next[to],next[i]];return next;});const field=([k,title,money])=><label key={k}>{title}<input type="number" required={money!==false} min={k==='minimumPaise'?0.01:0} step="0.01" value={r[k]??''} onChange={e=>vehicle(i,k,num(e.target.value))}/></label>;
        return <section key={r._key} className={'parcel-vehicle-card'+(r.enabled===false?' is-hidden':'')} aria-label={r.name||`Vehicle ${i+1}`}>
        <header className="parcel-vehicle-card-head">
          <span className="parcel-vehicle-number" aria-hidden="true">{i+1}</span>
          <div className="parcel-vehicle-title"><strong>{r.name||'New vehicle'}</strong><small>{[r.maxWeightKg?`${r.maxWeightKg} kg`:'',r.basePaise!==''&&r.basePaise!=null?`from ₹${r.basePaise}`:'',(r.riderVehicleTypes||[]).length?`riders: ${r.riderVehicleTypes.join(', ')}`:'no riders selected'].filter(Boolean).join(' · ')}</small></div>
          <label className="parcel-visible-toggle"><input type="checkbox" checked={r.enabled!==false} onChange={e=>vehicle(i,'enabled',e.target.checked)}/>{r.enabled!==false?'Visible to customers':'Hidden'}</label>
          <div className="parcel-vehicle-actions"><button type="button" className="parcel-mini" disabled={i===0} aria-label="Move up" title="Move up" onClick={()=>move(i-1)}>↑</button><button type="button" className="parcel-mini" disabled={i===vehicles.length-1} aria-label="Move down" title="Move down" onClick={()=>move(i+1)}>↓</button><button type="button" className="parcel-mini danger" onClick={()=>setVehicles(rows=>rows.filter((_,n)=>n!==i))}>Remove</button></div>
        </header>
        <h4>Details</h4>
        <div className="parcel-vehicle-grid"><label>Name shown to customers<input required maxLength={60} value={r.name} onChange={e=>vehicle(i,'name',e.target.value)} placeholder="2 Wheeler"/></label><label>Code<input required maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" value={r.id} onChange={e=>vehicle(i,'id',e.target.value)} placeholder="two_wheeler"/><small>Letters, numbers, - or _. Don't change once booked.</small></label><label>Picture<select value={r.icon||''} onChange={e=>{const icon=e.target.value;vehicle(i,'icon',icon);if(PICTURE_RIDER_TYPES[icon])vehicle(i,'riderVehicleTypes',PICTURE_RIDER_TYPES[icon]);}}><option value="">Match rider vehicle</option>{[['bike','Motorbike'],['scooter','Scooter'],['auto','Auto rickshaw'],['car','Car'],['van','Van'],['truck','Truck']].map(([k,t])=><option key={k} value={k}>{t}</option>)}</select></label><label className="wide">Short description<input maxLength={200} value={r.description||''} onChange={e=>vehicle(i,'description',e.target.value)} placeholder="Fleet includes all 2 wheeler vehicles"/></label></div>
        <h4>Capacity and load space</h4>
        <div className="parcel-vehicle-grid"><label>Capacity (kg)<input type="number" required min="0.01" max="5000" step="0.01" value={r.maxWeightKg} onChange={e=>vehicle(i,'maxWeightKg',num(e.target.value))}/></label>{['length','width','height'].map(k=><label key={k}>{k[0].toUpperCase()+k.slice(1)} (cm)<input type="number" required min="1" max="1000" step="1" value={r[k]} onChange={e=>vehicle(i,k,num(e.target.value))}/></label>)}</div>
        <h4>Customer fare</h4>
        <div className="parcel-vehicle-grid">{vehicleMoney.slice(0,4).map(field)}</div>
        <h4>Driver earning</h4>
        <div className="parcel-vehicle-grid">{vehicleMoney.slice(4).map(field)}</div>
        <h4>Riders who can carry it</h4>
        <div className="parcel-rider-chips" role="group" aria-label="Riders who can carry it">{RIDER_VEHICLE_TYPES.map(([type,title])=>{const on=(r.riderVehicleTypes||[]).includes(type);return <label key={type} className={'parcel-rider-chip'+(on?' on':'')}><input type="checkbox" checked={on} onChange={e=>vehicle(i,'riderVehicleTypes',e.target.checked?[...(r.riderVehicleTypes||[]),type]:(r.riderVehicleTypes||[]).filter(t=>t!==type))}/>{on?'✓ ':''}{title}</label>;})}</div>
        <small>Ticked automatically from the Picture you choose (Motorbike/Scooter → Bike, Auto rickshaw → Auto, Car → Car). You can tick more, e.g. Bicycle too for small parcels.</small>
        {['van','truck'].includes(r.icon)&&<small className="parcel-vehicle-warn">No partner can register a van or truck yet. Tick the partner vehicles that should take these bookings.</small>}
        {!(r.riderVehicleTypes||[]).length&&<small className="parcel-vehicle-warn">Tick at least one rider vehicle, or no rider will receive these bookings.</small>}
      </section>;})}
      <button type="button" className="parcel-add-vehicle" disabled={vehicles.length>=20} onClick={()=>setVehicles(rows=>[...rows,newVehicle()])}>+ Add vehicle</button></fieldset>
    </div>
    <div data-section="areas" hidden={section!=='areas'}>
    <h3>Where we deliver</h3><p role="status">Saved coverage · version {value?.version||0}: {(value?.config?.areas||[]).map(a=>a.name+": "+a.pincodes.join(", ")).join("; ") || "No areas saved"}. New or edited areas are inactive until you choose Save parcel settings.</p><p>Each pickup and drop needs an approved pincode and a pin inside that area's coverage circle. An area name such as Indore does not approve the whole city. Search or move the centre pin, confirm it, and set the radius below. Changes take effect only after saving parcel settings.</p>{(c.areas||[]).map((a,i)=><fieldset key={a._locationKey}><legend>Area {i+1}</legend><label>Area name<input required value={a.name||''} onChange={e=>area(i,'name',e.target.value)}/></label><label>Pincodes (comma separated)<input required value={(a.pincodes||[]).join(',')} onChange={e=>area(i,'pincodes',e.target.value.split(',').map(v=>v.trim()))}/></label><ParcelLocationPicker mode="admin" confirmLocation showMap areaMode radiusKm={a.radiusKm} idPrefix={"parcel-area-"+a._locationKey} value={a} initialQuery={a.name||''} label="Find the centre of this service area" onChange={point=>setC(old=>({...old,areas:old.areas.map((entry,index)=>index===i?{...entry,lat:point.lat,lng:point.lng}:entry)}))}/><div className="parcel-grid">{[['radiusKm','Radius (km)']].map(([k,title])=><label key={k}>{title}<input type="number" required min="0" max="100" step="any" value={a[k]??''} onChange={e=>area(i,k,e.target.value===''?'':Number(e.target.value))}/></label>)}</div><button type="button" onClick={()=>set('areas',c.areas.filter((_,n)=>n!==i))}>Remove area</button></fieldset>)}<button type="button" onClick={()=>set('areas',[...(c.areas||[]),{name:'',pincodes:[],_locationKey:crypto.randomUUID()}])}>Add service area</button>
    </div>
    <div data-section="matching" hidden={section!=='matching'}>
    <details className="parcel-settings-advanced" open><summary>Driver matching and time limits</summary><p>These settings are filled in for you. The suggested starting values are a 5-minute price, 2 minutes to accept an offer, and a driver location updated within the last 5 minutes.</p><div className="parcel-grid">{matchingFields.map(renderNumber)}</div></details>
    </div>
    <div data-section="rules" hidden={section!=='rules'}>
    <fieldset className="parcel-settings-group"><legend>Customer cancellation</legend>
      <label className="parcel-check"><input type="radio" name="customerCancel" checked={customerCancel==='instant_before_assignment'} onChange={()=>setCustomerCancel('instant_before_assignment')}/>Cancel instantly until a driver accepts (a paid fare is refunded to the Bulkimart wallet at once). After a driver accepts, an admin reviews the request.</label>
      <label className="parcel-check"><input type="radio" name="customerCancel" checked={customerCancel==='admin_review'} onChange={()=>setCustomerCancel('admin_review')}/>An admin reviews every cancellation request.</label></fieldset>
    {listFields.map(([k,title])=><label key={k}>{title} (one per line)<textarea required value={lists[k]} onChange={e=>setLists({...lists,[k]:e.target.value})}/></label>)}
    <label><input type="checkbox" checked={c.payDriverEnabled===true} onChange={e=>set('payDriverEnabled',e.target.checked)}/>Let customers pay cash to the driver at delivery</label>
    <label>Cash collection location<select name="cashCollectionPoint" value={c.cashCollectionPoint||"delivery"} onChange={e=>set("cashCollectionPoint",e.target.value)}><option value="delivery">Drop only · recipient pays</option><option value="pickup">Pickup only · sender pays</option><option value="customer_choice">Customer chooses pickup or drop</option></select><small>Applies to new cash bookings after saving. Update the customer terms to match. Online payment is completed before assignment.</small></label>
    <label>Delivery, cancellation and refund rules shown to customers<textarea required maxLength={10000} rows={8} value={c.terms||''} onChange={e=>set('terms',e.target.value)}/></label>
    </div>
    <p>This version supports one active task per driver, exact cash at the selected collection location, and admin review of failed deliveries. Partial cash collection is unavailable.</p><div className="parcel-save-row"><button disabled={busy}>Save parcel settings</button>{justSaved&&<span role="status" className="parcel-saved-note">✓ Saved · version {value?.version}</span>}</div>
  </form>;
}
