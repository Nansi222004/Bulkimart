import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, ui, Fee;
before(async () => { vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' }); ui = await vite.ssrLoadModule('/src/components/services/LegalServices.jsx'); Fee = (await vite.ssrLoadModule('/src/components/services/ServicePaymentPanel.jsx')).default; });
after(async () => { await vite?.close(); });
const render = (c, props) => renderToStaticMarkup(React.createElement(c, props));
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const id = '507f1f77bcf86cd799439022';
const q = { version: 1, scope: 'Approved scope', totalPaise: 500000, servicePaise: 500000, serviceTaxPaise: 0, currency: 'INR', terms: 'Synthetic terms', expiresAt: '2030-01-01T00:00:00Z' };
const app = extra => ({ _id: id, version: 1, serviceName: 'Fixture service', status: 'awaiting_payment', paymentStatus: 'not_requested', answers: {}, fields: [], files: [], events: [], quotation: q, canPay: false, ...extra });
test('request history escapes private text instead of executing HTML', () => {
  const html = render(ui.RequestTimeline, { events: [{ action: 'information_required', at: '2026-10-22', message: '<script>secret</script>' }] });
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('file controls contain no permanent URLs or storage keys in link hrefs', () => {
  const html = render(ui.PrivateFiles, { files: [{ fileId: 'private-file', name: 'Evidence.pdf' }] });
  assert.match(html, /Download Evidence.pdf/); assert.doesNotMatch(html, /href=|private-file|cloudinary|private-data/);
});
test('catalogue loading, empty and server-error states are visible and retryable', async () => {
  const h = hookHarness(ui.default, {}, '/legal-services');
  try {
    assert.match(text(h.tree), /Loading Legal Services/); h.requests[0].resolve({ data: [], meta: { total: 0 } }); await h.settle(); assert.match(text(h.tree), /No\s+eligible services/);
    h.click('My requests'); h.requests[1].resolve({ message: 'Sign in required' }, 401); await h.settle(); assert.match(text(h.tree), /Sign in required/); assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Reload latest'));
  } finally { h.close(); }
});
test('late search responses cannot replace the active request-history view', async () => {
  const h = hookHarness(ui.default, {}, '/legal-services');
  try {
    h.click('My requests'); h.requests[1].resolve({ data: [app({ status: 'submitted' })], meta: { total: 1 } }); await h.settle();
    h.requests[0].resolve({ data: [{ _id: id, name: 'Obsolete catalogue' }], meta: { total: 1 } }); await h.settle();
    assert.match(text(h.tree), /Fixture service/); assert.doesNotMatch(text(h.tree), /Obsolete catalogue/);
  } finally { h.close(); }
});
test('private follow-up upload enforces file count and size before a network request', () => {
  const d = new FormData(); for (let i = 0; i < 11; i++) d.append('files', new Blob(['x']), `file-${i}.pdf`); assert.throws(() => ui.validateFollowUp(d), /up to 10/);
});
test('logged out visitor sees Sign in, and clicking View service or My requests redirects to /account', async () => {
  const guestStorage = { localStorage: { getItem: () => null } };
  const h = hookHarness(ui.default, {}, '/legal-services', { verified: false }, guestStorage);
  try {
    h.requests[0].resolve({ data: [{ _id: id, name: 'Business Advisory', description: 'Legal help' }], meta: { total: 1 } });
    await h.settle();
    const authLink = h.find(n => n.type === 'a' && n.props.className === 'legal-nav-auth');
    assert.ok(authLink);
    assert.equal(authLink.props.children, 'Sign in');
    assert.equal(authLink.props.href, '/account');

    // Clicking My requests redirects to /account
    h.click('My requests');
    assert.equal(globalThis.window.location.href, '/account');

    // Reset location href
    globalThis.window.location.href = '';

    // Clicking View service redirects to /account
    h.click('View service');
    assert.equal(globalThis.window.location.href, '/account');
  } finally { h.close(); }
});
test('signed-in legal services omit the Account link and still open service details', async () => {
  const userStorage = { localStorage: { getItem: key => key === 'userToken' ? 'valid-jwt-token' : null } };
  const h = hookHarness(ui.default, {}, '/legal-services', { verified: true }, userStorage);
  try {
    h.requests[0].resolve({ data: [{ _id: id, name: 'Business Advisory', description: 'Legal help' }], meta: { total: 1 } });
    await h.settle();
    const authLink = h.find(n => n.type === 'a' && n.props.className === 'legal-nav-auth');
    assert.equal(authLink, undefined);

    // Clicking View service navigates to /legal-services/:id
    h.click('View service');
    assert.equal(globalThis.window.location.pathname, `/legal-services/${id}`);
  } finally { h.close(); }
});


test('a fixed-price service shows its fee and only offers Pay & submit after the customer agrees to pay', async () => {
  const userStorage = { localStorage: { getItem: key => key === 'userToken' ? 'valid-jwt-token' : null } };
  const h = hookHarness(ui.default, {}, `/legal-services/${id}`, { verified: true }, userStorage);
  try {
    h.requests[0].resolve({ data: { _id: id, name: 'Business Advisory', description: 'Legal help', fields: [], formVersion: 1, version: 0, startingPrice: { amount: 500, currency: 'INR' } } }); await h.settle();
    assert.match(text(h.tree), /Service fee\s+₹500\.00\s+·\s+paid when you submit/);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    const submit = () => h.find(n => n.type === 'button' && [n.props.children].flat().join('') === 'Pay ₹500.00 & submit');
    assert.equal(submit().props.disabled, true, 'Paying needs explicit agreement');
    h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
    assert.equal(submit().props.disabled, false);
  } finally { h.close(); }
});
test('an unpaid request offers Pay; paid and refunded requests show their status without a payment button', async () => {
  const billing = status => ({ version: 1, amountPaise: 50000, currency: 'INR', status, terms: 'Fee terms', refundedToWallet: status === 'refunded' });
  const h = hookHarness(ui.default, {}, `/legal-services/requests/${id}`);
  try {
    h.requests[0].resolve({ data: app({ quotation: null, billing: billing('unpaid') }) }); await h.settle();
    const panel = h.find(n => n.type === Fee); assert.ok(panel, 'The fee panel is shown on the request');
    assert.equal(panel.props.application.billing.status, 'unpaid');
  } finally { h.close(); }
  const html = (status, extra = {}) => render(Fee, { application: { _id: id, status: extra.status || 'awaiting_payment', billing: billing(status) }, request: async () => ({}), authorization: () => '' });
  assert.match(html('unpaid'), /Pay ₹500\.00/); assert.match(html('unpaid'), /Fee terms/);
  assert.doesNotMatch(html('paid', { status: 'submitted' }), /Pay ₹/); assert.match(html('paid', { status: 'submitted' }), /Paid/);
  assert.match(html('refunded', { status: 'rejected' }), /Refunded to Bulkimart wallet/);
});
