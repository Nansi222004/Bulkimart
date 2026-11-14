import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Flow, Picker, Map, domain, Price, Terms;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ default: Flow, ParcelPriceSummary: Price, ParcelTermsDialog: Terms } = await vite.ssrLoadModule('/src/components/parcels/ParcelBookingFlow.jsx'));
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
const policy = { categories: ['documents'], maxWeightKg: 5, maxDimensionCm: 50, prohibitedItems: ['dangerous goods'], payDriverEnabled: true, payDriverCategories: ['documents'], areas: [{ name: 'Test area' }] };
const vehicles = [
  { id: 'two_wheeler', name: '2 Wheeler', icon: 'bike', maxWeightKg: 20, dimensionsCm: [40, 40, 40], description: 'Fleet includes all 2 wheeler vehicles' },
  { id: 'tata_ace', name: 'Tata Ace', icon: 'truck', maxWeightKg: 750, dimensionsCm: [213, 122, 152], description: '' },
];
const vpolicy = { ...policy, vehicles, customerCancel: 'instant_before_assignment' };
const profile = { _id: 'synthetic-user', name: 'Sender', phone: '9876500011' };
const pickup = { address: 'Pickup street', name: 'Sender', phone: '9876500011', pincode: '560001', lat: 12.97, lng: 77.59 };
const dropoff = { ...pickup, address: 'Drop street', name: 'Recipient', phone: '9876500022', lat: 12.98, lng: 77.60 };
const fare = totalPaise => ({ policyVersion: 1, totalPaise, basePaise: 1000, distancePaise: totalPaise - 1000, taxPaise: 0, distanceMetres: 7315 });
const quote = seconds => ({ _id: '507f1f77bcf86cd799439023', expiresAt: new Date(Date.now() + seconds * 1000).toISOString(), service: { id: 'parcel', name: 'Doorstep delivery' }, pricing: fare(3173), route: { durationSeconds: 1062, polyline: 'synthetic' }, terms: 'Synthetic delivery terms' });
const vquote = (seconds = 300, two = { available: true }) => ({ ...quote(seconds), pricing: fare(16000), vehicleOptions: [
  { vehicle: vehicles[0], etaMinutes: 7, ...(two.available ? { available: true, pricing: fare(16000) } : { available: false, reason: 'too_large' }) },
  { vehicle: vehicles[1], available: true, etaMinutes: null, pricing: fare(101900) },
] });
function flow(extra = {}, saved) {
  const memory = new globalThis.Map(saved ? [[domain.parcelDraftKey(profile._id), saved]] : []);
  return hookHarness(Flow, { policy: vpolicy, flags: { online_payment: true, pay_driver: true }, profile, onBooked() {}, ...extra }, '/parcel-delivery/book', undefined, { sessionStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) } });
}
const text = h => JSON.stringify(h.tree, (_k, v) => typeof v === 'function' ? undefined : v);
const edit = (h, name, value) => { const node = h.find(n => n.props?.name === name); assert.ok(node, name); node.props.onChange({ target: { value } }); h.flush(); };
const submit = h => { h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush(); };
const button = (h, label) => h.find(n => n.type === 'button' && [n.props.children].flat().includes(label));
const heading = h => h.find(n => n.type === 'h2')?.props.children;
const quotes = h => h.requests.filter(r => r.url.endsWith('/quotes'));
const bookings = h => h.requests.filter(r => r.url.endsWith('/bookings'));
async function toVehicles(h, drop = dropoff) {
  h.find(n => n.props?.className === 'parcel-pickup-bar').props.onClick(); h.flush();
  h.find(n => n.type === Picker).props.onChange(pickup); h.flush();
  submit(h); await h.settle();
  h.find(n => n.type === Picker).props.onChange(drop); h.flush();
  submit(h); await h.settle();
}
async function priced(h, data = vquote()) { await toVehicles(h); quotes(h).at(-1).resolve({ data }); await h.settle(); }
async function review(h, data, vehicle = '2 Wheeler') { await priced(h, data); h.click('Proceed with ' + vehicle); }
const book = h => { h.find(n => n.type === 'form' && n.props.id === 'parcel-booking-review').props.onSubmit({ preventDefault() {} }); h.flush(); };

