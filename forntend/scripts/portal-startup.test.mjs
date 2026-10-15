import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';

let vite, location, requests, Products, AdminGate, LocationModal, UserProvider, AdminProvider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  location = await vite.ssrLoadModule('/src/utils/locationState.js');
  requests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  Products = (await vite.ssrLoadModule('/src/modules/Admin/components/ProductsTab.jsx')).default;
  AdminGate = (await vite.ssrLoadModule('/src/components/AdminSessionGate.jsx')).default;
  LocationModal = (await vite.ssrLoadModule('/src/modules/User/components/LocationPromptModal.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  AdminProvider = (await vite.ssrLoadModule('/src/modules/Admin/context/AdminContext.jsx')).AdminProvider;
});
beforeEach(() => { for (const portal of ['customer','seller','delivery','admin']) requests.clearPortalRequests(portal); });
after(async () => vite.close());
const id = '507f1f77bcf86cd799439011';
const storage = initial => { const map = new Map(Object.entries(initial || {})); return { getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,String(value)), removeItem: key => map.delete(key) }; };
const stores = () => ({ localStorage: storage({ adminToken: 'admin-fixture', sellerToken: 'seller-fixture', userToken: 'buyer-fixture' }), sessionStorage: storage() });
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');

test('dedicated admin details fetch fresh metadata with only the admin credential and retain existing actions', async () => {
  const context = { productRoute: id, productRevision: 0, products: [], setSelectedProduct: value => { context.selectedProduct = value; } };
  const h = hookHarness(Products, { detailPage: true }, '/admin/products/' + id, context, stores());
  try {
    assert.equal(h.requests.length, 1); assert.match(h.requests[0].url, /\/api\/admin\/products\//);
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer admin-fixture');
    h.requests[0].resolve({ success: true, data: { _id: id, name: 'Fixture Ebook', status: 'pending', fulfillmentType: 'digital', digital: { author: 'Fixture author', file: { status: 'uploaded', sizeBytes: 512 } }, variants: [{ sku: 'FIXTURE-SKU', price: 100, stock: 2 }], sellerId: { businessName: 'Fixture Store' } } });
    await h.settle();
    assert.ok(h.find(n => n.props?.['aria-label'] === 'Product details'));
    assert.match(text(h.tree), /Fixture Ebook|Fixture author/); assert.match(text(h.tree), /FIXTURE-SKU/);
    assert.match(text(h.tree), /Approve listing/); assert.match(text(h.tree), /Back to Products/);
    assert.equal(h.find(n => n.type === 'iframe'), undefined);
    assert.doesNotMatch(text(h.tree), /View PDF|Download PDF/);
  } finally { h.close(); }
});

test('admin details fail safely on denied API and expose a retry without cached product data', async () => {
  const context = { productRoute: id, products: [], setSelectedProduct: value => { context.selectedProduct = value; } };
  const h = hookHarness(Products, { detailPage: true }, '/admin/products/' + id, context, stores());
  try { h.requests[0].resolve({ message: 'Product unavailable' },404); await h.settle(); assert.match(text(h.tree), /Product unavailable/); assert.equal(context.selectedProduct, null); assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Retry product details')); }
  finally { h.close(); }
});

test('admin navigation records a stable product path and restores it through browser history', () => {
  const h = hookHarness(AdminProvider, {}, '/admin/products/' + id, undefined, stores());
  try {
    assert.equal(h.tree.props.value.productRoute, id);
    h.tree.props.value.openAdminProduct(id); h.flush(); assert.equal(window.location.pathname, '/admin/products/' + id);
    h.tree.props.value.closeAdminProduct(); h.flush(); assert.equal(window.location.pathname, '/admin/products');
    window.history.pushState(null,'','/admin/products/' + id); window.dispatchEvent(new Event('popstate')); h.flush();
    assert.equal(h.tree.props.value.productRoute, id);
  } finally { h.close(); }
});

test('admin gate is fail-closed while pending and rejects a wrong-portal identity', async () => {
  let invalid = 0;
  const h = hookHarness(AdminGate, { token: 'admin-fixture', onInvalid: () => invalid++, children: React.createElement('main') }, '/admin', undefined, stores());
  try { assert.equal(h.find(n => n.type === 'main'), undefined); h.requests[0].resolve({ success: true, userType: 'user', profile: { _id: id } }); await h.settle(); assert.equal(invalid, 1); assert.equal(h.find(n => n.type === 'main'), undefined); }
  finally { h.close(); }
});

test('admin verification failure is recoverable and success alone mounts protected content', async () => {
  const h = hookHarness(AdminGate, { token: 'admin-fixture', onInvalid: () => {}, children: React.createElement('main') }, '/admin', undefined, stores());
  try {
    h.requests[0].resolve({},500); await h.settle(); assert.match(text(h.tree), /Unable to verify/);
    h.click('Retry verification'); h.requests.at(-1).resolve({ success: true, userType: 'admin', profile: { _id: id } }); await h.settle();
    assert.ok(h.find(n => n.type === 'main'));
  } finally { h.close(); }
});

test('session and profile requests deduplicate by portal/token/path and failures do not poison retry', async () => {
  const h = hookHarness(() => null, {}, '/', undefined, stores());
  try {
    const first = requests.portalRequest('seller','seller-fixture','/api/sellers/me',{ cacheMs:1000 });
    const second = requests.portalRequest('seller','seller-fixture','/api/sellers/me',{ cacheMs:1000 });
    assert.equal(h.requests.length,1); h.requests[0].resolve({ success:true }); await Promise.all([first,second]);
    await requests.portalRequest('seller','seller-fixture','/api/sellers/me',{ cacheMs:1000 }); assert.equal(h.requests.length,1);
    const separate = requests.portalRequest('customer','buyer-fixture','/api/auth/me'); assert.equal(h.requests.length,2);
    h.requests[1].resolve({},500); await separate;
    const retry = requests.portalRequest('customer','buyer-fixture','/api/auth/me'); assert.equal(h.requests.length,3); h.requests[2].resolve({}); await retry;
  } finally { h.close(); }
});

test('request timeout and explicit session cancellation settle without automatic retries', async () => {
  const h = hookHarness(() => null, {}, '/', undefined, stores());
  try {
    await assert.rejects(requests.portalRequest('seller','seller-fixture','/api/auth/me',{timeoutMs:10}), /timed out|abort/i);
    const pending = requests.portalRequest('admin','admin-fixture','/api/auth/me'); requests.clearPortalRequests('admin');
    await assert.rejects(pending,/Session changed/); assert.equal(h.requests.length,2);
  } finally { h.close(); }
});

test('response-body stalls are bounded and cancellation of an old request cannot evict its replacement', async () => {
  const h = hookHarness(() => null, {}, '/', undefined, stores());
  try {
    const old = requests.portalRequest('seller','seller-fixture','/api/auth/me');
    const rejected = assert.rejects(old,/Session changed/);
    requests.clearPortalRequests('seller');
    const replacement = requests.portalRequest('seller','seller-fixture','/api/auth/me');
    await rejected;
    const subscriber = requests.portalRequest('seller','seller-fixture','/api/auth/me');
    assert.equal(h.requests.length,2); h.requests[1].resolve({}); await Promise.all([replacement,subscriber]);
    globalThis.fetch = async () => ({ clone: () => ({ arrayBuffer: () => new Promise(() => {}) }) });
    await assert.rejects(requests.portalRequest('admin','admin-fixture','/api/auth/me',{timeoutMs:10}),/timed out/);
  } finally { h.close(); }
});

test('location state separates dismissal, valid coordinates, denied permission and stale data', () => {
  const h = hookHarness(() => null, {}, '/', undefined, { localStorage:storage(),sessionStorage:storage() });
  try {
    assert.equal(location.shouldPromptForLocation(),true);
    location.rememberLocationChoice('dismissed'); assert.equal(location.shouldPromptForLocation(),false);
    location.saveBrowsingLocation('Fixture area',{lat:19,lng:72},'gps'); assert.deepEqual(location.readBrowsingLocation().coords,{lat:19,lng:72});
    location.revokeBrowsingGps(); assert.equal(location.readBrowsingLocation(),null); assert.equal(location.shouldPromptForLocation(),false);
    location.saveBrowsingLocation('Manual fixture',null,'manual'); assert.equal(location.readBrowsingLocation().coords,null);
    assert.throws(() => location.saveBrowsingLocation('invalid',{lat:999,lng:0},'gps'),/Invalid/);
    sessionStorage.setItem('bulkimart:browsing-location',JSON.stringify({label:'stale',coords:{lat:19,lng:72},at:1})); assert.equal(location.readBrowsingLocation(),null);
  } finally { h.close(); }
});

test('actual customer provider remembers location dismissal across refresh without issuing GPS requests', () => {
  const data = { localStorage:storage(),sessionStorage:storage() };
  let h = hookHarness(UserProvider, {}, '/', {verified:false}, data);
  try { assert.equal(h.tree.props.value.showLocationModal,true); h.tree.props.value.setShowLocationModal(false); h.flush(); assert.equal(h.tree.props.value.showLocationModal,false); }
  finally { h.close(); }
  h = hookHarness(UserProvider, {}, '/', {verified:false}, data);
  try { assert.equal(h.tree.props.value.showLocationModal,false); h.tree.props.value.setShowLocationModal(true); h.flush(); assert.equal(h.tree.props.value.showLocationModal,true); }
  finally { h.close(); }
});

test('GPS is requested only by a click; denial enables manual entry and failed lookup stays retryable', async () => {
  const previousDocument = globalThis.document, previousNavigator = Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const events = new EventTarget(); let gpsCalls = 0, failure;
  globalThis.document = { activeElement:null,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events) };
  Object.defineProperty(globalThis,'navigator',{ configurable:true,value:{geolocation:{ getCurrentPosition(_success,fail) {gpsCalls++;failure=fail;} }} });
  const h = hookHarness(LocationModal,{},'/',{showLocationModal:true,setShowLocationModal:()=>{},lookupTypedLocation:async()=>({ok:false,message:'Try another area'})},{localStorage:storage(),sessionStorage:storage()});
  try {
    assert.equal(gpsCalls,0);
    h.find(n=>n.type==='button'&&text(n).includes('Allow Location Access')).props.onClick();h.flush();assert.equal(gpsCalls,1);
    failure({code:1});h.flush();assert.equal(location.shouldPromptForLocation(),false);
    const input=h.find(n=>n.type==='input');input.props.onChange({target:{value:'Fixture location'}});h.flush();
    await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.flush();assert.match(text(h.tree),/Try another area/);
  } finally { h.close(); globalThis.document=previousDocument;Object.defineProperty(globalThis,'navigator',previousNavigator); }
});
