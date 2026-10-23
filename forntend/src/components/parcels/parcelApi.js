import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
export const parcelMoney = n => `₹${((n || 0)/100).toFixed(2)}`;
export const parcelLabel = s => String(s || '').replaceAll('_',' ');
export const parcelHeaders = mode => ({Authorization:`Bearer ${localStorage.getItem(mode==='admin'?'adminToken':mode==='driver'?'deliveryToken':'userToken') || ''}`,'Content-Type':'application/json'});
export async function parcelRequest(mode,path,options={}) {
  const base=mode==='admin'?'/api/admin/parcel-delivery':mode==='driver'?'/api/delivery/parcels':'/api/parcel-delivery';
  const r=await boundedFetch(apiUrl(base+path),{...options,headers:{...parcelHeaders(mode),...options.headers}}), body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.message || 'Unable to load parcel delivery');
  return body;
}
export function parcelFormDetails(form) {
  const a=prefix=>Object.fromEntries(['address','name','phone','pincode','lat','lng'].map(k=>[k,['lat','lng'].includes(k)?Number(form.get(`${prefix}.${k}`)):form.get(`${prefix}.${k}`)]));
  return {pickup:a('pickup'),dropoff:a('dropoff'),category:form.get('category'),description:form.get('description'),weightKg:Number(form.get('weightKg')),dimensions:['length','width','height'].map(k=>Number(form.get(k))),instructions:form.get('instructions'),acceptRestrictions:form.get('restrictions')==='on'};
}
