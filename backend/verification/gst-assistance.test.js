import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const notify = jest.fn(async () => ({}));
const gatewayOrders=new Map(),gatewayPayments=new Map();let uncertainCheckout=false;
jest.unstable_mockModule('razorpay',()=>({default:class{
  constructor(){this.orders={create:async input=>{const row={id:`order_gst_${gatewayOrders.size+1}`,...input};gatewayOrders.set(row.id,row);if(uncertainCheckout)throw Error('Synthetic unknown creation');return row;},fetch:async id=>gatewayOrders.get(id),all:async input=>({items:[...gatewayOrders.values()].filter(o=>!input.receipt||o.receipt===input.receipt)}),fetchPayments:async id=>({items:[...gatewayPayments.values()].filter(p=>p.order_id===id)})};this.payments={fetch:async id=>gatewayPayments.get(id)};}
}}));
jest.unstable_mockModule('../services/notification.service.js', () => ({ notifyAllAdmins: notify, notifySeller: notify, notifyUser: notify, notifyRider: notify,
  registerPushToken: notify, removePushToken: notify, pushToUser: notify, NOTIFICATION_EVENT: { SYSTEM: 'SYSTEM' } }));
const originalCloudinary = await import('../services/cloudinary.service.js');
jest.unstable_mockModule('../services/cloudinary.service.js', () => ({ ...originalCloudinary, uploadToCloudinary: async () => 'https://example.test/legacy-kyc-fixture' }));
const [{ default: Seller }, { default: User }, { default: Admin }, { default: Gst }, { gstAssistanceRouter },
  { default: sellerRoutes }, { errorHandler }, { JWT_SECRET }, { gstAssistanceCapabilities }] = await Promise.all([
  import('../models/Seller.js'), import('../models/User.js'), import('../models/Admin.js'), import('../models/GstAssistanceRequest.js'),
  import('../routes/gstAssistance.routes.js'), import('../routes/seller.routes.js'), import('../middlewares/error.middleware.js'),
  import('../config/jwt.js'), import('../services/gstAssistance.service.js'),
]);
const app = express(); app.use(express.json());
app.use('/sellers/gst-assistance', gstAssistanceRouter()); app.use('/admin/gst-assistance', gstAssistanceRouter(true)); app.use('/sellers', sellerRoutes); app.use(errorHandler);
let db, root, vendor, other, admin, denied, seller;
const {default:Fee}=await import('../models/GstAssistanceFee.js');
const {default:Payment}=await import('../models/Payment.js');
const {default:Ledger}=await import('../models/SellerLedgerEntry.js');
const {handleGstWebhook}=await import('../services/gstPayment.service.js');
const crypto=await import('node:crypto');
const auth = (r, u = vendor, type = 'user', role = 'seller') => r.set('Authorization', `Bearer ${jwt.sign({ id: String(u._id), type, role }, JWT_SECRET)}`);
const detail = async () => (await auth(request(app).get('/sellers/gst-assistance/me')).expect(200)).body.data;
const payload = extra => ({ pan: 'ABCDE1234F', gstChoice: 'assistance', gstAssistanceConsent: true, gstContactName: 'Fixture Contact', gstAssistanceMessage: 'Need registration guidance', ...extra });
const submit = (body = payload()) => auth(request(app).put('/sellers/step/4')).send(body);
const adminAction = async (action, extra = {}, files = []) => {
  const row = await Gst.findById(seller._id);
  let r = auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', row.__v).field('action', action);
  for (const [k, v] of Object.entries(extra)) r = r.field(k, String(v));
  for (const f of files) r = r.attach('documents', f.bytes, { filename: f.name, contentType: f.mime });
  return r;
};
const pdf = { bytes: Buffer.from('%PDF-1.7\nprivate synthetic GST proof\n%%EOF'), name: 'gst-proof.pdf', mime: 'application/pdf' };
beforeAll(async () => {
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI;
  root = await mkdtemp(path.join(tmpdir(), 'bulkimart-gst-test-')); process.env.SERVICE_STORAGE_DIR = root;
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri('gst-assistance-isolated'));
  for (const m of [Seller, User, Admin, Gst, Fee, Payment, Ledger]) { await m.createCollection(); if (m !== Gst) await m.init(); }
});
beforeEach(async () => {
  process.env.NODE_ENV = 'test'; delete process.env.DEPLOYMENT_ENV; delete process.env.GST_ASSISTANCE_ENABLED; delete process.env.GST_ASSISTANCE_PRODUCTION_ENABLED;
  gatewayOrders.clear();gatewayPayments.clear();uncertainCheckout=false;
  Object.assign(process.env,{PAYMENT_GATEWAY:'razorpay',RAZORPAY_MODE:'test',RAZORPAY_KEY_ID:'rzp_test_gst_fixture',RAZORPAY_KEY_SECRET:'isolated-gst-secret',RAZORPAY_WEBHOOK_SECRET:'isolated-gst-webhook'});
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); notify.mockClear();
  [vendor, other] = await User.create([{ phone: '9876500171', roles: ['buyer'] }, { phone: '9876500172', roles: ['seller'] }]);
  seller = await Seller.create({ userId: vendor._id, phone: vendor.phone, businessName: 'Synthetic GST shop', businessType: 'proprietorship', status: 'incomplete', onboardingStep: 4,
    storeDetails: { name: 'Fixture', state: 'Karnataka', pincode: '560001', phone: vendor.phone } });
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Admin.collection.insertMany(ids.map((_id, i) => ({ _id, email: `gst-${i}@example.test`, role: 'admin', isActive: true, permissions: i ? [] : ['manage_sellers'] })));
  [admin, denied] = await Promise.all(ids.map(id => Admin.findById(id)));
});
afterAll(async () => {
  await mongoose.disconnect(); await db?.stop(); delete process.env.SERVICE_STORAGE_DIR; delete process.env.GST_ASSISTANCE_ENABLED;
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('bulkimart-gst-test-')); await rm(root, { recursive: true, force: true });
});

