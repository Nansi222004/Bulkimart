import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, open;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
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

test('wallet checkout sends signed results to the wallet verification endpoint', async () => {
  const f = fixture(); let target, payload;
  try {
    globalThis.fetch = async (url, options) => { target = String(url); payload = JSON.parse(options.body); return { ok: true, json: async () => ({ data: { status: 'paid' } }) }; };
    const pending = open({ ...checkout, verificationPath: '/api/wallet/topup/verify' }, {}); await Promise.resolve();
    await f.options.handler({ razorpay_payment_id: 'pay_wallet', razorpay_signature: 'signed-result' });
    assert.equal((await pending).verified, true);
    assert.ok(target.endsWith('/api/wallet/topup/verify'));
    assert.equal(payload.orderId, checkout.orderId); assert.equal(payload.razorpay_signature, 'signed-result');
  } finally { f.restore(); }
});
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

test('failed checkout SDK loading can be retried instead of permanently caching its rejection',async()=>{
  const previous={window:globalThis.window,document:globalThis.document},scripts=[];
  globalThis.window={};globalThis.document={createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}};
  try{
    const first=open(checkout,{});scripts[0].onerror();await assert.rejects(first,/load Razorpay/);
    const retry=open(checkout,{}),guarded=retry.catch(error=>({error}));await Promise.resolve();
    assert.equal(scripts.length,2,'Retry must make a fresh SDK request');
    window.Razorpay=class{constructor(options){this.options=options;}on(){}close(){}open(){this.options.modal.ondismiss();}};
    scripts[1].onload();assert.equal((await guarded).cancelled,true);
  }finally{Object.assign(globalThis,previous);}
});

test('a stalled checkout SDK load times out and a subsequent attempt remains available',async t=>{
  const previous={window:globalThis.window,document:globalThis.document},scripts=[];
  globalThis.window={};globalThis.document={createElement:()=>({remove(){this.removed=true;}}),head:{appendChild:s=>scripts.push(s)}};
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const first=open(checkout,{}),rejected=assert.rejects(first,/too long to load/);t.mock.timers.tick(15000);await rejected;
    assert.equal(scripts[0].removed,true);
    const retry=open(checkout,{});assert.equal(scripts.length,2);
    window.Razorpay=class{constructor(options){this.options=options;}on(){}close(){}open(){this.options.modal.ondismiss();}};
    scripts[1].onload();assert.equal((await retry).cancelled,true);
  }finally{t.mock.timers.reset();Object.assign(globalThis,previous);}
});
