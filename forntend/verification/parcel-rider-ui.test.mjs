import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Operations,Updates,summarize;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Operations=(await vite.ssrLoadModule('/src/components/parcels/ParcelOperations.jsx')).ParcelDriverOperations;const updates=await vite.ssrLoadModule('/src/components/parcels/ParcelUpdates.jsx');Updates=updates.default;summarize=updates.summarizeParcelUpdates;});
after(async()=>await vite?.close());
const id='507f1f77bcf86cd799439022';
const booking={_id:id,reference:'PD-507F1F77BCF86CD799439022',version:4,status:'driver_assigned',paymentMethod:'online',paymentStatus:'paid',feePaise:2040,finance:{held:true,earningPaise:1020},details:{pickup:{name:'Sender',address:'Pickup street',phone:'9876500011',lat:22.74,lng:75.84},dropoff:{name:'Recipient',address:'Delivery street',lat:22.75,lng:75.85}},cash:{status:'not_applicable'},history:[]};
async function reply(h,data,status=200){h.requests.at(-1).resolve({data,meta:{pages:1}},status);await h.settle();}
test('rider sees the next step, earnings and clear paid-online instructions',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{await reply(h,booking);const output=renderToStaticMarkup(h.tree);for(const text of ['Parcel #439022','Start pickup','You earn','₹10.20','Paid online · Do not collect cash','Call sender','Need help with this delivery?'])assert.ok(output.includes(text),text);for(const text of ['driver assigned','Cash not applicable','Held for finance review','Pickup or delivery exception'])assert.ok(!output.includes(text),text);
    h.click('Start pickup');assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),{action:'driver_arriving',version:4});await reply(h,booking);await reply(h,{...booking,status:'driver_arriving'});
  }finally{h.close();}
});
test('cash at pickup is recorded before pickup confirmation; online payments never request cash',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{await reply(h,{...booking,status:'arrived_at_pickup',paymentMethod:'pay_driver',paymentStatus:'cash_due',cashCollectionPoint:'pickup',cash:{status:'outstanding'}});
    assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Confirm pickup').props.disabled,true);
    h.find(n=>n.type==='button'&&[n.props.children].flat().join('')==='I received ₹20.40 cash').props.onClick();h.rerender();assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),{action:'collect_cash',version:4,amountPaise:2040});await reply(h,booking);await reply(h,{...booking,status:'arrived_at_pickup'});
    assert.equal(h.find(n=>n.type==='button'&&n.props.children==='Confirm pickup').props.disabled,false);assert.ok(!renderToStaticMarkup(h.tree).includes('I received ₹20.40 cash'));
  }finally{h.close();}
});
test('pickup code uses the existing proof API with the current booking version',async()=>{
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id),original=globalThis.FormData;
  try{await reply(h,{...booking,status:'arrived_at_pickup'});const code=h.find(n=>n.type==='input'&&n.props.name==='code');assert.equal(code.props.pattern,'[0-9]{6}');assert.equal(code.props.inputMode,'numeric');globalThis.FormData=class{get(){return '123456';}};h.find(n=>n.props?.className==='parcel-rider-code-form').props.onSubmit({preventDefault(){},currentTarget:{}});h.rerender();assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),{action:'verify_pickup',version:4,code:'123456'});await reply(h,booking);await reply(h,{...booking,status:'picked_up'});assert.ok(h.find(n=>n.props?.children==='Start delivery'));}finally{globalThis.FormData=original;h.close();}
});
test('customer and rider history groups repeated matching attempts and hides code-request noise',()=>{
  const events=[{action:'terms_accepted',status:'payment_pending',at:'2026-10-25T10:00:00Z'},{action:'payment_initiated',status:'payment_pending',at:'2026-10-25T10:00:01Z'},{action:'payment_verified',status:'searching_for_driver',at:'2026-10-25T10:01:00Z'},{action:'automatic_offer',status:'searching_for_driver',at:'2026-10-25T10:01:01Z'},{action:'admin_fallback',status:'needs_admin_assignment',at:'2026-10-25T10:02:00Z'},{action:'manual_offer',status:'searching_for_driver',at:'2026-10-25T10:03:00Z'},{action:'offer_accepted',status:'driver_assigned',at:'2026-10-25T10:04:00Z'},{action:'driver_arriving',status:'driver_arriving',at:'2026-10-25T10:05:00Z'},{action:'arrived_at_pickup',status:'arrived_at_pickup',at:'2026-10-25T10:06:00Z'},{action:'pickup_code',status:'arrived_at_pickup',at:'2026-10-25T10:06:01Z'}];
  const updates=summarize(events);assert.equal(updates.filter(e=>e.title==='Finding a delivery partner').length,1);assert.equal(updates.length,6);assert.ok(updates.some(e=>e.title==='Payment confirmed'));assert.ok(!updates.some(e=>e.title==='Payment started'));assert.equal(updates.at(-1).title,'Arrived at pickup');
  const output=renderToStaticMarkup(React.createElement(Updates,{events}));assert.ok(output.includes('Earlier updates (2)'));assert.ok(output.includes('Most recent first'));assert.ok(!output.includes('Complete your payment'));assert.ok(!output.includes('pickup_code'));
});
test('the sender’s pickup note and parcel contents are shown on the assigned task',async()=>{
  const withNote={...booking,details:{...booking.details,category:'test_documents',description:'Two signed contracts',weightKg:1.5,dimensions:[30,20,2],instructions:'Ring the bell twice — gate code 4512'}};
  const h=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{await reply(h,withNote);const output=renderToStaticMarkup(h.tree);for(const text of ['Pickup note from the sender','Ring the bell twice — gate code 4512','Two signed contracts','test documents','1.5 kg · 30 × 20 × 2 cm'])assert.ok(output.includes(text),text);}finally{h.close();}
  const plain=hookHarness(Operations,{},'/delivery/parcels?parcel='+id);
  try{await reply(plain,booking);assert.ok(renderToStaticMarkup(plain.tree).includes('No pickup note was added.'));}finally{plain.close();}
});
