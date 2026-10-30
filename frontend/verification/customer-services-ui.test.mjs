import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, ui, session;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ui = await vite.ssrLoadModule('/src/components/services/CustomerServices.jsx');
  session = await vite.ssrLoadModule('/src/utils/customerSession.js');
});
after(async () => vite?.close());
test('existing legal catalogue settles empty responses and retries API failures', async () => {
  const legal = await vite.ssrLoadModule('/src/components/services/LegalServices.jsx');
  const h = hookHarness(legal.default, {}, '/services');
  try {
    h.requests[0].resolve({ data: [], meta: { total: 0 } }); await h.settle();
    assert.ok(h.find(n => n.type === 'h2' && n.props.children === 'No eligible services available'));
  } finally { h.close(); }
  const r = hookHarness(legal.default, {}, '/services');
  try {
    r.requests[0].resolve({ message: 'Temporary catalogue failure' }, 503); await r.settle();
    assert.ok(r.find(n => n.props?.role === 'alert'));
    assert.equal(r.find(n => n.type === 'h2' && n.props.children === 'No eligible services available'), undefined);
    r.click('Reload latest'); assert.equal(r.requests.length, 2);
  } finally { r.close(); }
});
test('Services discovery is always visible and public, private parcel history stays guarded', () => {
  const html = renderToStaticMarkup(React.createElement(ui.ServicesDiscovery));
  assert.match(html, /href="\/services"/); assert.match(html, /Send a Parcel/);
  assert.equal(session.isPublicCustomerPath('/services'), true);
  assert.equal(session.isPublicCustomerPath('/parcel-delivery/history'), false);
  assert.equal(session.isPublicCustomerPath('/legal-services/requests'), false);
});
const flags = { catalogue: true, booking: true, auto_assignment: true, admin_fallback: true, fulfilment: true, online_payment: true, productionBlocked: false };
for (const [name, f, enabled] of [['enabled', flags, true], ['disabled', { ...flags, booking: false }, false], ['production', { ...flags, productionBlocked: true }, false], ['fulfilment disabled', { ...flags, fulfilment: false }, false]]) {
  test(`parcel card: ${name}`, async () => {
    const h = hookHarness(ui.ParcelServiceCard);
    try {
      h.requests[0].resolve({ data: f }); await h.settle();
      if (enabled) {
        h.requests[1].resolve({ data: { ready: true } }); await h.settle();
        assert.equal(h.find(n => n.props?.className === 'service-book').props.href, '/parcel-delivery/book');
      } else {
        assert.ok(h.find(n => n.type === 'button' && n.props.disabled));
        assert.equal(h.requests.length, 1);
      }
      assert.ok(h.find(n => n.props?.href === '/parcel-delivery/history'));
    } finally { h.close(); }
  });
}
test('parcel availability errors fail closed and support retry', async () => {
  const h = hookHarness(ui.ParcelServiceCard);
  try {
    h.requests[0].resolve({}, 503); await h.settle();
    assert.ok(h.find(n => n.props?.role === 'alert'));
    assert.equal(h.find(n => n.props?.className === 'service-book'), undefined);
    h.click('Retry parcel availability'); assert.equal(h.requests.length, 2);
  } finally { h.close(); }
});
test('Services errors support retry and disabled catalogue leaves parcel card visible', async () => {
  const h = hookHarness(ui.default, {}, '/services');
  try {
    h.requests[0].resolve({}, 503); await h.settle(); h.click('Retry services');
    h.requests[1].resolve({ data: { catalogue: false } }); await h.settle();
    assert.ok(h.find(n => n.props?.role === 'status'));
    assert.ok(h.find(n => n.type === ui.ParcelServiceCard));
  } finally { h.close(); }
});

const legalId = '6ad3575911c3e944201f3501';
test('legal discovery checks the actual public catalogue before offering navigation', async () => {
  const h = hookHarness(ui.LegalServiceCard);
  try {
    assert.ok(h.find(n => n.props?.role === 'status'));
    h.requests[0].resolve({ data: { catalogue: true } }); await h.settle();
    assert.match(h.requests[1].url, /customer-services\?page=1&limit=1$/);
    assert.equal(h.find(n => n.props?.href === '/legal-services'), undefined);
    h.requests[1].resolve({ data: [{ _id: legalId }], meta: { total: 1 } }); await h.settle();
    assert.ok(h.find(n => n.props?.href === '/legal-services'));
  } finally { h.close(); }
});