test.each(['has_gstin', 'without_gstin'])('explicit %s path preserves normal seller progression without an assistance request', async choice => {
  const gstin = choice === 'has_gstin' ? '29ABCDE1234F1Z5' : '';
  await submit({ pan: 'ABCDE1234F', gstChoice: choice, gstin }).expect(200);
  const saved = await Seller.findById(seller._id); expect(saved.gstin).toBe(gstin); expect(saved.onboardingStep).toBe(5); expect(saved.status).toBe('incomplete'); expect(await Gst.countDocuments()).toBe(0);
});
test('legacy optional GSTIN callers retain their previous behavior without inventing verification', async () => {
  await submit({ pan: 'ABCDE1234F', gstin: 'legacy-unverified-string' }).expect(200);
  expect((await Seller.findById(seller._id)).gstin).toBe('legacy-unverified-string'); expect(await Gst.countDocuments()).toBe(0);
});
test.each([{ gstChoice: 'has_gstin', gstin: 'invalid' }, { pan: '' }, { gstAssistanceConsent: false }, { gstContactName: '' }, { gstAssistanceMessage: 'a'.repeat(2001) }, { gstChoice: 'assistance', gstin: '29ABCDE1234F1Z5' }])('new decision validation rejects %j without advancing onboarding', async invalid => {
  await submit(payload(invalid)).expect(400); expect(await Gst.countDocuments()).toBe(0); expect((await Seller.findById(seller._id)).onboardingStep).toBe(4);
});
test('assistance records consent, original no-GSTIN state, identity and audit while leaving seller approval separate', async () => {
  await submit().expect(200); const d = await detail();
  expect(String(d.vendorId)).toBe(String(seller._id)); expect(d.status).toBe('pending'); expect(d.consent).toMatchObject({ accepted: true, version: 'gst-assistance-v1' }); expect(d.events[0].action).toBe('submitted');
  expect(d.gstinStatusAtSubmission).toBe('not_provided'); expect(d.files).toEqual([]); expect((await Seller.findById(seller._id)).status).toBe('incomplete'); expect(notify).toHaveBeenCalled();
});
test('duplicate and concurrent identical submissions create one request; changed active submission conflicts', async () => {
  const results = await Promise.all([submit(), submit()]); expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(await Gst.countDocuments()).toBe(1); expect((await detail()).events).toHaveLength(1);
  await submit(payload({ gstContactName: 'Different Contact' })).expect(409);
});
test('vendor and admin isolation protects private request list/detail and rejects another portal', async () => {
  await submit().expect(200);
  const empty = await auth(request(app).get('/sellers/gst-assistance/me'), other).expect(200);
  expect(empty.body.data).toBeNull();
  await auth(request(app).get('/sellers/gst-assistance/me'), vendor, 'user', 'delivery').expect(403);
  await auth(request(app).get('/admin/gst-assistance'), vendor).expect(403);
  await auth(request(app).get('/admin/gst-assistance'), denied, 'admin').expect(403);
  await request(app).get('/admin/gst-assistance').expect(401);
  const r = await auth(request(app).get('/admin/gst-assistance?status=pending'), admin, 'admin').expect(200); expect(r.body.data.requests).toHaveLength(1); expect(r.headers['cache-control']).toBe('private, no-store');
});

