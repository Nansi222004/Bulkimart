import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Picker, Editor, Address, api;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Picker = (await vite.ssrLoadModule('/src/components/parcels/ParcelLocationPicker.jsx')).default;
  Editor = (await vite.ssrLoadModule('/src/components/parcels/ParcelPolicyEditor.jsx')).default;
  Address = (await vite.ssrLoadModule('/src/components/parcels/ParcelDelivery.jsx')).ParcelAddress;
  api = await vite.ssrLoadModule('/src/components/parcels/parcelApi.js');
});
after(async () => vite.close());
const content = h => JSON.stringify(h.tree, (_key, v) => typeof v === 'function' ? undefined : v);
const edit = (h, text) => { h.find(n => n.type === 'input').props.onChange({ target: { value: text } }); h.flush(); };
function picker(mode = 'customer') {
  const changes = [], props = { value: {}, mode, onChange(next) { props.value = next; changes.push(next); } };
  return { h: hookHarness(Picker, props), changes, props };
}
test('search previews a match, requires selection, and edits invalidate the old location', async () => {
  const { h, props } = picker();
  try {
    edit(h, 'MG Road Bengaluru'); h.click('Find address');
    assert.match(h.requests[0].url, /\/api\/geo\/forward\?q=MG\+Road\+Bengaluru/);
    h.requests[0].resolve({ data: { lat: 12.97, lng: 77.59, matched: 'MG Road, Bengaluru' } }); await h.settle();
    assert.equal(api.validParcelLocation(props.value), false);
    h.click('Use this location'); assert.equal(props.value.address, 'MG Road, Bengaluru');
    assert.equal(api.validParcelLocation(props.value), true);
    edit(h, 'Another city'); assert.equal(api.validParcelLocation(props.value), false);
  } finally { h.close(); }
});
test('a late search cannot overwrite newer address text or update an unmounted picker', async () => {
  const { h } = picker();
  try {
    edit(h, 'First street'); h.click('Find address'); const old = h.requests[0];
    edit(h, 'Second street'); old.resolve({ data: { lat: 12, lng: 77, matched: 'Old result' } }); await h.settle();
    assert.doesNotMatch(content(h), /Old result/); assert.equal(old.options.signal.aborted, true);
    h.click('Find address'); h.unmount(); const count = h.updates;
    h.requests[1].resolve({ data: { lat: 12, lng: 77 } }); await h.settle(); assert.equal(h.updates, count);
  } finally { h.close(); }
});
test('failed or malformed lookups never create a location', async () => {
  for (const [data, status] of [[null, 503], [{ lat: null, lng: 77 }, 200]]) {
    const { h, props } = picker('admin');
    try {
      edit(h, 'Test centre'); h.click('Find address'); h.requests[0].resolve({ data }, status); await h.settle();
      assert.ok(h.find(n => n.props?.role === 'alert')); assert.equal(api.validParcelLocation(props.value), false);
    } finally { h.close(); }
  }
});
test('GPS retains the location when reverse lookup fails and handles denied permission', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); let success, failure;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition(ok, fail) { success = ok; failure = fail; } } } });
  const { h, props } = picker();
  try {
    h.click('Use current location'); const pending = success({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 10 } });
    h.requests[0].resolve({}, 503); await pending; await h.settle();
    assert.equal(api.validParcelLocation(props.value), true); assert.match(content(h), /enter the street address/);
    h.click('Use current location'); failure({ code: 1 }); h.flush(); assert.match(content(h), /permission was denied/);
  } finally { h.close(); if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; }
});
test('saved customer addresses retain their location through hidden form fields', () => {
  const h = hookHarness(Address, { prefix: 'pickup', title: 'Pickup', addresses: [{ _id: 'saved', name: 'Test', line1: 'Saved street', pincode: '560001', lat: 12.97, lng: 77.59 }] });
  try {
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'saved' } }); h.flush();
    const lat = h.find(n => n.props?.name === 'pickup.lat'); assert.equal(lat.props.type, 'hidden'); assert.equal(lat.props.value, 12.97);
    assert.equal(h.find(n => n.props?.name === 'pickup.address').props.value, 'Saved street');
  } finally { h.close(); }
});
test('admin policy requires a selected area centre and exposes no coordinate inputs', () => {
  const saved = [], h = hookHarness(Editor, { onSave: c => saved.push(c) });
  try {
    h.click('Add service area'); h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.equal(saved.length, 0); assert.match(content(h), /Select the centre/);
    assert.doesNotMatch(content(h), /Centre latitude|Centre longitude/);
  } finally { h.close(); }
});