test('disabled customer access is distinct from a successful empty public catalogue', async () => {
  for (const enabled of [false, true]) {
    const h = hookHarness(ui.LegalServiceCard);
    try {
      h.requests[0].resolve({ data: { catalogue: enabled } }); await h.settle();
      if (enabled) { h.requests[1].resolve({ data: [], meta: { total: 0 } }); await h.settle(); }
      assert.ok(h.find(n => n.type === 'p' && String(n.props.children).includes(enabled ? 'No customer legal services' : 'currently available')));
      assert.equal(h.requests.length, enabled ? 2 : 1);
      assert.equal(h.find(n => n.props?.role === 'alert'), undefined);
    } finally { h.close(); }
  }
});

for (const body of [{}, { success: false, data: [], meta: { total: 0 } }, { data: null }, { data: [], meta: {} }, { data: [{}], meta: { total: 1 } }, { data: [{ _id: 'legal-services' }], meta: { total: 1 } }, { data: [], meta: { total: 1 } }]) {
  test('invalid discovery response is retryable error, never service unavailability: ' + JSON.stringify(body), async () => {
    const h = hookHarness(ui.LegalServiceCard);
    try {
      h.requests[0].resolve({ data: { catalogue: true } }); await h.settle();
      h.requests[1].resolve(body); await h.settle();
      assert.ok(h.find(n => n.props?.role === 'alert'));
      assert.equal(h.find(n => n.props?.href === '/legal-services'), undefined);
      h.click('Retry legal availability');
      h.requests[2].resolve({ data: { catalogue: true } }); await h.settle();
      h.requests[3].resolve({ data: [{ _id: legalId }], meta: { total: 1 } }); await h.settle();
      assert.ok(h.find(n => n.props?.href === '/legal-services'));
    } finally { h.close(); }
  });
}

test('public catalogue network/API failures are errors and unmount ignores late availability', async () => {
  for (const network of [false, true]) {
    const h = hookHarness(ui.LegalServiceCard);
    try {
      h.requests[0].resolve({ data: { catalogue: true } }); await h.settle();
      if (network) h.requests[1].reject(new Error('Network failure'));
      else h.requests[1].resolve({ message: 'Database failed' }, 503);
      await h.settle(); assert.ok(h.find(n => n.props?.role === 'alert'));
    } finally { h.close(); }
  }
  const h = hookHarness(ui.LegalServiceCard);
  try {
    h.requests[0].resolve({ data: { catalogue: true } }); await h.settle();
    h.unmount(); const count = h.updates;
    h.requests[1].resolve({ data: [{ _id: legalId }], meta: { total: 1 } }); await h.settle();
    assert.equal(h.updates, count);
  } finally { h.close(); }
});

test('malformed catalogue and incorrect detail identifiers show errors without empty state or form', async () => {
  const legal = await vite.ssrLoadModule('/src/components/services/LegalServices.jsx');
  for (const [path, body] of [['/legal-services', { data: null }], ['/legal-services', { data: [{}], meta: { total: 1 } }], [`/legal-services/${legalId}`, { data: { _id: 'wrong-id', fields: [] } }]]) {
    const h = hookHarness(legal.default, {}, path);
    try {
      h.requests[0].resolve(body); await h.settle();
      assert.ok(h.find(n => n.props?.role === 'alert'));
      assert.equal(h.find(n => n.type === 'form'), undefined);
      assert.equal(h.find(n => n.type === 'h2' && n.props.children === 'No eligible services available'), undefined);
    } finally { h.close(); }
  }
});

test('valid uppercase ObjectId links still open the same published requirements', async () => {
  const legal = await vite.ssrLoadModule('/src/components/services/LegalServices.jsx');
  const h = hookHarness(legal.default, {}, '/legal-services/' + legalId.toUpperCase());
  try {
    h.requests[0].resolve({ data: { _id: legalId, name: 'Legal service', fields: [] } }); await h.settle();
    assert.ok(h.find(n => n.type === 'form'));
    assert.equal(h.find(n => n.props?.role === 'alert'), undefined);
  } finally { h.close(); }
});

