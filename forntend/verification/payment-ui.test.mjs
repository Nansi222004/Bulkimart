import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness,registerFeedback} from './componentHarness.mjs';
let vite,Checkout,Alerts,socket;
before(async()=>{vite=await createServer({server:{middlewareMode:true},appType:'custom'});
 registerFeedback((await vite.ssrLoadModule('/src/utils/feedback.js')).feedback);
 Checkout=(await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default;
 Alerts=(await vite.ssrLoadModule('/src/modules/Seller/components/SellerOrderAlerts.jsx')).default;
 socket=(await vite.ssrLoadModule('/src/utils/socket.js')).socket;socket.connect=()=>socket;
});
after(async()=>vite.close());
const noop=()=>{};
function storage(values={}){const entries={...values};return {getItem:key=>entries[key]??null,setItem:(key,value)=>{entries[key]=String(value)},removeItem:key=>{delete entries[key]}};}
const id='507f1f77bcf86cd799439022';
const row={_id:id,orderNo:'Fixture order',status:'placed',paymentMethod:'cod',paymentStatus:'pending'};
const context=overrides=>({sellerProfile:{_id:'507f1f77bcf86cd799439023',status:'approved'},setSelectedOrder:noop,openSellerOrder:async()=>true,...overrides});
const emit=(event,payload)=>socket.listeners(event).forEach(listener=>listener(payload));
function userFixture(overrides = {}) {
  const calls = [];
  const address = { _id: 'address', name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture', city: 'Mumbai', pincode: '400001', lat: 19.11, lng: 72.91 };
  const context = { savedAddresses: [address], selectedAddressId: 'address', setSelectedAddressId: noop, addAddress: noop, uploadLandmarkImage: noop,
    currentUser: { _id: 'buyer', name: 'Fixture Buyer', phone: '9876500000' }, getCartTotal: () => 140, getCartItems: () => [{ _id: 'line', productId: 'product', name: 'Fixture', price: 100, qty: 1 }],
    getDeliveryPoint: () => address, serverCart: { items: [{ name: 'Fixture', qty: 1, fulfillmentType: 'physical' }], pricing: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 } },
    cartChannel: 'ecommerce', deliveryMode: null, setDeliveryMode: noop, getCouponDiscount: () => 0, cartLoading: false, appliedCoupon: null, availableCoupons: [],
    fetchAvailableCoupons: noop, removeCoupon: noop, couponCode: '', tipSetting: { options: [] }, fetchTipSetting: noop, useCoinsSelected: false, toggleUseCoins: noop,
    walletBalance: 1000, fetchWalletBalance: noop, setActiveNav: noop, setSelectedOrder: noop,
    placeOrder: async (...args) => { calls.push(['single', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    placeUnifiedOrder: async (...args) => { calls.push(['unified', ...args]); return { ok: false, message: 'Fixture stop after submission' }; },
    ...overrides };
  return { context, calls };
}
const group = (key = 'shop', channel = 'ecommerce') => ({ key, channel, seller: { name: 'Fixture Store' }, deliveryMode: channel === 'ecommerce' ? 'scheduled' : null,
  requestedMode: channel === 'ecommerce' ? 'scheduled' : null, modeChosen: true, items: [{ itemId: key, name: 'Fixture', qty: 1, price: 100, lineTotal: 100, image: '' }], deliveryCharge: 40, total: 140 });
const basket = (groups = [group()]) => ({ success: true, data: { groups, needsDeliveryChoice: false, totals: { subtotal: groups.length * 100, deliveryCharge: groups.length * 40, totalAmount: groups.length * 140, itemCount: groups.length } } });
function harness(overrides) { const fixture = userFixture(overrides); return { ...fixture, h: hookHarness(Checkout, {}, '/checkout', fixture.context) }; }
const placeButton = h => h.find(n => n.type === 'button' && n.props.className === 'pd-add-to-cart-btn');
async function load(h, groups) { h.requests.find(req => req.url.includes('/api/cart/unified')).resolve(basket(groups)); await h.settle(); }
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return [node.props?.children].flat(Infinity).map(text).join(' '); }

for (const outcome of ['verified', 'cancelled', 'cancellation-unconfirmed', 'paid-before-dismissal', 'failed']) {
  test('active Razorpay shows a neutral background until ' + outcome + ', preserving recovery', async () => {
    let finishPayment, writes = 0, cancellations = 0;
    const payment = new Promise(resolve => { finishPayment = resolve; });
    const local = storage({ userToken: 'fixture-token' });
    const reference = { version: 1, customerId: 'buyer', operation: 'single', key: 'checkout-payment-background-fixture' };
    const fixture = userFixture({
      placeOrder: async () => {
        writes++;
        local.setItem('bulkimart:committed-checkout:buyer', JSON.stringify([reference]));
        return { ok: true, order: { _id: 'fixture-order', status: 'placed', pricing: { totalAmount: 140 } } };
      },
      initiateOnlinePayment: async () => payment,
      abandonCheckoutPayment: async orderId => {
        assert.equal(orderId, 'fixture-order');
        cancellations++;
        assert.equal(JSON.parse(local.getItem('bulkimart:committed-checkout:buyer')).length, 1);
        if (outcome === 'cancellation-unconfirmed') return { ok: false };
        if (outcome === 'paid-before-dismissal') return { ok: true, cancelled: false, status: 'paid' };
        return { ok: true, cancelled: true };
      },
    });
    const h = hookHarness(Checkout, {}, '/checkout', fixture.context, { localStorage: local, sessionStorage: storage() });
    try {
      await load(h);
      const option = h.find(n => n.type === 'label' && String(n.props.className).includes('checkout-payment') && text(n).includes('Razorpay Online Payment'));
      h.find(n => n.type === 'input' && n.props.type === 'radio', option).props.onChange(); h.flush();
      const submitting = placeButton(h).props.onClick(); await h.settle();
      assert.match(text(h.tree), /Complete your payment/);
      assert.equal(h.tree.props.reference, undefined);
      assert.doesNotMatch(text(h.tree), /Review payment status|Check Status|Order Placed Successfully/);
      assert.equal(JSON.parse(local.getItem('bulkimart:committed-checkout:buyer')).length, 1);
      assert.equal(writes, 1);
      finishPayment(outcome === 'verified' ? { ok: true, verified: true } : outcome === 'failed' ? { ok: false, message: 'Provider unavailable' } : { ok: false, cancelled: true });
      await submitting; h.flush();
      assert.doesNotMatch(text(h.tree), /Complete your payment/);
      if (outcome === 'verified' || outcome === 'paid-before-dismissal') {
        assert.match(text(h.tree), /Order Placed Successfully/);
        assert.equal(local.getItem('bulkimart:committed-checkout:buyer'), null);
      } else if (outcome === 'cancelled') {
        assert.match(text(h.tree), /Payment was cancelled/);
        assert.doesNotMatch(text(h.tree), /Order Placed Successfully|Track Active Orders/);
        assert.equal(local.getItem('bulkimart:committed-checkout:buyer'), null);
      } else {
        assert.equal(h.tree.props.reference.key, reference.key);
        assert.doesNotMatch(text(h.tree), /Order Placed Successfully|Track Active Orders/);
        assert.equal(JSON.parse(local.getItem('bulkimart:committed-checkout:buyer')).length, 1);
      }
      assert.equal(cancellations, ['verified', 'failed'].includes(outcome) ? 0 : 1);
      assert.equal(writes, 1);
    } finally { h.close(); }
  });
}

test('unpaid online order hints do not show a popup; later paid state does', async()=>{
 let state='pending';
 const session=storage({'bulkimart:seller-order-alerts:507f1f77bcf86cd799439023':JSON.stringify([id])});
 const h=hookHarness(Alerts,{},'/seller',context({fetchSellerOrder:async()=>({ok:true,data:{...row,paymentMethod:'online',paymentStatus:state}})}),{sessionStorage:session});
 try{h.requests[0].resolve({data:[]});await h.settle();h.requests.at(-1).resolve({data:[]});await h.settle();
 emit('new_order',{orderId:id});await h.settle();assert.equal(h.tree,null);
 state='paid';emit('new_order',{orderId:id});await h.settle();assert.match(text(h.tree),/New order received/);
 assert.equal(h.find(n=>n.type==='aside').props['aria-modal'],'true');
 const target={};h.tree.props.onClick({target,currentTarget:target});h.flush();assert.equal(h.tree,null);
 }finally{h.close();}
});

test('an uncertain payment also blocks duplicate checkout when browser recovery storage is unavailable', async () => {
 let writes = 0;
 const {h} = harness({placeOrder:async()=>{writes++;return {ok:true,order:{_id:'fixture-order',pricing:{totalAmount:140}}};},
   initiateOnlinePayment:async()=>({ok:false,message:'Payment result is unconfirmed'})});
 try {
   await load(h);
   const option=h.find(n=>n.type==='label'&&String(n.props.className).includes('checkout-payment')&&text(n).includes('Razorpay Online Payment'));
   h.find(n=>n.type==='input'&&n.props.type==='radio',option).props.onChange();h.flush();
   await placeButton(h).props.onClick();h.flush();
   assert.match(text(h.tree),/Payment result is unconfirmed/);
   assert.doesNotMatch(text(h.tree),/Order Placed Successfully/);
   assert.equal(placeButton(h).props.disabled,true);
   await placeButton(h).props.onClick();assert.equal(writes,1);
 } finally {h.close();}
});
