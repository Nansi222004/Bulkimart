import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, services, LegalServices, PaymentPanel;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  services = await vite.ssrLoadModule('/src/components/services/ServicesPanel.jsx');
  LegalServices = (await vite.ssrLoadModule('/src/components/services/LegalServices.jsx')).default;
  PaymentPanel = (await vite.ssrLoadModule('/src/components/services/ServicePaymentPanel.jsx')).default;
});
after(async () => { await vite?.close(); });
const id = '507f1f77bcf86cd799439031', serviceId = '507f1f77bcf86cd799439032';
const fields = [{ id: 'optional', type: 'text', label: 'Optional answer' }];
const record = { _id: id, status: 'awaiting_payment', snapshot: { name: 'Fixture service', fields, pricing: { mode: 'fixed', amount: 100, currency: 'INR' } }, billing: { version: 1, amountPaise: 10000, status: 'unpaid', terms: 'Synthetic fee terms' } };
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };
const stores = () => { const localStorage = storage(); localStorage.setItem('sellerToken', 'seller-fixture'); localStorage.setItem('userToken', 'buyer-fixture'); return { localStorage, sessionStorage: storage() }; };
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const render = (c, props) => renderToStaticMarkup(React.createElement(c, props));

test('vendor detail renders omitted optional answers/files/history and new payment statuses without crashing', () => {
  for (const status of ['submitted', 'awaiting_payment', 'payment_verified', 'disputed']) {
    const html = render(services.ApplicationDetail, { application: { ...record, status } });
    assert.match(html, /Optional answer/); assert.match(html, /—/); assert.match(html, /History/);
  }
});

test('admin can request a fixed fee, paid work is blocked until verified, and free services do not request payment', () => {
  const html = render(services.ApplicationDetail, { application: { ...record, status: 'under_review', billing: undefined }, admin: true });
  assert.match(html, /Request payment/); assert.doesNotMatch(html, /value="in_progress"/);
  const free = render(services.ApplicationDetail, { application: { ...record, status: 'under_review', billing: undefined, snapshot: { ...record.snapshot, pricing: { mode: 'free', amount: 0, currency: 'INR' } } }, admin: true });
  assert.doesNotMatch(free, /Request payment/); assert.match(free, /value="in_progress"/);
});

test('vendor checkout requires accepted terms, sends the fixed fee/version, blocks duplicate clicks and does not claim a cancelled payment', async () => {
  const calls = [], state = stores(); let opened = 0;
  const h = hookHarness(PaymentPanel, { application: record, request: async (path, options) => { calls.push({ path, options }); return { data: { orderId: id } }; }, checkout: async () => { opened++; return { cancelled: true, message: 'Payment cancelled' }; } }, '/seller/services', undefined, state);
  try {
    const button = () => h.find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').includes('Pay ₹100.00'));
    assert.equal(button().props.disabled, true);
    h.find(n => n.type === 'input').props.onChange({ target: { checked: true } }); h.flush();
    const first = button().props.onClick(), second = button().props.onClick(); await Promise.all([first, second]); h.flush();
    assert.equal(calls.length, 1); assert.equal(opened, 1);
    assert.equal(calls[0].path, `/applications/${id}/payment`);
    assert.deepEqual(JSON.parse(calls[0].options.body), { feeVersion: 1, amountPaise: 10000, acceptTerms: true });
    assert.match(text(h.tree), /Payment cancelled/); assert.doesNotMatch(text(h.tree), /Payment verified/);
    assert.ok(state.sessionStorage.getItem(`service-payment:${id}:1`));
  } finally { h.close(); }
});

test('verified checkout refreshes the application, while a failed initiation remains recoverable', async () => {
  for (const failed of [false, true]) {
    let updated = 0, opened = 0; const state = stores();
    const h = hookHarness(PaymentPanel, { application: record,
      request: async () => { if (failed) throw Error('Checkout unavailable. Retry after checking payment status.'); return { data: {} }; },
      checkout: async () => { opened++; return { verified: true }; }, onUpdated: async () => { updated++; },
    }, '/seller/services', undefined, state);
    try {
      h.find(n => n.type === 'input').props.onChange({ target: { checked: true } }); h.flush();
      await h.find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').includes('Pay ₹100.00')).props.onClick(); h.flush();
      assert.equal(updated, failed ? 0 : 1); assert.equal(opened, failed ? 0 : 1);
      assert.match(text(h.tree), failed ? /Checkout unavailable/ : /Payment verified/);
      assert.equal(h.find(n => n.type === 'button' && text(n).replace(/\s+/g, ' ').includes('Pay ₹100.00')).props.disabled, false);
    } finally { h.close(); }
  }
});

test('customer submission clears the old catalogue detail before rendering the new request route', async () => {
  const h = hookHarness(LegalServices, {}, `/legal-services/${serviceId}`, { verified: true }, stores());
  try {
    h.requests[0].resolve({ data: { _id: serviceId, name: 'Fixture service', fields, formVersion: 1, version: 0 } }); await h.settle();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    assert.match(h.requests[1].url, /applications$/);
    h.requests[1].resolve({ data: { _id: id } }, 201); await h.settle();
    assert.equal(window.location.pathname, `/legal-services/requests/${id}`);
    assert.match(text(h.tree), /Loading Legal Services/);
    h.requests[2].resolve({ data: { _id: id, serviceName: 'Fixture service', fields, status: 'submitted', paymentStatus: 'not_requested', files: [], events: [] } }); await h.settle();
    assert.match(text(h.tree), /Reference:/); assert.match(text(h.tree), /Awaiting an admin-confirmed quotation/);
    h.click('Refresh request');
    h.requests[3].resolve({ data: { _id: id, serviceName: 'Fixture service', fields, status: 'awaiting_payment', canPay: true, paymentStatus: 'not_requested', quotation: { version: 1, totalPaise: 10000, servicePaise: 10000, terms: 'Synthetic terms' }, files: [], events: [] } }); await h.settle();
    assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Pay confirmed amount'));
  } finally { h.close(); }
});

test('vendor submission with empty optional answers opens its application instead of crashing', async () => {
  const h = hookHarness(services.default, {}, '/seller/services', undefined, stores());
  try {
    h.requests[0].resolve({ data: [{ _id: serviceId, name: 'Fixture service', fields, pricing: record.snapshot.pricing, formVersion: 1, __v: 0 }], meta: { total: 1 } }); await h.settle();
    h.click('View requirements and apply'); h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    h.requests[1].resolve({ data: { ...record, status: 'submitted', billing: undefined } }, 201); await h.settle();
    const detail = h.find(n => n.type === services.ApplicationDetail);
    assert.ok(detail); assert.match(render(services.ApplicationDetail, detail.props), /Fixture service/);
    assert.match(text(h.tree), /submitted successfully/);
  } finally { h.close(); }
});
