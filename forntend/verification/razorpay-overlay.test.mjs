import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, open;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  open = (await vite.ssrLoadModule('/src/utils/razorpayCheckout.js')).openRazorpayCheckout;
});
after(async () => vite.close());
function fixture() {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  let options, events = {}, closes = 0;
  globalThis.window = { Razorpay: class {
    constructor(value) { options = value; }
    on(event, handler) { events[event] = handler; }
    open() {}
    close() { closes++; options.modal.ondismiss(); }
  } };
  return { get options() { return options; }, events, get closes() { return closes; }, restore() { Object.assign(globalThis, previous); } };
}
const checkout = { orderId: 'fixture-order', keyId: 'fixture-key', razorpayOrderId: 'fixture-gateway-order', amountPaise: 10000, currency: 'INR' };
test('provider dismissal during verification cannot replace a trusted paid result with cancellation', async () => {
  const f = fixture(); let respond;
  try {
    globalThis.fetch = () => new Promise(resolve => { respond = resolve; });
    const pending = open(checkout, { Authorization: 'Bearer fixture-login' }); await Promise.resolve();
    const verifying = f.options.handler({ razorpay_payment_id: 'fixture-capture' });
    f.options.modal.ondismiss();
    respond({ ok: true, json: async () => ({ data: { status: 'paid' } }) }); await verifying;
    assert.equal((await pending).verified, true); assert.equal(f.closes, 1);
  } finally { f.restore(); }
});
test('terminal payment failure closes the provider before exposing recovery', async () => {
  const f = fixture();
  try {
    const pending = open(checkout, {}); await Promise.resolve();
    f.events['payment.failed']({ error: { description: 'Fixture failure' } });
    assert.deepEqual(await pending, { ok: false, message: 'Fixture failure' }); assert.equal(f.closes, 1);
  } finally { f.restore(); }
});
test('unverified frontend success is rejected and duplicate handler callbacks are ignored', async () => {
  const f = fixture(); let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return { ok: false, json: async () => ({ message: 'Verification rejected' }) }; };
    const pending = open(checkout, {}); await Promise.resolve();
    await Promise.all([f.options.handler({}), f.options.handler({})]);
    assert.equal((await pending).ok, false); assert.equal(calls, 1); assert.equal(f.closes, 1);
  } finally { f.restore(); }
});

test('GST assistance checkout verifies through its dedicated vendor payment endpoint',async()=>{
  const f=fixture();let target;
  try{
    globalThis.fetch=async url=>{target=String(url);return {ok:true,json:async()=>({data:{status:'paid'}})};};
    const pending=open({...checkout,verificationPath:'/api/sellers/gst-assistance/payments/verify'},{Authorization:'Bearer fixture-seller'});await Promise.resolve();
    await f.options.handler({razorpay_payment_id:'pay_gst_fixture'});
    assert.equal((await pending).verified,true);assert.ok(target.endsWith('/api/sellers/gst-assistance/payments/verify'));
  }finally{f.restore();}
});
