import '../config/bootstrap.js';
import mongoose from 'mongoose';
import { io } from 'socket.io-client';
import Order from '../models/Order.js';
import DeliveryPartner from '../models/DeliveryPartner.js';

/**
 * Walks the whole Quick Commerce loop once, as three separate clients —
 * a shopper, a seller and a rider — each holding its own socket, so every
 * "ring" is verified by actually arriving rather than by being logged.
 */

const B = 'http://localhost:5050/api';
const WS = 'http://localhost:5050';

const J = async (m, u, body, token) => {
  const r = await fetch(B + u, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) };
};

const step = (n, t) => console.log(`\n${'─'.repeat(64)}\n${n}. ${t}\n${'─'.repeat(64)}`);
const ok = (m) => console.log('   ✅ ' + m);
const bad = (m) => console.log('   ❌ ' + m);
const info = (m) => console.log('      ' + m);

/** Connect a socket, join a room, and collect named events. */
const listener = (token, joinEvent, id, events) => {
  const s = io(WS, { auth: { token }, transports: ['websocket'] });
  const seen = {};
  return new Promise((resolve) => {
    s.on('connect', () => {
      s.emit(joinEvent, id);
      for (const e of events) s.on(e, (p) => { (seen[e] ||= []).push(p); });
      // Give the join a moment to land before anything is emitted at it.
      setTimeout(() => resolve({ socket: s, seen }), 300);
    });
  });
};

const waitFor = async (seen, event, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (seen[event]?.length) return seen[event][0];
    await new Promise((r) => setTimeout(r, 150));
  }
  return undefined;
};

/**
 * Sign in as somebody.
 *
 * The OTP endpoint is rate limited to a handful of requests per number per
 * quarter of an hour, which is correct — it costs money per SMS in production —
 * but it means running this script repeatedly eventually locks the fixed cast
 * out. Left unchecked that surfaces as a TypeError several lines later, which
 * reads like the code broke rather than the limiter doing its job.
 */
const login = async (phone) => {
  const s = await J('POST', '/auth/send-otp', { phone });

  if (s.status === 429) {
    throw new Error(
      `Rate limited signing in as ${phone}: ${s.body.message}\n`
      + '      This is the limiter working, not a failure of the flow.\n'
      + '      Wait for the window to pass, or restart the server to clear the in-memory counter.'
    );
  }
  if (!s.ok) throw new Error(`send-otp failed for ${phone}: ${s.body.message || s.status}`);

  const v = await J('POST', '/auth/verify-otp', { phone, otp: s.body.otp });
  if (!v.ok || !v.body.token) {
    throw new Error(`verify-otp failed for ${phone}: ${v.body.message || v.status}`);
  }
  return v.body;
};

