import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
export const parcelMoney = n => `₹${((n || 0)/100).toFixed(2)}`;
export const parcelLabel = s => String(s || '').replaceAll('_',' ');
export const parcelHeaders = mode => ({Authorization:`Bearer ${localStorage.getItem(mode==='admin'?'adminToken':mode==='driver'?'deliveryToken':'userToken') || ''}`,'Content-Type':'application/json'});
const coordinatePresent = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
export const validParcelLocation = value => coordinatePresent(value?.lat) && coordinatePresent(value?.lng) && Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lng)) <= 180;
export async function parcelLocationLookup(mode, direction, values, signal) {
  const response = await boundedFetch(apiUrl(`/api/geo/${direction}?${new URLSearchParams(values)}`), { headers: parcelHeaders(mode), signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.data) throw new Error(body.message || 'Address lookup is unavailable. Try current location or a saved address.');
  return body.data;
}
export async function parcelRequest(mode,path,options={}) {
  const base=mode==='admin'?'/api/admin/parcel-delivery':mode==='driver'?'/api/delivery/parcels':'/api/parcel-delivery';
  const r=await boundedFetch(apiUrl(base+path),{...options,headers:{...parcelHeaders(mode),...options.headers}}), body=await r.json().catch(()=>({}));
  if(!r.ok || body.success === false) { const error = new Error(body.message || 'Unable to load parcel delivery'); error.status = r.status; throw error; }
  return body;
}
export async function saveParcelPickup(address) {
  const response = await boundedFetch(apiUrl('/api/users/addresses'), { method: 'POST', headers: parcelHeaders('customer'), body: JSON.stringify({ label: address.label || 'Other', line1: [address.building, address.address, address.landmark].filter(Boolean).join(', '), pincode: address.pincode, lat: Number(address.lat), lng: Number(address.lng), locationSource: 'manual' }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || 'Your pickup address could not be saved. Please retry.');
  return body;
}
export function parcelFormDetails(form) {
  const a=prefix=>{
    const point={lat:form.get(`${prefix}.lat`),lng:form.get(`${prefix}.lng`)};
    if(!validParcelLocation(point))throw new Error(`Select the ${prefix==='pickup'?'pickup':'drop-off'} location using address search, current location or a saved address.`);
    return Object.fromEntries(['address','name','phone','pincode','lat','lng'].map(k=>[k,['lat','lng'].includes(k)?Number(form.get(`${prefix}.${k}`)):form.get(`${prefix}.${k}`)]));
  };
  return {pickup:a('pickup'),dropoff:a('dropoff'),category:form.get('category'),description:form.get('description'),weightKg:Number(form.get('weightKg')),dimensions:['length','width','height'].map(k=>Number(form.get(k))),instructions:form.get('instructions'),acceptRestrictions:form.get('restrictions')==='on'};
}
