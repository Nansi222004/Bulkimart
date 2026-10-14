import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
import { SERVICE_ANSWER_BYTES, serializedAnswerBytes } from '../../shared/serviceLimits.mjs';

let vite, ui;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  ui = await vite.ssrLoadModule('/src/components/services/ServicesPanel.jsx');
});
after(async () => { await vite?.close(); });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const fields = [
  { id: 'business', label: 'Business name', type: 'text', required: true, help: 'Use registered name', minLength: 2, maxLength: 100 },
  { id: 'proof', label: 'Certificate', type: 'file', required: true, formats: ['pdf'], maxBytes: 1048576 },
  { id: 'channel', label: 'Channel', type: 'radio', required: true, options: ['Retail', 'Wholesale'] },
];
const application = status => ({ _id: 'application-id', __v: 0, vendor: 'vendor-id', createdAt: '2026-10-14T00:00:00Z', status,
  snapshot: { name: 'Registration support', fields, pricing: { mode: 'fixed', amount: 125.5, currency: 'INR' } },
  answers: { business: '<script>alert(1)</script>', channel: 'Retail' },
  files: [{ fileId: 'private-file-id', name: 'certificate.pdf', sizeBytes: 50, kind: 'document' }],
  events: [{ _id: 'event-id', at: '2026-10-14T00:00:00Z', action: 'submitted', actorType: 'vendor' }],
});

test('vendor and admin entry screens expose navigation and loading state', () => {
  const vendor = render(ui.default, {}), admin = render(ui.default, { admin: true });
  assert.match(vendor, /My applications/); assert.match(vendor, /Service catalogue/); assert.match(vendor, /role="status">Loading/);
  assert.match(admin, /Create service/); assert.match(admin, /Manage services/);
});
test('dynamic fields render required inputs, limits, private upload restrictions and field errors', () => {
  const html = render(ui.DynamicFields, { fields, answers: {}, errors: { business: 'Enter a registered name' } });
  assert.match(html, /minLength="2"/); assert.match(html, /maxLength="100"/); assert.match(html, /accept=".pdf"/);
  assert.match(html, /aria-invalid="true"/); assert.match(html, /role="alert"/); assert.match(html, /Enter a registered name/);
  assert.match(html, /Use registered name/); assert.match(html, /type="radio"/); assert.match(html, /required=""/);
});
test('admin editor exposes pricing, field configuration, ordering and preview', () => {
  const html = render(ui.ServiceEditor, { initial: { name: 'Registration', slug: 'registration', description: 'Support', instructions: '', fields, pricing: { mode: 'fixed', amount: 125.5, currency: 'INR' } }, busy: false });
  for (const label of ['Stable ID', 'Allowed formats', 'Maximum bytes', 'Move up', 'Move down', 'Preview form', 'Currency', 'Fixed price']) assert.ok(html.includes(label), label);
});
test('application view escapes answers and renders private downloads without storage URLs', () => {
  const html = render(ui.ApplicationDetail, { application: application('completed'), admin: false });
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|href=|private-data|sha256/);
  assert.match(html, /Download certificate.pdf/); assert.match(html, /History/); assert.match(html, /INR 125.50/);
  assert.doesNotMatch(html, /Apply action|Send response/);
});
test('information requests expose vendor response and terminal outcomes expose no editing', () => {
  assert.match(render(ui.ApplicationDetail, { application: application('information_required'), admin: false }), /Send response and return to review/);
  assert.match(render(ui.ApplicationDetail, { application: application('under_review'), admin: true }), /More Information Required/);
  for (const status of ['completed', 'rejected']) assert.doesNotMatch(render(ui.ApplicationDetail, { application: application(status), admin: true }), /Apply action/);
});
test('busy actions are disabled and identify saving state', () => {
  const html = render(ui.ApplicationDetail, { application: application('information_required'), admin: false, busy: true });
  assert.match(html, /disabled=""/); assert.match(html, /Saving/);
});

const appId = '507f1f77bcf86cd799439011';
const appRecord = (version = 0, status = 'submitted') => ({ ...application(status), _id: appId, __v: version });
const serviceRecord = { _id: '507f1f77bcf86cd799439012', name: 'Fixture service', description: 'Fixture', pricing: { mode: 'free', amount: 0, currency: 'INR' }, fields: [] };
const listResult = data => ({ data, meta: { total: data.length } });
const detailNode = h => h.find(n => n.type === ui.ApplicationDetail);