test('admin coverage maps have independent search controls and save confirmed pins without changing fares', () => {
  const saved = [], h = hookHarness(Editor, { value: { config: { basePaise: 1000, areas: [
    { name: 'First', pincodes: ['452006'], lat: 22.72, lng: 75.85, radiusKm: 10 },
    { name: 'Second', pincodes: ['452015'], lat: 22.73, lng: 75.86, radiusKm: 5 },
  ] } }, onSave: c => saved.push(c) });
  const pickers = () => {
    const found = [];
    const walk = n => { if (!n || typeof n !== 'object') return; if (n.type === Picker) found.push(n); [n.props?.children].flat(Infinity).forEach(walk); };
    walk(h.tree); return found;
  };
  try {
    const [first, second] = pickers();
    assert.equal(first.props.showMap, true); assert.equal(first.props.confirmLocation, true); assert.equal(first.props.areaMode, true);
    assert.equal(second.props.radiusKm, 5); assert.notEqual(first.props.idPrefix, second.props.idPrefix);
    second.props.onChange({ lat: 22.74, lng: 75.87 }); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(saved[0].areas[1].lat, 22.74); assert.equal(saved[0].areas[1].lng, 75.87);
    assert.equal(saved[0].areas[1].radiusKm, 5); assert.equal(saved[0].basePaise, 1000);
    assert.equal(saved[0].areas[1]._locationKey, undefined);
    assert.match(content(h), /approved pincode/);
    const status = h.find(n => n.props?.role === 'status');
    assert.match(JSON.stringify(status), /Saved coverage/);
    assert.match(JSON.stringify(status), /First: 452006; Second: 452015/);
    assert.match(JSON.stringify(status), /inactive until/);
  } finally { h.close(); }
});
test('missing hidden locations cannot silently become zero coordinates during quotation', () => {
  const form = new FormData(); form.set('pickup.lat', ''); form.set('pickup.lng', '');
  assert.throws(() => api.parcelFormDetails(form), /Select the pickup location/);
  assert.equal(api.validParcelLocation({ lat: 0, lng: 0 }), true);
  for (const lat of [null, '', ' ', false, undefined, 91]) assert.equal(api.validParcelLocation({ lat, lng: 77 }), false);
});
test('admin enters rupees and tax percentages while saved policy uses exact minor units', () => {
  const saved = [], h = hookHarness(Editor, { value: { config: { basePaise: 10000, perKmPaise: 250, minimumPaise: 10000, maximumPaise: 100000, driverBasePaise: 5000, driverPerKmPaise: 125, taxRateBps: 1800, areas: [] } }, onSave: c => saved.push(c) });
  const input = name => h.find(n => n.type === 'input' && n.props.name === name);
  try {
    assert.equal(input('basePaise').props.value, 100);
    assert.equal(input('perKmPaise').props.value, 2.5);
    assert.equal(input('taxRateBps').props.value, 18);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(saved[0].basePaise, 10000); assert.equal(saved[0].taxRateBps, 1800);
    input('basePaise').props.onChange({ target: { value: '125.50' } }); h.flush();
    input('driverPerKmPaise').props.onChange({ target: { value: '1.15' } }); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(saved[1].basePaise, 12550); assert.equal(saved[1].driverPerKmPaise, 115);
    assert.doesNotMatch(content(h), /\(paise\)|basis points/);
  } finally { h.close(); }
});
test('driver matching explains recent location updates and saves minutes as seconds', () => {
  const saved = [], h = hookHarness(Editor, { onSave: c => saved.push(c) });
  const input = name => h.find(n => n.type === 'input' && n.props.name === name);
  try {
    assert.equal(input('quoteSeconds').props.value, 5);
    assert.equal(input('acceptanceSeconds').props.value, 2);
    assert.equal(input('locationMaxAgeSeconds').props.value, 5);
    assert.match(content(h), /Driver location must be updated within \(minutes\)/);
    assert.match(content(h), /within the last 5 minutes/);
    assert.doesNotMatch(content(h), /Maximum driver location age/);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(saved[0].locationMaxAgeSeconds, 300);
    input('locationMaxAgeSeconds').props.onChange({ target: { value: '8' } }); h.flush();
    input('acceptanceSeconds').props.onChange({ target: { value: '1.5' } }); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(saved[1].locationMaxAgeSeconds, 480); assert.equal(saved[1].acceptanceSeconds, 90);
  } finally { h.close(); }
});

test('admin cash collection setting preserves legacy drop-only and explicitly enables customer choice', () => {
  const saved = [], h = hookHarness(Editor, { value: { config: { cashCollectionPoint: 'delivery', areas: [] } }, onSave: c => saved.push(c) });
  try {
    const field=()=>h.find(n=>n.props?.name==='cashCollectionPoint');
    assert.equal(field().props.value,'delivery');
    field().props.onChange({target:{value:'customer_choice'}});h.flush();
    h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(saved[0].cashCollectionPoint,'customer_choice');assert.match(content(h),/Driver earning = starting driver earning/);
  } finally { h.close(); }
});