const run = async () => {
  // ── cast ────────────────────────────────────────────────────────────────
  step(0, 'Cast');
  const sellerAuth = await login('7999810344');            // amit's shop
  const sellerMe = await J('GET', '/sellers/me', null, sellerAuth.token);
  const seller = sellerMe.body.seller;
  info(`seller : ${seller.storeDetails?.name} (${seller.status})  ${seller.storeDetails?.lat},${seller.storeDetails?.lng}`);
  if (seller.status !== 'approved') return bad('seller is not approved — cannot proceed');

  const riderAuth = await login('9573194349');             // Pooja Ingle, approved
  const riderMe = await J('GET', '/delivery/me', null, riderAuth.token);
  const rider = riderMe.body.data;

  /**
   * Start from a clean rider.
   *
   * A previous run leaves the test rider holding an order it never delivered,
   * and going on duty is now — correctly — refused while anything is open. So
   * the harness releases its own leftovers rather than the run failing with
   * "you are currently busy", which reads like a product fault and is not one.
   */
  await mongoose.connect(process.env.MONGO_URI);
  const leftovers = await Order.updateMany(
    { deliveryPartnerId: rider._id, status: { $nin: ['delivered', 'cancelled'] } },
    { $set: { status: 'dispatched' }, $unset: { deliveryPartnerId: '', deliveryId: '' } }
  );
  await DeliveryPartner.updateOne({ _id: rider._id }, { $set: { isAvailable: false } });
  if (leftovers.modifiedCount) info(`released ${leftovers.modifiedCount} leftover delivery/deliveries from an earlier run`);
  info(`rider  : ${rider.name} (${rider.status})  ${rider.baseLocation?.lat},${rider.baseLocation?.lng}`);
  if (rider.status !== 'approved') return bad('rider is not approved — cannot proceed');

  // A rider is only pinged if they are on duty AND within the pickup radius of
  // the store. This rider is based in Nagpur and the store is in Indore, so put
  // them on shift near the shop — the same thing they would do in real life.
  const goOnline = await J('PUT', '/delivery/availability', { isAvailable: true }, riderAuth.token);
  info(`on duty: ${goOnline.ok ? goOnline.body.data.isAvailable : goOnline.body.message}`);

  const moved = await J('PUT', '/delivery/location', {
    lat: seller.storeDetails.lat + 0.004,     // ~450 m from the shop
    lng: seller.storeDetails.lng + 0.004,
    source: 'gps', accuracy: 12,
    address: 'Near the store', city: seller.storeDetails.city, pincode: seller.storeDetails.pincode,
  }, riderAuth.token);
  info(`rider moved to: ${moved.ok ? moved.body.data.lat + ',' + moved.body.data.lng : moved.body.message}`);

  const buyerPhone = '9591' + Math.floor(100000 + Math.random() * 899999);
  const buyerAuth = await login(buyerPhone);
  info(`buyer  : ${buyerPhone}`);

  // ── sockets ─────────────────────────────────────────────────────────────
  const buyerL = await listener(buyerAuth.token, 'join_user', buyerAuth.user._id,
    ['order_status_updated', 'rider_assigned', 'otp_ready', 'order_delivered', 'delivery_status_updated']);
  const sellerL = await listener(sellerAuth.token, 'join_seller', seller._id,
    ['new_order', 'rider_assigned', 'order_delivered']);
  const riderL = await listener(riderAuth.token, 'join_rider', rider._id,
    ['rider_ping']);
  ok('three sockets connected and joined');

  // ── 1. shopper places a Quick order ─────────────────────────────────────
  step(1, 'Shopper places a Quick Commerce order');
  const prods = (await (await fetch(B + '/products?type=grocery&limit=20')).json()).products || [];
  const mine = prods.filter((p) => String(p.sellerId?._id || p.sellerId) === String(seller._id) && p.stock > 2);
  if (!mine.length) return bad(`no in-stock grocery products belong to ${seller.storeDetails?.name}`);
  info(`picking "${mine[0].name}" (stock ${mine[0].stock})`);

  await J('DELETE', '/cart?channel=grocery', null, buyerAuth.token);
  const add = await J('POST', '/cart', { productId: mine[0]._id, qty: 1 }, buyerAuth.token);
  if (!add.ok) return bad('add to cart: ' + add.body.message);

  const place = await J('POST', '/orders', {
    channel: 'grocery',
    paymentMethod: 'cod',
    shippingAddress: {
      name: 'Loop Tester', phone: buyerPhone,
      line1: '12 Test Lane', city: 'Indore', state: 'MP', pincode: '452001',
      lat: 22.7196, lng: 75.8577,
    },
  }, buyerAuth.token);
  if (!place.ok) return bad('place order: ' + place.body.message);
  const order = place.body.data.order;
  ok(`order ${order.orderNo} placed · ₹${order.pricing.totalAmount} · ${order.status}`);

  // ── 2. does it ring the seller? ─────────────────────────────────────────
  step(2, 'Seller is rung');
  const ring = await waitFor(sellerL.seen, 'new_order');
  if (ring) ok(`seller received new_order for ${ring.orderNo}`);
  else bad('seller never received new_order');

  // ── 3. seller walks the order forward ───────────────────────────────────
  step(3, 'Seller: confirm → preparing → dispatched');
  for (const s of ['confirmed', 'preparing', 'dispatched']) {
    const r = await J('PATCH', `/sellers/orders/${order._id}/status`, { status: s }, sellerAuth.token);
    if (r.ok) ok(`→ ${s}`);
    else { bad(`→ ${s} failed: ${r.body.message}`); return; }
  }
  const buyerSaw = await waitFor(buyerL.seen, 'order_status_updated');
  if (buyerSaw) ok(`buyer received order_status_updated (${buyerSaw.status})`);
  else bad('buyer never received order_status_updated');

  // ── 4. does it ring the rider? ──────────────────────────────────────────
  step(4, 'Rider is pinged');
  const ping = await waitFor(riderL.seen, 'rider_ping', 8000);
  if (ping) {
    ok(`rider received rider_ping for ${ping.orderNo}`);
    info(`pickup shown to rider: "${ping.merchantName}" — ${ping.merchantAddress}`);
    info(`distance shown to rider: ${ping.distance} km`);
  } else {
    bad('rider never received rider_ping');
  }

  // ── 5. rider accepts ────────────────────────────────────────────────────
  step(5, 'Rider accepts');
  const acc = await J('POST', `/delivery/orders/${order._id}/accept`, {}, riderAuth.token);
  if (!acc.ok) { bad('accept failed: ' + acc.body.message); return; }
  ok('accepted');
  const assigned = await waitFor(buyerL.seen, 'rider_assigned');
  if (assigned) ok('buyer received rider_assigned'); else bad('buyer never received rider_assigned');

  // ── 6. rider legs ───────────────────────────────────────────────────────
  step(6, 'Rider: arrived at store → picked up');
  for (const s of ['arrived_at_store', 'picked_up']) {
    const r = await J('PATCH', `/delivery/orders/${order._id}/status`, { status: s }, riderAuth.token);
    if (r.ok) ok(`→ ${s}`); else bad(`→ ${s} failed: ${r.body.message}`);
  }

  // ── 7. OTP ──────────────────────────────────────────────────────────────
  step(7, 'OTP');
  const gen = await J('POST', `/delivery/orders/${order._id}/generate-otp`, {}, riderAuth.token);
  if (!gen.ok) { bad('generate-otp failed: ' + gen.body.message); return; }
  const buyerOtp = await waitFor(buyerL.seen, 'otp_ready');
  ok('OTP generated');

  // The rider must be told a code was sent, and nothing more.
  const leaked = JSON.stringify(gen.body).match(/\b\d{4}\b/);
  if (leaked) bad(`rider's response leaked the code: ${JSON.stringify(gen.body.data)}`);
  else ok(`rider's response carries no code: ${JSON.stringify(gen.body.data)}`);

  if (buyerOtp?.otp) ok(`buyer received the code over their socket: ${buyerOtp.otp}`);
  else bad('buyer never received otp_ready');

  const wrong = await J('POST', `/delivery/orders/${order._id}/verify-otp`, { otp: '0000' }, riderAuth.token);
  console.log(`      wrong code → ${wrong.status} ${wrong.ok ? 'ACCEPTED (bad!)' : '· ' + wrong.body.message}`);

  const realOtp = buyerOtp?.otp;
  if (!realOtp) { bad('cannot continue without the code the buyer received'); return; }
  const done = await J('POST', `/delivery/orders/${order._id}/verify-otp`, { otp: realOtp }, riderAuth.token);
  if (done.ok) ok('correct OTP accepted'); else bad('correct OTP rejected: ' + done.body.message);

  // ── 8. final state ──────────────────────────────────────────────────────
  step(8, 'Final state');
  const delivered = await waitFor(buyerL.seen, 'order_delivered');
  if (delivered) ok('buyer received order_delivered'); else bad('buyer never received order_delivered');

  const final = await J('GET', `/orders/${order._id}`, null, buyerAuth.token);
  const o = final.body.data || final.body.order || final.body;
  info(`order status: ${o.status}`);
  info(`timeline: ${(o.timeline || []).map((t) => t.status).join(' → ')}`);

  buyerL.socket.close(); sellerL.socket.close(); riderL.socket.close();
  await mongoose.disconnect();
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
