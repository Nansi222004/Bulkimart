import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Flow, Picker, Map, domain, Price;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ default: Flow, ParcelPriceSummary: Price } = await vite.ssrLoadModule('/src/components/parcels/ParcelBookingFlow.jsx'));
  Picker = (await vite.ssrLoadModule('/src/components/parcels/ParcelLocationPicker.jsx')).default;
  Map = (await vite.ssrLoadModule('/src/components/parcels/ParcelMap.jsx')).default;
  domain = await vite.ssrLoadModule('/src/components/parcels/parcelJourney.js');
});
after(async () => vite.close());

test('service area map draws the radius, accepts pin corrections and cleans up replaced circles/listeners', async () => {
  const circles = [], markers = [], listeners = [], fits = [], changes = [];
  const listen = (kind, callback) => { const row = { kind, callback, removed: false, remove() { this.removed = true; } }; listeners.push(row); return row; };
  const maps = {
    Map: class { addListener(k, fn) { return listen(k, fn); } fitBounds(b) { fits.push(b); } setCenter() {} setZoom() {} },
    LatLngBounds: class { extend(p) { this.point = p; } getCenter() { return this.point; } },
    Marker: class { constructor(options) { Object.assign(this, options); markers.push(this); } addListener(k, fn) { return listen(k, fn); } setMap(map) { this.map = map; } },
    Circle: class { constructor(options) { Object.assign(this, options); circles.push(this); } getBounds() { return { radius: this.radius }; } setMap(map) { this.map = map; } },
  };
  const props = { areaMode: true, pickup: { lat: 22.72, lng: 75.85 }, radiusKm: 10, editable: 'pickup', onPinChange: p => changes.push(p) };
  const h = hookHarness(p => { window.google = { maps }; return Map(p); }, props);
  try {
    h.find(n => n.props?.className === 'parcel-map').props.ref.current = {};
    await h.settle();
    assert.equal(circles[0].radius, 10000); assert.equal(circles[0].clickable, false);
    assert.equal(markers[0].draggable, true); assert.equal(markers[0].title, 'Service area centre');
    assert.equal(fits[0].radius, 10000);
    const event = { latLng: { lat: () => 22.73, lng: () => 75.86 } };
    listeners.find(l => l.kind === 'dragend').callback(event);
    listeners.find(l => l.kind === 'click').callback(event);
    assert.deepEqual(changes, [{ lat: 22.73, lng: 75.86 }, { lat: 22.73, lng: 75.86 }]);
    props.radiusKm = 5; props.pickup = changes[0]; h.rerender();
    assert.equal(circles[0].map, null); assert.equal(circles[1].radius, 5000);
    assert.deepEqual(circles[1].center, changes[0]);
    assert.equal(markers[0].map, null);
    h.unmount(); assert.ok(listeners.every(l => l.removed)); assert.ok(circles.every(c => c.map === null));
  } finally { h.close(); }
});
const policy = { categories: ['documents'], maxWeightKg: 5, maxDimensionCm: 50, prohibitedItems: ['dangerous goods'], payDriverEnabled: true, payDriverCategories: ['documents'] };
const profile = { _id: 'synthetic-user', name: 'Sender', phone: '9876500011' };
const pickup = { address: 'Pickup street', name: 'Sender', phone: '9876500011', pincode: '560001', lat: 12.97, lng: 77.59 };
const dropoff = { ...pickup, address: 'Drop street', name: 'Recipient', lat: 12.98, lng: 77.60 };
const quote = seconds => ({ _id: '507f1f77bcf86cd799439023', expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), service: { id: 'parcel', name: 'Doorstep delivery' }, pricing: { policyVersion: 1, totalPaise: 3173, basePaise: 1000, distancePaise: 2173, taxPaise: 0, distanceMetres: 7315 }, route: { durationSeconds: 1062, polyline: 'synthetic' }, terms: 'Synthetic delivery terms' });
function flow(extra = {}) {
  const memory = new globalThis.Map();
  const h = hookHarness(Flow, { policy, flags: { online_payment: true, pay_driver: true }, profile, onBooked() {}, ...extra }, '/parcel-delivery/book', undefined, { sessionStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) } });
  return h;
}
const text = h => JSON.stringify(h.tree, (_k, v) => typeof v === 'function' ? undefined : v);
const edit = (h, name, value) => { const node = h.find(n => n.props?.name === name); assert.ok(node, name); node.props.onChange({ target: { value } }); h.flush(); };
const submit = h => { h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush(); };
const button = (h, label) => h.find(n => n.type === 'button' && n.props.children === label);
function locations(h) {
  h.find(n => n.type === Picker).props.onChange(dropoff); h.flush();
  button(h, 'Choose location').props.onClick(); h.flush();
  h.find(n => n.type === Picker).props.onChange(pickup); h.flush();
}
function details(h) {
  locations(h); submit(h);
  for (const [name, value] of Object.entries({ 'dropoff.name': 'Recipient', 'dropoff.phone': '9876500022', description: 'Documents', weightKg: '1', length: '10', width: '12', height: '2' })) edit(h, name, value);
  h.find(n => n.props?.checked === false && n.props?.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
}
async function delivery(h, seconds = 300) {
  details(h); submit(h);
  h.requests.findLast(r => r.url.endsWith('/quotes')).resolve({ data: quote(seconds) }); await h.settle();
}
async function review(h, seconds = 300) {
  await delivery(h, seconds);
  h.find(n => n.type === 'button' && [n.props.children].flat().some(c => typeof c === 'string' && c.startsWith('Review fare'))).props.onClick();
  h.flush();
  h.find(n => n.props?.type === 'radio' && n.props.value === 'pay_driver').props.onChange(); h.flush();
  h.find(n => n.props?.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
}
test('locations require confirmed coordinates, preserve contact prefill and switch all details together', () => {
  const h = flow();
  try {
    assert.equal(button(h, 'Confirm locations').props.disabled, true);
    locations(h); assert.equal(button(h, 'Confirm locations').props.disabled, false);
    h.find(n => n.props?.['aria-label'] === 'Switch pickup and drop locations').props.onClick(); h.flush(); submit(h);
    assert.equal(h.find(n => n.props?.name === 'pickup.address').props.value, 'Drop street');
    assert.equal(h.find(n => n.props?.name === 'pickup.name').props.value, 'Recipient');
    edit(h, 'pickup.address', 'Corrected building street');
    h.find(n => n.props?.['aria-label'] === 'Back to previous step').props.onClick(); h.flush();
    assert.match(text(h), /Corrected building street/);
  } finally { h.close(); }
});
test('saved addresses preserve canonical coordinates and are optional shortcuts', () => {
  const h = flow({ addresses: [{ _id: 'saved', line1: 'Saved street', city: 'Bengaluru', pincode: '560001', lat: 12.9, lng: 77.6, name: 'Saved contact', phone: '9876500033' }] });
  try {
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'saved' } }); h.flush();
    assert.match(text(h), /Saved street, Bengaluru/);
    assert.equal(domain.savedParcelAddress({ lat: 0, lng: 0 }).lat, 0);
  } finally { h.close(); }
});
test('quote uses real address and parcel inputs, recipient edits preserve coordinates and price is server supplied', async () => {
  const h = flow();
  try {
    details(h); edit(h, 'dropoff.address', 'Customer corrected address'); submit(h);
    const request = h.requests.find(r => r.url.endsWith('/quotes')), data = JSON.parse(request.options.body);
    assert.equal(data.dropoff.lat, dropoff.lat); assert.equal(data.dropoff.address, 'Customer corrected address'); assert.equal(data.dropoff.phone, '9876500022');
    assert.deepEqual(data.dimensions, [10, 12, 2]); assert.equal(data.amountPaise, undefined);
    request.resolve({ data: quote(300) }); await h.settle();
    assert.match(text(h), /₹31.73/); assert.match(text(h), /Doorstep delivery/); assert.equal(h.find(n => n.type === Map).props.route.durationSeconds, 1062);
  } finally { h.close(); }
});
test('contact phone controls accept local and international numbers consistently with the server', () => {
  const h = flow();
  try {
    details(h);
    const pattern = new RegExp('^(?:' + h.find(n => n.props?.name === 'pickup.phone').props.pattern + ')$');
    for (const value of ['9876500011', '+919876500011']) assert.equal(pattern.test(value), true, value);
    assert.equal(pattern.test('123'), false);
  } finally { h.close(); }
});
test('shared map SDK loader rejects missing configuration, shares one request and retries after failure', async () => {
  const priorWindow = globalThis.window, priorDocument = globalThis.document;
  const scripts = [], nodes = new globalThis.Map();
  globalThis.window = {};
  globalThis.document = { getElementById: id => nodes.get(id), head: { appendChild: node => { scripts.push(node); nodes.set(node.id, node); } }, createElement: () => {
    const node = new EventTarget(); node.remove = () => nodes.delete(node.id); return node;
  } };
  try {
    const { loadGoogleMaps } = await vite.ssrLoadModule('/src/utils/googleMaps.js');
    await assert.rejects(loadGoogleMaps(''), /map is unavailable/);
    const first = loadGoogleMaps('synthetic-browser-key'), second = loadGoogleMaps('synthetic-browser-key');
    assert.equal(first, second); assert.equal(scripts.length, 1);
    scripts[0].dispatchEvent(new Event('error')); await assert.rejects(first, /could not load/);
    const retry = loadGoogleMaps('synthetic-browser-key'); assert.equal(scripts.length, 2);
    window.google = { maps: { synthetic: true } }; scripts[1].dispatchEvent(new Event('load')); assert.equal((await retry).synthetic, true);
    assert.equal((await loadGoogleMaps()).synthetic, true);
  } finally { if (priorWindow) globalThis.window = priorWindow; else delete globalThis.window; if (priorDocument) globalThis.document = priorDocument; else delete globalThis.document; }
});
test('invalid contact and oversized parcel prevent quote requests with inline errors', async () => {
  const h = flow();
  try {
    details(h); edit(h, 'dropoff.phone', '123'); submit(h); await h.settle(); assert.match(text(h), /valid contact phone/); assert.equal(h.requests.length, 0);
    edit(h, 'dropoff.phone', '9876500022'); edit(h, 'weightKg', '6'); submit(h); await h.settle(); assert.match(text(h), /supported parcel limit/); assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});
test('out-of-area and route failures remain recoverable and never show fabricated fares', async () => {
  const h = flow();
  try {
    details(h); submit(h); h.requests[0].resolve({ message: 'Address is outside approved service areas' }, 400); await h.settle();
    assert.match(text(h), /outside approved service areas/); assert.doesNotMatch(text(h), /₹31.73/);
    submit(h); h.requests[1].resolve({ data: quote(300) }); await h.settle(); assert.match(text(h), /₹31.73/);
  } finally { h.close(); }
});
test('booking requires explicit review, locks double taps and replays the same identity after timeout', async () => {
  const booked = [], h = flow({ onBooked: b => booked.push(b) });
  try {
    await review(h); assert.equal(h.requests.filter(r => r.url.endsWith('/bookings')).length, 0);
    submit(h); submit(h);
    const first = h.requests.find(r => r.url.endsWith('/bookings')); assert.ok(first); assert.equal(h.requests.filter(r => r.url.endsWith('/bookings')).length, 1);
    first.reject(new Error('Synthetic connection interrupted')); await h.settle(); assert.match(text(h), /Retry booking safely/);
    submit(h); const retry = h.requests.findLast(r => r.url.endsWith('/bookings'));
    assert.equal(retry.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']); assert.equal(retry.options.body, first.options.body);
    retry.resolve({ data: { _id: '507f1f77bcf86cd799439022', reference: 'PD-SYNTHETIC' } }); await h.settle(); assert.equal(booked.length, 1);
  } finally { h.close(); }
});

test('cash pickup choice is reviewed, submitted and retained through a lost response', async () => {
  const h = flow({ policy: { ...policy, cashCollectionPoint: 'customer_choice' } });
  try {
    await review(h);
    const pickup = h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup');
    assert.equal(pickup.props.disabled, false); pickup.props.onChange(); h.flush();
    assert.equal(h.find(n => n.props?.type === 'checkbox').props.checked, false);
    assert.match(text(h), /sender pays before handover/);
    h.find(n => n.props?.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush(); submit(h);
    const attempt = h.requests.findLast(r => r.url.endsWith('/bookings'));
    assert.equal(JSON.parse(attempt.options.body).cashCollectionPoint, 'pickup');
    attempt.reject(new Error('Synthetic interruption')); await h.settle(); submit(h);
    assert.equal(h.requests.findLast(r => r.url.endsWith('/bookings')).options.body, attempt.options.body);
    assert.equal(h.find(n => n.type === 'fieldset' && n.props.className === 'parcel-payment-options').props.disabled, true);
  } finally { h.close(); }
});

test('drop-only policy disables pickup, while refreshed quote policy determines available cash points', async () => {
  const h = flow();
  try {
    await review(h);
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup').props.disabled, true);
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'delivery').props.checked, true);
    h.click('Refresh quote');
    h.requests.findLast(r => r.url.endsWith('/quotes')).resolve({ data: { ...quote(300), cashCollectionPoints: ['pickup'] } }); await h.settle();
    h.find(n => n.type === 'button' && [n.props.children].flat().some(c => typeof c === 'string' && c.startsWith('Review fare'))).props.onClick(); h.flush();
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup').props.checked, true);
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'delivery').props.disabled, true);
  } finally { h.close(); }
});

