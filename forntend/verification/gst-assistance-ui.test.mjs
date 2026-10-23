import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Decision, Panel, valid, requests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Decision = (await vite.ssrLoadModule('/src/components/gst/GstDecision.jsx')).default;
  Panel = (await vite.ssrLoadModule('/src/components/gst/GstAssistance.jsx')).default;
  valid = (await vite.ssrLoadModule('/src/components/gst/gstApi.js')).gstDecisionValid;
  requests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => vite.close());
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const row = (status = 'pending') => ({ _id: 'vendor-request', status, version: 2, details: { businessName: 'Fixture', contactName: 'Contact' }, submittedAt: '2026-01-01', files: [], events: [] });

test('GSTIN choice, declining and assistance consent validate separate paths', () => {
  assert.equal(valid({}), false);
  assert.equal(valid({ choice: 'has_gstin', gstin: '29ABCDE1234F1Z5' }), true);
  assert.equal(valid({ choice: 'has_gstin', gstin: 'invalid' }), false);
  assert.equal(valid({ choice: 'no_gstin' }), false);
  assert.equal(valid({ choice: 'without_gstin' }), true);
  assert.equal(valid({ choice: 'assistance', contactName: 'Contact', consent: false }), false);
  assert.equal(valid({ choice: 'assistance', contactName: 'Contact', consent: true }), true);
});
test('initial GST question has no implied yes/no answer; changing to No clears GSTIN and consent', () => {
  const updates = [], h = hookHarness(Decision, { value: { choice: 'has_gstin', gstin: '29ABCDE1234F1Z5', consent: true }, onChange: v => updates.push(v) });
  try {
    assert.match(text(h.tree), /Do you have a GSTIN/);
    h.find(n => n.type === 'input' && n.props.name === 'has-gstin' && n.props.checked === false).props.onChange();
    assert.equal(updates[0].choice, 'no_gstin'); assert.equal(updates[0].gstin, ''); assert.equal(updates[0].consent, false);
    assert.match(text(h.tree), /format check only/);
  } finally { h.close(); }
});
test('no-GSTIN choice offers assistance and decline; assistance stays disabled when server capability is off', async () => {
  const h = hookHarness(Decision, { value: { choice: 'no_gstin' }, onChange: () => {} });
  try {
    h.requests[0].resolve({ success: true, data: { enabled: false } }); await h.settle();
    assert.match(text(h.tree), /Yes, Apply through Bulkimart/); assert.match(text(h.tree), /No, Continue without GST/);
    const radio = h.find(n => n.type === 'input' && n.props.name === 'gst-assistance'); assert.equal(radio.props.disabled, true);
    assert.match(text(h.tree), /applicable GST requirements/);
  } finally { h.close(); }
});
test('assistance form asks for minimum contact details and consent, without government or payment claims', () => {
  const h = hookHarness(Decision, { value: { choice: 'assistance', consent: false }, onChange: () => {} });
  try {
    assert.match(text(h.tree), /Contact person name/); assert.match(text(h.tree), /does not authorize government filing/);
    assert.match(text(h.tree), /No fee is collected/); assert.equal(h.find(n => n.type === 'input' && n.props.type === 'file'), undefined);
    assert.equal(h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, false);
  } finally { h.close(); }
});
test('vendor pending panel submits a versioned cancellation with the seller session', async () => {
  requests.clearPortalRequests(); const h = hookHarness(Panel);
  try {
    h.requests[0].resolve({ success: true, data: row() }); await h.settle();
    assert.match(text(h.tree), /Pending assistance review/); const pending = h.click('Cancel pending assistance request');
    assert.equal(h.requests[1].options.method, 'POST'); assert.equal(h.requests[1].options.body.get('action'), 'cancel');
    assert.equal(h.requests[1].options.body.get('version'), '2'); assert.match(h.requests[1].url, /sellers\/gst-assistance\/me\/actions/);
    h.requests[1].resolve({ success: true, data: row('cancelled') }); await pending; await h.settle();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Cancel pending assistance request'), undefined);
  } finally { h.close(); requests.clearPortalRequests(); }
});
test('requested-information panel exposes a response; approval label does not imply government approval', async () => {
  requests.clearPortalRequests(); const h = hookHarness(Panel);
  try {
    h.requests[0].resolve({ success: true, data: { ...row('additional_information_required'), requestedCorrections: 'Requested business evidence' } }); await h.settle();
    assert.match(text(h.tree), /Requested business evidence/); assert.ok(h.find(n => n.type === 'textarea'));
    assert.ok(h.find(n => n.type === 'input' && n.props.type === 'file'));
    assert.match(text(h.tree), /does not grant permission to sell/);
  } finally { h.close(); requests.clearPortalRequests(); }
});
test('admin workspace filters statuses and uses only authorized request details', async () => {
  requests.clearPortalRequests(); const h = hookHarness(Panel, { admin: true });
  try {
    assert.match(h.requests[0].url, /admin\/gst-assistance\?page=1&status=/);
    h.requests[0].resolve({ success: true, data: { requests: [row('approved')] } }); await h.settle();
    assert.match(text(h.tree), /Assistance accepted — not government approval/);
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'under_review' } }); h.flush();
    assert.match(h.requests.at(-1).url, /status=under_review/);
  } finally { h.close(); requests.clearPortalRequests(); }
});
test('denied admin access renders an error and no private request details', async () => {
  requests.clearPortalRequests(); const h = hookHarness(Panel, { admin: true });
  try { h.requests[0].resolve({ message: 'Vendor management permission required' }, 403); await h.settle();
    assert.match(text(h.tree), /Vendor management permission required/); assert.equal(h.find(n => n.type === 'textarea'), undefined);
  } finally { h.close(); requests.clearPortalRequests(); }
});
test('older admin detail responses cannot replace the currently selected vendor', async () => {
  requests.clearPortalRequests(); const a = row(), b = { ...row(), _id: 'second', details: { businessName: 'Second vendor', contactName: 'Second' } };
  const h = hookHarness(Panel, { admin: true });
  try {
    h.requests[0].resolve({ success: true, data: { requests: [a, b] } }); await h.settle();
    const first = h.find(n => n.type === 'button' && String(n.props.children).includes('Fixture'));
    const second = h.find(n => n.type === 'button' && String(n.props.children).includes('Second vendor'));
    const pendingA = first.props.onClick(), pendingB = second.props.onClick();
    h.requests[2].resolve({ success: true, data: b }); await pendingB; await h.settle();
    h.requests[1].resolve({ success: true, data: a }); await pendingA; await h.settle();
    assert.ok(h.find(n => n.type === 'p' && text(n).includes('Second vendor')));
    assert.equal(h.find(n => n.type === 'p' && text(n).includes('Fixture · Contact')), undefined);
  } finally { h.close(); requests.clearPortalRequests(); }
});
test('switching admin request clears completion GSTIN, evidence reference and verification attestation', async () => {
  requests.clearPortalRequests(); const a = row('approved'), b = { ...row('approved'), _id: 'second', details: { businessName: 'Second vendor' } };
  const h = hookHarness(Panel, { admin: true });
  try {
    h.requests[0].resolve({ success: true, data: { requests: [a, b] } }); await h.settle();
    const first = h.find(n => n.type === 'button' && String(n.props.children).includes('Fixture'));
    const pendingA = first.props.onClick(); h.requests[1].resolve({ success: true, data: a }); await pendingA; await h.settle();
    h.find(n => n.type === 'select' && n.props.children?.[0]?.props?.children === 'Choose a transition').props.onChange({ target: { value: 'completed' } }); h.flush();
    h.find(n => n.type === 'input' && n.props.maxLength === 15).props.onChange({ target: { value: '29ABCDE1234F1Z5' } });
    h.find(n => n.type === 'input' && n.props.maxLength === 500).props.onChange({ target: { value: 'Private evidence reference' } });
    h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
    const second = h.find(n => n.type === 'button' && String(n.props.children).includes('Second vendor'));
    const pendingB = second.props.onClick(); h.requests[2].resolve({ success: true, data: b }); await pendingB; await h.settle();
    h.find(n => n.type === 'select' && n.props.children?.[0]?.props?.children === 'Choose a transition').props.onChange({ target: { value: 'completed' } }); h.flush();
    assert.equal(h.find(n => n.type === 'input' && n.props.maxLength === 15).props.value, '');
    assert.equal(h.find(n => n.type === 'input' && n.props.maxLength === 500).props.value, '');
    assert.equal(h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.checked, false);
  } finally { h.close(); requests.clearPortalRequests(); }
});