test('pickup and drop are chosen on their own screens and contacts are confirmed before prices load', async () => {
  const h = flow();
  try {
    assert.equal(heading(h), undefined, 'The page title bar already says Send a Parcel'); assert.match(text(h), /Choose a vehicle/); assert.match(text(h), /Set your pickup location/); assert.match(text(h), /2 Wheeler/); assert.match(text(h), /Tata Ace/);
    h.find(n => n.props?.className === 'parcel-pickup-bar').props.onClick(); h.flush();
    assert.equal(h.find(n => n.type === Picker).props.label, 'Where is your pickup?');
    h.find(n => n.type === Picker).props.onChange(pickup); h.flush();
    assert.equal(heading(h), 'Pickup details'); assert.match(text(h), /Your goods will be picked from here/);
    assert.equal(h.find(n => n.props?.name === 'pickup.name').props.value, 'Sender');
    assert.equal(h.find(n => n.props?.type === 'checkbox').props.checked, true, 'Use my mobile number starts ticked for the sender');
    submit(h); await h.settle();
    assert.equal(h.find(n => n.type === Picker).props.label, 'Where is your drop?'); assert.match(text(h), /Sender · 9876500011/);
    h.find(n => n.type === Picker).props.onChange({ ...dropoff, name: '', phone: '' }); h.flush();
    assert.match(text(h), /Your goods will be dropped here/); assert.equal(h.find(n => n.props?.type === 'checkbox').props.checked, false);
    edit(h, 'dropoff.name', 'Recipient'); edit(h, 'dropoff.phone', '123'); submit(h); await h.settle();
    assert.match(text(h), /valid contact phone/); assert.equal(quotes(h).length, 0);
    edit(h, 'dropoff.phone', '9876500022'); submit(h); await h.settle();
    assert.equal(heading(h), 'Select Vehicle'); assert.equal(quotes(h).length, 1);
    const body = JSON.parse(quotes(h)[0].options.body);
    assert.equal(body.dropoff.phone, '9876500022'); assert.equal(body.dropoff.lat, dropoff.lat); assert.equal(body.category, 'documents'); assert.equal(body.packages, 1);
    assert.equal(body.weightKg, undefined); assert.equal(body.dimensions, undefined); assert.equal(body.amountPaise, undefined);
  } finally { h.close(); }
});
test('saved addresses are listed on the search screen and keep their coordinates', () => {
  const h = flow({ addresses: [{ _id: 'saved', label: 'Work', line1: 'Saved street', city: 'Bengaluru', pincode: '560001', lat: 12.9, lng: 77.6, name: 'Saved contact', phone: '9876500033' }] });
  try {
    h.find(n => n.props?.className === 'parcel-pickup-bar').props.onClick(); h.flush();
    assert.match(text(h), /"Work"," · Saved contact"/);
    h.find(n => n.type === 'button' && text({ tree: n }).includes('Saved street')).props.onClick(); h.flush();
    assert.equal(heading(h), 'Pickup details'); assert.equal(h.find(n => n.type === Map).props.pickup.lat, 12.9);
    assert.equal(domain.savedParcelAddress({ lat: 0, lng: 0 }).lat, 0);
  } finally { h.close(); }
});
test('contact phone controls accept local and international numbers consistently with the server', () => {
  const h = flow();
  try {
    h.find(n => n.props?.className === 'parcel-pickup-bar').props.onClick(); h.flush(); h.find(n => n.type === Picker).props.onChange(pickup); h.flush();
    const pattern = new RegExp('^(?:' + h.find(n => n.props?.name === 'pickup.phone').props.pattern + ')$');
    for (const value of ['9876500011', '+919876500011']) assert.equal(pattern.test(value), true, value);
    assert.equal(pattern.test('123'), false);
  } finally { h.close(); }
});
test('Select Vehicle lists server prices per vehicle; the chosen vehicle is booked with its details sheet', async () => {
  const booked = [], h = flow({ onBooked: b => booked.push(b) });
  try {
    await priced(h);
    assert.match(text(h), /₹160/); assert.match(text(h), /₹1019/); assert.match(text(h), /7 mins/); assert.match(text(h), /"Load space ","40 × 40 × 40"/);
    assert.ok(button(h, 'Proceed with 2 Wheeler'), 'First available vehicle is selected');
    h.find(n => n.props?.['aria-label'] === 'About 2 Wheeler').props.onClick(); h.flush();
    assert.ok(h.find(n => n.props?.label === '2 Wheeler'), 'Vehicle details sheet'); assert.match(text(h), /Fleet includes all 2 wheeler vehicles/);
    h.find(n => n.props?.label === '2 Wheeler').props.onClose(); h.flush();
    h.find(n => n.type === 'button' && n.props['aria-pressed'] === false && text({ tree: n }).includes('Tata Ace')).props.onClick(); h.flush();
    h.click('Proceed with Tata Ace');
    assert.equal(heading(h), 'Review Booking'); assert.ok(button(h, 'Book Tata Ace')); assert.match(text(h), /Cash at drop/);
    assert.equal(bookings(h).length, 0); book(h);
    const payload = JSON.parse(bookings(h)[0].options.body);
    assert.deepEqual(payload, { quoteId: vquote()._id, policyVersion: 1, paymentMethod: 'pay_driver', cashCollectionPoint: 'delivery', vehicleId: 'tata_ace', acceptTerms: true });
    bookings(h)[0].resolve({ data: { _id: '507f1f77bcf86cd799439022', reference: 'PD-SYNTHETIC' } }); await h.settle(); assert.equal(booked.length, 1);
  } finally { h.close(); }
});
test('a vehicle that cannot carry the goods is greyed out; heavier goods on Review send the customer back to choose', async () => {
  const h = flow();
  try {
    await review(h);
    h.find(n => n.props?.className === 'parcel-text-button' && text({ tree: n }).includes('Change')).props.onClick(); h.flush();
    const sheet = () => h.find(n => n.props?.title === 'Goods description');
    assert.ok(sheet());
    edit(h, 'weightKg', '100'); assert.match(text(h), /"This is more than a ","2 Wheeler"/);
    sheet().props.footer.props.onClick(); h.flush(); await h.settle();
    assert.equal(quotes(h).length, 2); assert.equal(JSON.parse(quotes(h)[1].options.body).weightKg, 100);
    quotes(h)[1].resolve({ data: vquote(300, { available: false }) }); await h.settle();
    assert.equal(heading(h), 'Select Vehicle'); assert.match(text(h), /cannot carry these goods/); assert.match(text(h), /Can’t carry these goods/);
    assert.equal(h.find(n => n.type === 'button' && text({ tree: n }).includes('2 Wheeler') && n.props['aria-pressed'] !== undefined).props.disabled, true);
    assert.ok(button(h, 'Proceed with Tata Ace'));
  } finally { h.close(); }
});
test('route and service-area failures stay recoverable and never show a made-up fare', async () => {
  const h = flow();
  try {
    await toVehicles(h); quotes(h)[0].resolve({ message: 'Address is outside approved service areas' }, 400); await h.settle();
    assert.match(text(h), /outside approved service areas/); assert.doesNotMatch(text(h), /₹160/); assert.equal(quotes(h).length, 1);
    h.click('Try again'); await h.settle(); assert.equal(quotes(h).length, 2);
    quotes(h)[1].resolve({ data: vquote() }); await h.settle(); assert.match(text(h), /₹160/);
  } finally { h.close(); }
});
test('booking locks double taps and replays the same identity after a lost response', async () => {
  const booked = [], h = flow({ onBooked: b => booked.push(b) });
  try {
    await review(h); book(h); book(h);
    const first = bookings(h)[0]; assert.equal(bookings(h).length, 1);
    first.reject(new Error('Synthetic connection interrupted')); await h.settle(); assert.ok(button(h, 'Retry booking safely'));
    assert.equal(h.find(n => n.props?.['aria-label'] === 'Back to previous step').props.disabled, true);
    book(h); const retry = bookings(h).at(-1);
    assert.equal(retry.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']); assert.equal(retry.options.body, first.options.body);
    retry.resolve({ data: { _id: '507f1f77bcf86cd799439022', reference: 'PD-SYNTHETIC' } }); await h.settle(); assert.equal(booked.length, 1);
  } finally { h.close(); }
});
test('cash at pickup is chosen in the payment sheet and kept through a lost response', async () => {
  const h = flow({ policy: { ...vpolicy, cashCollectionPoint: 'customer_choice' } });
  try {
    await review(h, { ...vquote(), cashCollectionPoints: ['pickup', 'delivery'] });
    h.find(n => n.props?.className === 'parcel-pay-choice').props.onClick(); h.flush();
    assert.ok(h.find(n => n.props?.title === 'Select Payment Method'));
    h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup').props.onChange(); h.flush();
    assert.match(text(h), /Cash at pickup/); book(h);
    const attempt = bookings(h).at(-1); assert.equal(JSON.parse(attempt.options.body).cashCollectionPoint, 'pickup');
    attempt.reject(new Error('Synthetic interruption')); await h.settle(); book(h);
    assert.equal(bookings(h).at(-1).options.body, attempt.options.body);
    assert.equal(h.find(n => n.props?.className === 'parcel-pay-choice').props.disabled, true);
  } finally { h.close(); }
});
test('drop-only policy disables cash at pickup; online payment sends no cash point', async () => {
  const h = flow();
  try {
    await review(h); h.find(n => n.props?.className === 'parcel-pay-choice').props.onClick(); h.flush();
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'pickup').props.disabled, true);
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint' && n.props.value === 'delivery').props.checked, true);
    h.find(n => n.props?.name === 'paymentMethod' && n.props.value === 'online').props.onChange(); h.flush();
    assert.equal(h.find(n => n.props?.name === 'cashCollectionPoint'), undefined); assert.match(text(h), /Pay online/);
    book(h); const payload = JSON.parse(bookings(h).at(-1).options.body);
    assert.equal(payload.paymentMethod, 'online'); assert.equal(payload.cashCollectionPoint, undefined);
  } finally { h.close(); }
});
test('a restored uncertain booking reopens Review with its frozen cash point and payload', () => {
  const currentPolicy = { ...vpolicy, cashCollectionPoint: 'pickup' }, initial = domain.initialParcelJourney(profile, currentPolicy);
  const payload = { quoteId: vquote()._id, policyVersion: 1, paymentMethod: 'pay_driver', cashCollectionPoint: 'delivery', vehicleId: 'two_wheeler', acceptTerms: true };
  const state = { ...initial, pickup, dropoff, vehicleId: 'two_wheeler', paymentMethod: 'pay_driver', cashCollectionPoint: 'pickup', quote: vquote(), pending: { key: 'synthetic-pending-cash-1234', payload } };
  const h = flow({ policy: currentPolicy, flags: { pay_driver: true } }, JSON.stringify({ version: 2, at: Date.now(), state }));
  try {
    assert.equal(heading(h), 'Review Booking'); assert.match(text(h), /Cash at drop/); assert.ok(button(h, 'Retry booking safely'));
    book(h); assert.deepEqual(JSON.parse(bookings(h)[0].options.body), payload);
  } finally { h.close(); }
});
test('a nearly expired fare is refreshed and must be reviewed again before booking', async () => {
  const h = flow();
  try {
    await review(h, vquote(10)); book(h);
    assert.equal(bookings(h).length, 0); assert.equal(quotes(h).length, 2);
    const fresh = vquote(300); fresh.vehicleOptions[0].pricing = fare(4200);
    quotes(h).at(-1).resolve({ data: fresh }); await h.settle();
    assert.match(text(h), /₹42/); assert.match(text(h), /fare has been refreshed/); assert.equal(bookings(h).length, 0);
  } finally { h.close(); }
});
test('changing locations on Select Vehicle ignores a stale price response', async () => {
  const h = flow();
  try {
    await toVehicles(h); const request = quotes(h)[0];
    h.find(n => n.props?.['aria-label'] === 'Switch pickup and drop').props.onClick(); h.flush();
    assert.equal(request.options.signal.aborted, true);
    request.resolve({ data: vquote() }); await h.settle();
    assert.doesNotMatch(text(h), /₹160/); await h.settle(); assert.equal(quotes(h).length, 2);
    assert.equal(JSON.parse(quotes(h)[1].options.body).pickup.address, 'Drop street');
  } finally { h.close(); }
});
test('without vehicles the single service asks for weight and size before pricing', async () => {
  const h = flow({ policy });
  try {
    await toVehicles(h); assert.equal(quotes(h).length, 0); assert.match(text(h), /What are you sending\?/);
    for (const [name, value] of Object.entries({ description: 'Documents', weightKg: '6', length: '10', width: '12', height: '2' })) edit(h, name, value);
    h.find(n => n.props?.type === 'checkbox' && n.props.checked === false).props.onChange({ target: { checked: true } }); h.flush(); await h.settle();
    assert.equal(quotes(h).length, 0, 'Over the weight limit');
    edit(h, 'weightKg', '1'); await h.settle();
    assert.equal(quotes(h).length, 1); const body = JSON.parse(quotes(h)[0].options.body);
    assert.deepEqual(body.dimensions, [10, 12, 2]); assert.equal(body.weightKg, 1);
    quotes(h)[0].resolve({ data: quote(300) }); await h.settle(); assert.match(text(h), /Doorstep delivery/); assert.ok(button(h, 'Proceed with Doorstep delivery'));
    h.click('Proceed with Doorstep delivery'); book(h);
    assert.equal(JSON.parse(bookings(h)[0].options.body).vehicleId, undefined);
  } finally { h.close(); }
});
test('price summary includes actual charges and minimum adjustment without fabricated discounts', () => {
  const h = hookHarness(Price, { pricing: { totalPaise: 3173, basePaise: 1000, distancePaise: 2000, minimumAdjustmentPaise: 173, taxPaise: 300 } });
  try { assert.match(text(h), /₹31.73/); assert.match(text(h), /Minimum fare adjustment/); assert.match(text(h), /Tax \(included\)/); assert.doesNotMatch(text(h), /discount/i); } finally { h.close(); }
});
test('draft restore is account scoped, bounded in age, retains an uncertain attempt and supports Book Again', () => {
  const initial = domain.initialParcelJourney(profile, vpolicy), pending = { key: 'synthetic-retry-key-1234', payload: { quoteId: 'test' } };
  const store = value => ({ getItem: () => JSON.stringify(value) });
  assert.deepEqual(domain.readParcelDraft('key', initial, store({ version: 2, at: Date.now(), state: { ...initial, pending, quote: vquote() } })).pending, pending);
  assert.equal(domain.readParcelDraft('key', initial, store({ version: 2, at: Date.now(), state: { ...initial, pending, quote: vquote() } })).step, 'review');
  assert.equal(domain.parcelDraftSnapshot({ ...initial, pending, quote: vquote() }).quote.route, undefined);
  assert.equal(domain.parcelDraftSnapshot({ ...initial, quote: vquote() }).quote, null);
  assert.equal(domain.readParcelDraft(null, initial), initial);
  assert.deepEqual(domain.readParcelDraft('old-pending', initial, store({ version: 2, at: 0, state: { ...initial, pending, quote: vquote() } })).pending, pending);
  assert.equal(domain.readParcelDraft('old', initial, store({ version: 2, at: 0, state: initial })), initial);
  assert.equal(domain.readParcelDraft('v1', initial, store({ version: 1, at: Date.now(), state: initial })), initial, 'Drafts from the old screens are ignored');
  const memory = new globalThis.Map(), storage = { setItem: (k, v) => memory.set(k, v), getItem: k => memory.get(k) };
  domain.bookAgainDraft(storage, profile._id, { service: { id: 'tata_ace' }, details: { pickup, dropoff } });
  const again = domain.readParcelDraft(domain.parcelDraftKey(profile._id), initial, storage);
  assert.equal(again.step, 'vehicle'); assert.equal(again.vehicleId, 'tata_ace'); assert.equal(again.pickup.address, 'Pickup street'); assert.equal(again.dropoff.phone, '9876500022'); assert.equal(again.parcel.category, 'documents');
});
test('the terms open from Review and describe instant cancellation before a partner accepts', async () => {
  const h = flow();
  try {
    await review(h);
    h.find(n => n.props?.className === 'parcel-terms-link').props.onClick(); h.flush();
    const dialog = h.find(n => n.type === Terms);
    assert.ok(dialog, 'Terms dialog is shown'); assert.equal(dialog.props.terms, quote(300).terms);
    dialog.props.onClose(); h.flush(); assert.equal(h.find(n => n.type === Terms), undefined);
    assert.match(text(h), /cancel free of charge until a delivery partner accepts/);
  } finally { h.close(); }
  const t = hookHarness(Terms, { terms: 'Policy text', policy: vpolicy, onClose() {} });
  try { const all = text(t); for (const words of ['Policy text', 'Until a delivery partner accepts, you can cancel at once', 'Bulkimart wallet', 'dangerous goods']) assert.ok(all.includes(words), words); } finally { t.close(); }
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
    assert.match(scripts[1].src, /loading=async&callback=__bulkimartMapsReady/);
    const imported = []; window.google = { maps: { synthetic: true, Map: class {}, importLibrary: async name => { imported.push(name); return {}; } } }; window.__bulkimartMapsReady();
    assert.equal((await retry).synthetic, true); assert.deepEqual(imported.sort(), ['geometry', 'maps', 'marker']);
    assert.equal((await loadGoogleMaps()).synthetic, true);
  } finally { if (priorWindow) globalThis.window = priorWindow; else delete globalThis.window; if (priorDocument) globalThis.document = priorDocument; else delete globalThis.document; }
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

test('parcel home lists recent trips; Book Again reuses both stops and opens vehicle prices', async () => {
  const opened = [], h = flow({ onOpenHistory() { opened.push('history'); }, onOpenTrip(id) { opened.push(id); } });
  try {
    const read = h.requests.find(r => r.url.endsWith('/bookings?page=1')); assert.ok(read, 'Recent trips are loaded');
    read.resolve({ data: [{ _id: 'b1', status: 'delivered', feePaise: 16000, service: { id: 'tata_ace', name: 'Tata Ace', icon: 'truck' }, details: { pickup, dropoff } }, { _id: 'b2', status: 'searching_for_driver', feePaise: 9000, details: { pickup, dropoff } }] }); await h.settle();
    assert.match(text(h), /Your recent trips/); assert.match(text(h), /Good to know/);
    h.click('Delivery history'); assert.deepEqual(opened, ['history']);
    h.click('Book Again'); await h.settle();
    assert.equal(heading(h), 'Select Vehicle'); assert.equal(quotes(h).length, 1);
    const body = JSON.parse(quotes(h)[0].options.body); assert.equal(body.pickup.address, 'Pickup street'); assert.equal(body.dropoff.phone, '9876500022');
    quotes(h)[0].resolve({ data: vquote() }); await h.settle(); assert.ok(button(h, 'Proceed with Tata Ace'));
  } finally { h.close(); }
});