test('delayed catalogue responses cannot overwrite the active applications view', async () => {
  const h = hookHarness(ui.default);
  try {
    h.click('My applications');
    h.requests[1].resolve(listResult([appRecord()])); await h.settle();
    h.requests[0].resolve(listResult([serviceRecord])); await h.settle();
    assert.ok(h.find(n => n.type === 'button' && n.props.children === 'View application'));
    assert.equal(h.requests[0].options.signal.aborted, true);
  } finally { h.close(); }
});
test('rapid repeated navigation ignores stale failures and displays genuine current failures', async () => {
  const h = hookHarness(ui.default);
  try {
    h.click('My applications'); h.click('Service catalogue'); h.click('My applications');
    h.requests[3].resolve(listResult([appRecord()])); await h.settle();
    h.requests[0].resolve(listResult([serviceRecord])); h.requests[1].reject(new Error('Obsolete failure')); h.requests[2].resolve(listResult([serviceRecord])); await h.settle();
    assert.ok(h.find(n => n.type === 'button' && n.props.children === 'View application'));
    assert.equal(h.find(n => n.props?.role === 'alert'), undefined);
    h.click('Refresh'); h.requests[4].resolve({ message: 'Current server failure' }, 500); await h.settle();
    assert.ok(h.find(n => n.props?.role === 'alert' && n.props.children.includes('Current server failure')));
  } finally { h.close(); }
});
test('unmount aborts pending work and ignores its eventual response', async () => {
  const h = hookHarness(ui.default);
  try { h.unmount(); const updates = h.updates; h.requests[0].resolve(listResult([serviceRecord])); await h.settle(); assert.equal(h.updates, updates); assert.equal(h.requests[0].options.signal.aborted, true); }
  finally { h.close(); }
});
async function openFixture() {
  const h = hookHarness(ui.default, { admin: true }, `/admin/services?application=${appId}`);
  h.requests[0].resolve(listResult([])); h.requests[1].resolve({ data: appRecord() }); await h.settle();
  h.requests[2].resolve(listResult([appRecord()])); await h.settle();
  return h;
}
test('direct notification routes fetch authorized details and Refresh replaces status/version/files/history', async () => {
  const h = await openFixture();
  try {
    assert.equal(detailNode(h).props.application.__v, 0);
    h.click('Refresh');
    assert.match(h.requests[3].url, /applications\?/); assert.match(h.requests[4].url, new RegExp(`/applications/${appId}$`));
    const latest = { ...appRecord(1, 'in_progress'), files: [], events: [] };
    h.requests[3].resolve(listResult([latest])); h.requests[4].resolve({ data: latest }); await h.settle();
    assert.deepEqual(detailNode(h).props.application, latest);
    assert.match(render(ui.ApplicationDetail, detailNode(h).props), /Completed/);
    assert.doesNotMatch(render(ui.ApplicationDetail, detailNode(h).props), /More Information Required<\/option>/);
  } finally { h.close(); }
});
test('conflicts preserve unsaved input, require review, and never automatically retry transitions', async () => {
  const h = await openFixture();
  try {
    const originalKey = detailNode(h).key;
    detailNode(h).props.onDirty(true);
    await detailNode(h).props.run(async () => { throw Object.assign(new Error('Application changed'), { status: 409 }); }); h.flush();
    assert.ok(h.find(n => n.type === 'p' && n.props.role === 'alert'));
    globalThis.window.confirm = () => false;
    await h.click('Reload latest application');
    assert.equal(h.requests.length, 3); assert.equal(detailNode(h).key, originalKey);
    globalThis.window.confirm = () => true;
    h.click('Reload latest application');
    h.requests[3].resolve(listResult([appRecord(2, 'rejected')])); h.requests[4].resolve({ data: appRecord(2, 'rejected') }); await h.settle();
    assert.equal(detailNode(h).props.application.status, 'rejected'); assert.notEqual(detailNode(h).key, originalKey);
    assert.ok(h.requests.every(r => !r.options.method));
  } finally { h.close(); }
});
test('older detail refreshes cannot overwrite newer records', async () => {
  const h = await openFixture();
  try {
    h.click('Refresh');
    window.dispatchEvent(new Event('service-application-open')); h.flush();
    h.requests[5].resolve({ data: appRecord(2, 'completed') }); await h.settle();
    h.requests[3].resolve(listResult([appRecord(1)])); h.requests[4].resolve({ data: appRecord(1) }); await h.settle();
    assert.equal(detailNode(h).props.application.__v, 2);
  } finally { h.close(); }
});
test('malformed and inaccessible deep links do not display protected application data', async () => {
  let h = hookHarness(ui.default, { admin: true }, '/admin/services?application=malformed');
  try { await h.settle(); assert.equal(h.requests.length, 1); assert.equal(detailNode(h), undefined); assert.ok(h.find(n => n.props?.role === 'alert')); } finally { h.close(); }
  h = hookHarness(ui.default, { admin: true }, `/admin/services?application=${appId}`);
  try { h.requests[0].resolve(listResult([])); h.requests[1].resolve({ message: 'Forbidden' }, 403); await h.settle(); assert.equal(detailNode(h), undefined); assert.ok(h.find(n => n.props?.role === 'alert')); } finally { h.close(); }
});
test('notification opener routes service references, preserves tickets and deduplicates clicks/read updates', async () => {
  const { createAdminNotificationOpener } = await vite.ssrLoadModule('/src/modules/Admin/utils/serviceNotifications.js');
  const open = createAdminNotificationOpener(), calls = []; let release;
  const actions = { markRead: async id => { calls.push(['read', id]); await new Promise(r => { release = r; }); }, setTab: t => calls.push(['tab', t]), close: () => {}, openTicket: async t => calls.push(['ticket', t.id]), openService: id => calls.push(['application', id]), toast: message => calls.push(['toast', message]) };
  const n = { _id: 'notification', metadata: { applicationId: appId }, route: '/malicious-url' };
  const pending = open(n, actions); await open(n, actions); release(); await pending;
  assert.deepEqual(calls, [['read', 'notification'], ['tab', 'services'], ['application', appId]]);
  calls.length = 0;
  await open({ _id: 'ticket-notif', isRead: true, metadata: { ticketId: 'ticket-id' } }, actions);
  assert.deepEqual(calls, [['tab', 'tickets'], ['ticket', 'ticket-id']]);
  calls.length = 0;
  await open({ isRead: true, route: '/admin/services', metadata: { applicationId: '../bad' } }, actions);
  assert.equal(calls[0][1], 'services'); assert.equal(calls[1][0], 'toast');
  calls.length = 0;
  await open({ isRead: true, route: '/admin/services' }, actions);
  assert.equal(calls[1][0], 'toast');
});
test('client answer limits use serialized UTF-8 bytes before issuing an upload', async () => {
  const h = hookHarness(ui.default);
  try {
    const fieldList = Array.from({ length: 27 }, (_, i) => ({ id: `answer_${i}`, type: 'textarea', label: `Answer ${i}`, required: true, maxLength: 10000 }));
    const s = { ...serviceRecord, fields: fieldList, __v: 0, formVersion: 1 };
    h.requests[0].resolve(listResult([s])); await h.settle(); h.click('View requirements and apply');
    const dynamic = () => h.find(n => n.type === ui.DynamicFields);
    dynamic().props.setAnswers(Object.fromEntries(fieldList.map(f => [f.id, '世\n'.repeat(4000)]))); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
    assert.equal(h.requests.length, 1); assert.ok(h.find(n => n.props?.role === 'alert'));
    const answers = Object.fromEntries(fieldList.map((f, i) => [f.id, i < 26 ? 'x'.repeat(10000) : '']));
    answers.answer_26 = 'x'.repeat(SERVICE_ANSWER_BYTES - 1 - serializedAnswerBytes(answers));
    dynamic().props.setAnswers(answers); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
    assert.equal(h.requests.length, 2); assert.equal(h.requests[1].options.body.get('answers'), JSON.stringify(answers));
    h.requests[1].resolve({ data: appRecord() }, 201); await h.settle();
  } finally { h.close(); }
});
test('actual application form reports draft changes and preserves them when its request conflicts', async () => {
  const a = appRecord(0, 'information_required'); let dirty = false;
  const h = hookHarness(ui.ApplicationDetail, { application: a, admin: false, busy: false, onDirty: value => { dirty = value; }, request: async () => { throw Object.assign(new Error('Conflict'), { status: 409 }); }, run: async fn => { try { await fn(); } catch {} }, onChange: () => { throw new Error('Must not overwrite on conflict'); } });
  try {
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Unsaved vendor response' } }); h.flush();
    assert.equal(dirty, true);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
    assert.equal(h.find(n => n.type === 'textarea').props.value, 'Unsaved vendor response');
  } finally { h.close(); }
});