test('online payment does not send an unrelated cash collection choice', async () => {
  const h = flow({ policy: { ...policy, cashCollectionPoint: 'customer_choice' } });
  try {
    await review(h);h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup').props.onChange();h.flush();
    h.find(n => n.props?.name === 'paymentMethod' && n.props.value === 'online').props.onChange();h.flush();
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint'), undefined);
    h.find(n => n.props?.type === 'checkbox').props.onChange({ target: { checked: true } });h.flush();submit(h);
    const payload=JSON.parse(h.requests.findLast(r => r.url.endsWith('/bookings')).options.body);
    assert.equal(payload.paymentMethod,'online');assert.equal(payload.cashCollectionPoint,undefined);
  } finally { h.close(); }
});

test('restored uncertain booking displays its frozen cash point even after the current policy changes', () => {
  const currentPolicy={...policy,cashCollectionPoint:'pickup'},initial=domain.initialParcelJourney(profile,currentPolicy);
  const payload={quoteId:quote(300)._id,policyVersion:1,paymentMethod:'pay_driver',cashCollectionPoint:'delivery',acceptTerms:true};
  const state={...initial,paymentMethod:'pay_driver',cashCollectionPoint:'pickup',quote:quote(300),pending:{key:'synthetic-pending-cash-1234',payload}};
  const h=hookHarness(Flow,{policy:currentPolicy,flags:{pay_driver:true},profile,onBooked(){}},'/parcel-delivery/book',undefined,{sessionStorage:{getItem:()=>JSON.stringify({version:1,at:Date.now(),state}),setItem(){}}});
  try {
    assert.equal(h.find(n=>n.props?.name==='cashCollectionPoint'&&n.props.value==='delivery').props.checked,true);
    assert.match(text(h),/recipient pays before delivery/);submit(h);
    assert.deepEqual(JSON.parse(h.requests[0].options.body),payload);
  } finally {h.close();}
});
test('expiring quote refresh requires new fare review before any booking', async () => {
  const h = flow();
  try {
    await review(h, 10); submit(h);
    assert.equal(h.requests.filter(r => r.url.endsWith('/bookings')).length, 0);
    h.requests.findLast(r => r.url.endsWith('/quotes')).resolve({ data: { ...quote(300), pricing: { ...quote(300).pricing, totalPaise: 4200 } } }); await h.settle();
    assert.match(text(h), /₹42.00/); assert.match(text(h), /quote has been refreshed/); assert.equal(h.find(n => n.props?.type === 'checkbox').props.checked, false);
  } finally { h.close(); }
});
test('editing details invalidates route and ignores a stale quotation response', async () => {
  const h = flow();
  try {
    details(h); submit(h); const request = h.requests[0];
    edit(h, 'weightKg', '2'); request.resolve({ data: quote(300) }); await h.settle();
    assert.equal(h.find(n => n.type === Map), undefined); assert.equal(request.options.signal.aborted, true);
  } finally { h.close(); }
});
test('price summary includes actual charges and minimum adjustment without fabricated discounts', () => {
  const h = hookHarness(Price, { pricing: { totalPaise: 3173, basePaise: 1000, distancePaise: 2000, minimumAdjustmentPaise: 173, taxPaise: 300 } });
  try { assert.match(text(h), /₹31.73/); assert.match(text(h), /Minimum fare adjustment/); assert.match(text(h), /Tax \(included\)/); assert.doesNotMatch(text(h), /discount/i); } finally { h.close(); }
});
test('draft restore is account scoped, bounded in age and retains an uncertain booking attempt', () => {
  const old = globalThis.sessionStorage, initial = domain.initialParcelJourney(profile, policy), pending = { key: 'synthetic-retry-key-1234', payload: { quoteId: 'test' } };
  try {
    globalThis.sessionStorage = { getItem: () => JSON.stringify({ version: 1, at: Date.now(), state: { ...initial, pending, quote: quote(300) } }) };
    assert.deepEqual(domain.readParcelDraft(domain.parcelDraftKey(profile._id), initial).pending, pending);
    const snapshot = domain.parcelDraftSnapshot({ ...initial, pending, quote: quote(300) });
    assert.equal(snapshot.quote.route, undefined);
    assert.equal(domain.parcelDraftSnapshot({ ...initial, quote: quote(300) }).quote, null);
    assert.equal(domain.readParcelDraft(null, initial), initial);
    globalThis.sessionStorage = { getItem: () => JSON.stringify({ version: 1, at: 0, state: { ...initial, pending, quote: quote(300) } }) };
    assert.deepEqual(domain.readParcelDraft('old-pending', initial).pending, pending);
    globalThis.sessionStorage = { getItem: () => JSON.stringify({ version: 1, at: 0, state: initial }) }; assert.equal(domain.readParcelDraft('old', initial), initial);
  } finally { if (old) globalThis.sessionStorage = old; else delete globalThis.sessionStorage; }
});
function navigatorFixture(value, action) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  return Promise.resolve().then(action).finally(() => { if (prior) Object.defineProperty(globalThis, 'navigator', prior); else delete globalThis.navigator; });
}
for (const code of [1, 2, 3]) test('current location failure ' + code + ' clears stale pins and explains search fallback', async () => navigatorFixture({ geolocation: { getCurrentPosition(_success, failure) { failure({ code }); } } }, async () => {
  const changes = [], h = hookHarness(Picker, { value: pickup, onChange: v => changes.push(v), confirmLocation: true });
  try { h.click('Use current location'); assert.equal(changes.at(-1).lat, ''); assert.match(text(h), code === 1 ? /permission was denied/ : code === 3 ? /timed out/ : /could not be found/); } finally { h.close(); }
}));
test('granted current location reverse geocodes and requires confirmation before exposing coordinates', async () => navigatorFixture({ geolocation: { getCurrentPosition(success) { success({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 100 } }); } } }, async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: v => changes.push(v), confirmLocation: true });
  try {
    assert.equal(h.requests.length, 0); h.click('Use current location');
    h.requests[0].resolve({ data: { formatted: 'Resolved address', pincode: '560001' } }); await h.settle();
    assert.equal(changes.some(v => v.lat === 12.97), false); assert.match(text(h), /Approximate address/);
    h.click('Use this location'); assert.equal(changes.at(-1).lat, 12.97); assert.equal(changes.at(-1).address, 'Resolved address');
  } finally { h.close(); }
}));
test('unsupported geolocation and insecure context do not request device access', async () => navigatorFixture({}, async () => {
  const h = hookHarness(Picker, { value: {}, onChange() {}, confirmLocation: true });
  try { h.click('Use current location'); assert.match(text(h), /unavailable/); window.isSecureContext = false; h.click('Use current location'); assert.match(text(h), /secure connection/); } finally { h.close(); }
}));
test('manual pin selection survives reverse-geocoder failure and asks for address confirmation', async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: v => changes.push(v), confirmLocation: true, showMap: true });
  try {
    h.find(n => n.type === Map).props.onPinChange({ lat: 12.95, lng: 77.65 }); h.flush();
    h.requests[0].resolve({ message: 'Lookup unavailable' }, 503); await h.settle();
    assert.match(text(h), /enter the full address and pincode/); h.click('Use this location'); assert.equal(changes.at(-1).lat, 12.95);
  } finally { h.close(); }
});
test('an approximate search result remains labelled approximate after address resolution', async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: value => changes.push(value), confirmLocation: true });
  try {
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Synthetic area Bengaluru' } }); h.flush();
    h.click('Find address');
    h.requests[0].resolve({ data: { lat: 12.97, lng: 77.59, precision: 'APPROXIMATE', matched: 'Synthetic area' } }); await h.settle();
    h.requests[1].resolve({ data: { formatted: 'Resolved area address', pincode: '560001' } }); await h.settle();
    assert.match(text(h), /Approximate address/); h.click('Use this location'); assert.equal(changes.at(-1).approximate, true);
  } finally { h.close(); }
});