test('optional seller status returns a private empty response without creating an assistance request', async () => {
  const empty = await auth(request(app).get('/sellers/gst-assistance/me')).expect(200);
  expect(empty.body).toMatchObject({ success: true, data: null });
  expect(empty.headers['cache-control']).toBe('private, no-store');
  expect(await Gst.countDocuments()).toBe(0);
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).expect(404);
  await auth(request(app).post('/sellers/gst-assistance/me/payment')).set('Idempotency-Key', 'gst-empty-request-0001').send({}).expect(404);
  await auth(request(app).get(`/admin/gst-assistance/${seller._id}`), admin, 'admin').expect(404);
  await request(app).get('/sellers/gst-assistance/me').expect(401);
});
test('review transitions, status changes and additional-information response have an audit trail', async () => {
  await submit().expect(200);
  expect((await adminAction('assign', { reviewerId: 'self' })).status).toBe(400); // assignment was retired
  expect((await adminAction('note', { internalNote: 'x' })).status).toBe(400); // private notes were retired
  expect((await adminAction('transition', { status: 'under_review', message: 'Review started' })).status).toBe(200);
  expect((await adminAction('transition', { status: 'additional_information_required', message: 'Please provide requested business evidence' })).status).toBe(200);
  const d = await detail(); expect(d.reviewerId).toBeUndefined();
  const r = await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'respond').field('message', 'Requested evidence attached').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(200);
  expect(r.body.data.status).toBe('under_review'); expect(r.body.data.events.at(-1).action).toBe('respond'); expect(r.body.data.files).toHaveLength(1);
});
test('private documents require ownership or authorized admin access and never return a storage URL', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'additional_information_required', message: 'Please attach proof' });
  const d = await detail(); const r = await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'respond').field('message', 'Evidence').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(200);
  const file = r.body.data.files[0]; expect(JSON.stringify(file)).not.toMatch(/https?:|private-data|sha256/);
  const downloaded = await auth(request(app).get(`/sellers/gst-assistance/me/files/${file.fileId}`)).expect(200); expect(downloaded.headers['content-disposition']).toContain('attachment'); expect(downloaded.headers['cache-control']).toBe('private, no-store');
  await auth(request(app).get(`/sellers/gst-assistance/me/files/${file.fileId}`), other).expect(404);
  await auth(request(app).get(`/admin/gst-assistance/${seller._id}/files/${file.fileId}`), denied, 'admin').expect(403);
  await auth(request(app).get(`/admin/gst-assistance/${seller._id}/files/${file.fileId}`), admin, 'admin').expect(200);
});
test('vendor cannot promote a request and invalid/stale transitions fail without audit mutation', async () => {
  await submit().expect(200); const d = await detail();
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'transition').field('status', 'completed').expect(400);
  expect((await adminAction('transition', { status: 'completed', message: 'Invalid shortcut' })).status).toBe(409);
  await adminAction('transition', { status: 'under_review', message: 'Review' });
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'cancel').expect(409);
  expect((await detail()).events).toHaveLength(2);
});
test('cancellation is pending-only; cancelled requests cannot be silently recreated', async () => {
  await submit().expect(200); const d = await detail();
  await auth(request(app).post('/sellers/gst-assistance/me/actions')).field('version', d.version).field('action', 'cancel').expect(200);
  await submit().expect(409); expect((await detail()).status).toBe('cancelled'); expect(await Gst.countDocuments()).toBe(1);
});
test('completion requires independently reviewed evidence and never sets or verifies the Seller GSTIN', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'approved', message: 'Assistance accepted; not government approval' });
  expect((await adminAction('transition', { status: 'completed', message: 'Complete', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC VERIFICATION' })).status).toBe(400);
  const result = await adminAction('transition', { status: 'completed', message: 'Synthetic independently reviewed evidence', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC ONLY — NOT A GOVERNMENT REFERENCE' }, [pdf]);
  expect(result.status).toBe(200); expect((await detail()).files).toHaveLength(1); expect((await Seller.findById(seller._id)).gstin).toBe('');
  const stored = await Gst.findById(seller._id); expect(stored.verification.method).toBe('admin_attested_independent_review');
  await auth(request(app).get(`/sellers/gst-assistance/me/files/${stored.files[0].fileId}`)).expect(200);
});
test('a document the admin attaches is visible to the owning seller only', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'approved', message: 'Assistance accepted; not government approval' });
  const done = await adminAction('transition', { status: 'completed', message: 'Certificate attached', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC ONLY' }, [pdf]);
  expect(done.status).toBe(200);
  const seen = (await detail()).files; expect(seen).toHaveLength(1); expect(seen[0]).toMatchObject({ name: pdf.name });
  const stored = await Gst.findById(seller._id);
  expect((await auth(request(app).get(`/sellers/gst-assistance/me/files/${stored.files[0].fileId}`)).expect(200)).headers['content-disposition']).toContain('attachment');
  await auth(request(app).get(`/sellers/gst-assistance/me/files/${stored.files[0].fileId}`), other).expect(404);
});
test('approving needs no typed message and tells the seller the work has started', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' });
  expect((await adminAction('transition', { status: 'approved' })).status).toBe(200);
  expect((await detail()).events.at(-1).vendorMessage).toMatch(/approved.*started the work/i);
});
test('completing needs only the GSTIN, the evidence file and the attestation', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' }); await adminAction('transition', { status: 'approved', message: 'Assistance accepted; not government approval' });
  expect((await adminAction('transition', { status: 'completed', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true }, [pdf])).status).toBe(200);
  const stored = await Gst.findById(seller._id);
  expect(stored.verification.reference).toBe(`Uploaded evidence: ${pdf.name}`); expect(stored.events.at(-1).vendorMessage).toBe('GST registration assistance completed.');
});
test('malformed files and stale writes do not leave orphan private documents', async () => {
  await submit().expect(200); await adminAction('transition', { status: 'under_review', message: 'Review' });
  const before = (await readdir(root)).length;
  expect((await adminAction('transition', { status: 'approved', message: 'Bad file' }, [{ ...pdf, bytes: Buffer.from('not a pdf') }])).status).toBe(400);
  expect((await readdir(root)).length).toBe(before);
  const version = (await detail()).version;
  await adminAction('transition', { status: 'additional_information_required', message: 'Need one more document' });
  await auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', version).field('action', 'transition').field('status', 'approved').field('message', 'Stale').attach('documents', pdf.bytes, { filename: pdf.name, contentType: pdf.mime }).expect(409);
  expect((await readdir(root)).length).toBe(before);
});
test.each(['production', 'prod', 'deployment-production'])('production alias %s accepts assistance without environment switches', async name => {
  process.env.DEPLOYMENT_ENV = name;
  expect(gstAssistanceCapabilities()).toEqual({ enabled: true, productionBlocked: false });
  await submit().expect(200);
  expect(await Gst.countDocuments()).toBe(1); delete process.env.DEPLOYMENT_ENV;
});

test.each(['production', 'prod', 'deployment-production'])('production alias %s ignores obsolete disabled intake flags', async name => {
  process.env.DEPLOYMENT_ENV = name; process.env.GST_ASSISTANCE_ENABLED = 'false'; process.env.GST_ASSISTANCE_PRODUCTION_ENABLED = 'false';
  expect(gstAssistanceCapabilities()).toEqual({ enabled: true, productionBlocked: false });
  await submit().expect(200);
  expect((await detail()).status).toBe('pending');
  expect((await Seller.findById(seller._id)).onboardingStep).toBe(5);
  delete process.env.DEPLOYMENT_ENV; delete process.env.GST_ASSISTANCE_ENABLED; delete process.env.GST_ASSISTANCE_PRODUCTION_ENABLED;
});

test('seller can submit registration while GST assistance remains pending', async () => {
  await submit().expect(200);
  await auth(request(app).post('/sellers/submit')).expect(200);
  expect((await Seller.findById(seller._id)).status).toBe('pending');
  expect((await detail()).status).toBe('pending');
});

test('new seller profile lookup is empty until registration starts and panel routes remain protected', async () => {
  const result = await auth(request(app).get('/sellers/me'), other).expect(200);
  expect(result.body).toMatchObject({ success: true, seller: null });
  await auth(request(app).get('/sellers/dashboard'), other).expect(403);
  await auth(request(app).get('/sellers/orders'), other).expect(403);
  await request(app).get('/sellers/me').expect(401);
});

const fee=async amount=>Fee.create({_id:'gst-assistance',amountPaise:amount||10000,currency:'INR',terms:'Synthetic total service fee and cancellation review terms',version:1});
const checkout=(input={})=>auth(request(app).post('/sellers/gst-assistance/me/payment')).set('Idempotency-Key','gst-manual-checkout-0001').send({amountPaise:10000,feeVersion:1,acceptTerms:true,...input});
function capture(c,id='pay_gst_fixture',amount=c.amountPaise){const p={id,order_id:c.razorpayOrderId,amount,currency:'INR',status:'captured',captured:true,amount_refunded:0};gatewayPayments.set(id,p);return p;}
const verify=(c,id='pay_gst_fixture')=>auth(request(app).post('/sellers/gst-assistance/payments/verify')).send({orderId:String(seller._id),razorpay_order_id:c.razorpayOrderId,razorpay_payment_id:id,razorpay_signature:crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${c.razorpayOrderId}|${id}`).digest('hex')});
test('fee settings require finance permission, reject stale/invalid changes and publish configured pricing',async()=>{
  await auth(request(app).put('/admin/gst-assistance/fee-policy'),admin,'admin').send({amountPaise:10000,terms:'Terms',version:0}).expect(403);
  await Admin.updateOne({_id:admin._id},{$push:{permissions:'manage_finance'}});
  await auth(request(app).put('/admin/gst-assistance/fee-policy'),admin,'admin').send({amountPaise:10000,terms:'Terms',version:0}).expect(200);
  await auth(request(app).put('/admin/gst-assistance/fee-policy'),admin,'admin').send({amountPaise:25000,terms:'New terms',version:0}).expect(409);
  await auth(request(app).put('/admin/gst-assistance/fee-policy'),admin,'admin').send({amountPaise:0,terms:'Terms',version:1}).expect(400);
  const r=await request(app).get('/sellers/gst-assistance/capabilities').expect(200);expect(r.body.data.fee.amountPaise).toBe(10000);
});
test('registration snapshots the admin fee and later price edits do not reprice its payment',async()=>{
  await fee();await submit().expect(200);await Fee.updateOne({_id:'gst-assistance'},{$set:{amountPaise:25000,version:2}});
  expect((await detail()).billing.amountPaise).toBe(10000);await checkout({amountPaise:25000}).expect(409);
  const a=await checkout().expect(200),b=await checkout().expect(200);expect(a.body.data.razorpayOrderId).toBe(b.body.data.razorpayOrderId);expect(gatewayOrders.size).toBe(1);
});
test('GST payment is server verified and replay posts one held receipt outside seller payable',async()=>{
  await fee();await submit().expect(200);const c=(await checkout().expect(200)).body.data;capture(c);
  await auth(request(app).post('/sellers/gst-assistance/payments/verify'),other).send({orderId:String(seller._id),razorpay_order_id:c.razorpayOrderId}).expect(404);
  await verify(c).expect(200);await verify(c).expect(200);expect((await detail()).billing.status).toBe('paid');
  expect(await Ledger.countDocuments({account:'gst_assistance_collections'})).toBe(1);expect(await Ledger.countDocuments({account:'seller_payable'})).toBe(0);
  await checkout().expect(409);
});

test('registration, admin queue, verified payment and evidenced GST completion work as one flow', async () => {
  await fee(); await submit().expect(200);
  await auth(request(app).post('/sellers/submit')).expect(200);
  const queue = await auth(request(app).get('/admin/gst-assistance?status=pending'), admin, 'admin').expect(200);
  expect(queue.body.data.requests).toHaveLength(1);
  expect(queue.body.data.requests[0].billing).toMatchObject({ amountPaise: 10000, status: 'unpaid' });
  const payment = (await checkout().expect(200)).body.data; capture(payment);
  await verify(payment).expect(200);
  expect((await adminAction('transition', { status: 'under_review', message: 'Review documents' })).status).toBe(200);
  expect((await adminAction('transition', { status: 'approved', message: 'Paid assistance work accepted' })).status).toBe(200);
  expect((await adminAction('transition', { status: 'completed', message: 'GSTIN independently reviewed', verifiedGstin: '29ABCDE1234F1Z5', independentlyVerified: true, verificationReference: 'SYNTHETIC TEST EVIDENCE' }, [pdf])).status).toBe(200);
  expect(await detail()).toMatchObject({ status: 'completed', billing: { status: 'paid' }, verification: { gstin: '29ABCDE1234F1Z5' } }); expect((await detail()).files).toHaveLength(1);
  expect((await Seller.findById(seller._id)).status).toBe('pending');
  expect((await Seller.findById(seller._id)).gstin).toBe('');
  expect(await Ledger.countDocuments({ account: 'gst_assistance_collections' })).toBe(1);
});
test('mismatched provider amount or browser signature cannot mark GST fee paid',async()=>{
  await fee();await submit().expect(200);const c=(await checkout().expect(200)).body.data;capture(c,'pay_gst_fixture',1);
  await verify(c).expect(409);expect((await detail()).billing.status).toBe('pending');expect(await Ledger.countDocuments()).toBe(0);
  await auth(request(app).post('/sellers/gst-assistance/payments/verify')).send({orderId:String(seller._id),razorpay_order_id:c.razorpayOrderId,razorpay_payment_id:'pay_gst_fixture',razorpay_signature:'invalid'}).expect(401);
});
test('uncertain gateway creation blocks duplicate checkout and status recovery binds the original order',async()=>{
  await fee();await submit().expect(200);uncertainCheckout=true;await checkout().expect(503);await checkout().expect(409);expect(gatewayOrders.size).toBe(1);
  await auth(request(app).post('/sellers/gst-assistance/me/payment-status')).send({}).expect(200);uncertainCheckout=false;await checkout().expect(200);expect(gatewayOrders.size).toBe(1);
});
test('unpaid GST service can finish seller registration but cannot start paid assistance work',async()=>{
  await fee();await submit().expect(200);await auth(request(app).post('/sellers/submit')).expect(200);
  await adminAction('transition',{status:'under_review',message:'Review'});
  expect((await adminAction('transition',{status:'approved',message:'Start work'})).status).toBe(409);
});
test('webhook capture and refund refresh update GST receipt without duplicate ledger entries',async()=>{
  await fee();await submit().expect(200);const c=(await checkout().expect(200)).body.data;const live=capture(c);
  const event={gatewayOrderId:c.razorpayOrderId,paymentId:live.id,amountPaise:10000,currency:'INR',kind:'payment_completed'};
  expect(await handleGstWebhook({event:'payment.captured'},event)).toBe(true);expect((await detail()).billing.status).toBe('paid');
  live.amount_refunded=10000;
  await handleGstWebhook({event:'refund.processed'},{refundPaymentId:live.id});await handleGstWebhook({event:'refund.processed'},{refundPaymentId:live.id});
  expect((await detail()).billing.status).toBe('refunded');expect(await Ledger.countDocuments()).toBe(2);
});

test('concurrent checkout initialization creates one gateway order and a late capture after cancellation is held for review',async()=>{
  await fee();await submit().expect(200);
  const attempts=await Promise.all([checkout(),checkout()]);expect(attempts.some(r=>r.status===200)).toBe(true);expect(attempts.every(r=>[200,409].includes(r.status))).toBe(true);expect(gatewayOrders.size).toBe(1);
  const c=attempts.find(r=>r.status===200).body.data;
  await adminAction('transition',{status:'cancelled',message:'Vendor cancellation review'});
  const live=capture(c);await handleGstWebhook({event:'payment.captured'},{gatewayOrderId:c.razorpayOrderId,paymentId:live.id,amountPaise:10000,currency:'INR',kind:'payment_completed'});
  expect((await detail()).billing.reviewRequired).toBe(true);expect((await detail()).billing.status).not.toBe('paid');
  expect((await Payment.findOne({gstAssistanceRequestId:seller._id})).refundObligations).toHaveLength(1);
});
test('assistance and legacy optional-GST onboarding both work without environment switches', async () => {
  expect(gstAssistanceCapabilities().enabled).toBe(true);
  await submit({ pan: 'ABCDE1234F' }).expect(200);
  await submit().expect(200);
});
test('failure after request creation rolls back request and seller progression, allowing a safe retry', async () => {
  const spy = jest.spyOn(Seller, 'updateOne').mockRejectedValueOnce(Error('Synthetic seller write failure'));
  try { await submit().expect(500); } finally { spy.mockRestore(); }
  expect(await Gst.countDocuments()).toBe(0); expect((await Seller.findById(seller._id)).onboardingStep).toBe(4);
  await submit().expect(200); expect(await Gst.countDocuments()).toBe(1);
});
test('concurrent review commands with the same version commit one transition and one audit event', async () => {
  await submit().expect(200); const version = (await detail()).version;
  const command = () => auth(request(app).post(`/admin/gst-assistance/${seller._id}/actions`), admin, 'admin').field('version', version).field('action', 'transition').field('status', 'under_review').field('message', 'Concurrent synthetic review');
  const results = await Promise.all([command(), command()]); expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await detail()).events).toHaveLength(2);
});
test('notification outage cannot roll back a committed GST assistance request', async () => {
  notify.mockRejectedValueOnce(Error('Synthetic notification outage'));
  await submit().expect(200); expect(await Gst.countDocuments()).toBe(1);
});