test('address search keeps the matched pincode instead of reverse-geocoding it to a neighbouring postal area', async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: v => changes.push(v), confirmLocation: true });
  try {
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Synthetic Indore street 452015' } }); h.flush(); h.click('Find address');
    h.requests[0].resolve({ data: { lat: 22.72, lng: 75.86, precision: 'ROOFTOP', matched: 'Synthetic Indore street, 452015', pincode: '452015' } }); await h.settle();
    assert.equal(h.requests.length, 1, 'A resolved search must not be replaced by a second reverse lookup');
    assert.match(text(h), /Pincode: /); assert.match(text(h), /452015/);
    h.click('Use this location');
    assert.equal(changes.at(-1).pincode, '452015'); assert.equal(changes.at(-1).address, 'Synthetic Indore street, 452015');
  } finally { h.close(); }
});

test('legacy search enrichment preserves the selected street while GPS and moved pins resolve their new address', async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: v => changes.push(v), confirmLocation: true, showMap: true });
  try {
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Synthetic selected building' } }); h.flush(); h.click('Find address');
    h.requests[0].resolve({ data: { lat: 22.72, lng: 75.86, precision: 'ROOFTOP', matched: 'Synthetic selected building' } }); await h.settle();
    h.requests[1].resolve({ data: { formatted: 'Neighbouring business', pincode: '452001' } }); await h.settle(); h.click('Use this location');
    assert.equal(changes.at(-1).address, 'Synthetic selected building');
    h.find(n => n.type === Map).props.onPinChange({ lat: 22.73, lng: 75.87 }); h.flush();
    h.requests[2].resolve({ data: { formatted: 'New pin address', pincode: '452015' } }); await h.settle(); h.click('Use this location');
    assert.equal(changes.at(-1).address, 'New pin address'); assert.equal(changes.at(-1).pincode, '452015');
  } finally { h.close(); }
});
test('Places autocomplete debounces, resolves a selected place and ignores late results after clearing search', async () => {
  const changes = [], h = hookHarness(Picker, { value: {}, onChange: v => changes.push(v), confirmLocation: true });
  let calls = 0;
  const place = { location: { lat: () => 12.98, lng: () => 77.6 }, formattedAddress: 'Google selected address', addressComponents: [{ types: ['postal_code'], longText: '560001' }], async fetchFields() {} };
  window.google = { maps: { async importLibrary() { return { AutocompleteSessionToken: class {}, AutocompleteSuggestion: { async fetchAutocompleteSuggestions() { calls++; return { suggestions: [{ placePrediction: { text: { toString: () => 'Google selected address' }, toPlace: () => place } }] }; } } }; } } };
  try {
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Ben' } }); h.flush();
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Bengaluru' } }); h.flush();
    await new Promise(r => setTimeout(r, 400)); await h.settle(); assert.equal(calls, 1);
    button(h, 'Google selected address').props.onClick(); await h.settle();
    h.click('Use this location'); assert.equal(changes.at(-1).pincode, '560001'); assert.equal(changes.at(-1).address, 'Google selected address');
    h.find(n => n.type === 'input').props.onChange({ target: { value: '' } }); h.flush(); assert.equal(h.find(n => n.props?.role === 'listbox'), undefined);
    let finish;
    window.google.maps.importLibrary = async () => ({ AutocompleteSessionToken: class {}, AutocompleteSuggestion: { fetchAutocompleteSuggestions: () => new Promise(resolve => finish = resolve) } });
    h.find(n => n.type === 'input').props.onChange({ target: { value: 'Pending search' } }); h.flush();
    await new Promise(r => setTimeout(r, 400)); await h.settle(); assert.equal(h.tree.props['aria-busy'], true);
    h.find(n => n.type === 'input').props.onKeyDown({ key: 'Escape' }); h.flush(); assert.equal(h.tree.props['aria-busy'], false);
    finish({ suggestions: [] }); await h.settle(); assert.equal(h.find(n => n.props?.role === 'listbox'), undefined);
  } finally { h.close(); }
});
