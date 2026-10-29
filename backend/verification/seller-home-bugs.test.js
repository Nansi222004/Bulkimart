import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import { getDashboard, getSellerOrders } from '../controllers/seller.controller.js';
import { getSellerFinanceSummary } from '../controllers/sellerFinance.controller.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { getSellerBalancesAdmin } from '../controllers/adminSellerFinance.controller.js';
import { processBulkUpload } from '../controllers/bulkProduct.controller.js';
import { uploadBulkFiles } from '../middlewares/upload.middleware.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { parseSpreadsheet, generateBulkTemplateExcelJS } from '../utils/excelParser.js';
const id = () => new mongoose.Types.ObjectId();
let db, seller, userId, categoryId;
const app = express();
app.use((req, _res, next) => { req.user = { _id: userId }; req.seller = seller; req.userType = 'user'; next(); });
app.get('/dashboard', getDashboard); app.get('/orders', getSellerOrders);
app.get('/finances', getSellerFinanceSummary);
app.get('/admin-balances', getSellerBalancesAdmin);
app.post('/bulk', uploadBulkFiles, processBulkUpload); app.use(errorHandler);
beforeAll(async () => { db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  userId = id(); categoryId = id();
  seller = { _id: id(), userId, status: 'approved' };
  await Seller.collection.insertOne(seller);
  await Category.collection.insertOne({ _id: categoryId, name: 'Food', type: 'ecommerce', isActive: true, parent: null });
});
const item = (sellerId, price, qty = 1) => ({ _id: id(), productId: id(), sellerId, name: 'Fixture', price, qty });
async function order(status, extra = {}) {
  const doc = { _id: id(), orderNo: String(id()), userId, type: 'ecommerce', status, paymentMethod: 'cod', createdAt: new Date(), items: [item(seller._id, 100)], pricing: { subtotal: 100, totalAmount: 100 }, ...extra };
  await Order.collection.insertOne(doc); return doc;
}
test('sales exclude unfinished, unpaid and cancelled orders, allocate discounts to own goods, and expose net earnings separately', async () => {
  const other = id();
  await order('delivered', { items: [item(seller._id, 200, 2), item(other, 600)], pricing: { subtotal: 1000, couponDiscount: 100, totalAmount: 940, deliveryCharge: 40 },
    financialSnapshot: { version: 2, lines: [{ sellerId: String(seller._id), grossPaise: 40000, eligiblePaise: 36000, allocatedDiscounts: { couponDiscount: 4000 }, rule: { rateBps: 1000 }, commissionPaise: 3600, taxPaise: 648, netPaise: 35752 }] } });
  await order('placed'); await order('confirmed'); await order('preparing'); await order('dispatched'); await order('cancelled'); await order('returned');
  const payment = await Payment.collection.insertOne({ userId, method: 'online', status: 'pending', amount: 100 });
  await order('delivered', { paymentMethod: 'online', paymentId: payment.insertedId });
  const { body } = await request(app).get('/dashboard?type=ecommerce').expect(200);
  expect(body.kpis).toMatchObject({ totalRevenue: 360, netEarnings: 357.52, avgOrderValue: 360, totalOrders: 5, pendingOrders: 3 });
  expect(body.salesPerformance).toHaveLength(30);
  expect(body.salesPerformance.reduce((sum, row) => sum + row.revenue, 0)).toBe(360);
});
test('pending card and pending list use the same statuses, payment eligibility, and storefront', async () => {
  await order('placed'); await order('confirmed'); await order('preparing'); await order('dispatched'); await order('placed', { type: 'grocery' });
  const payment = await Payment.collection.insertOne({ userId, method: 'online', status: 'failed' });
  await order('placed', { paymentMethod: 'online', paymentId: payment.insertedId });
  const dashboard = await request(app).get('/dashboard?type=ecommerce').expect(200);
  const listing = await request(app).get('/orders?type=ecommerce&status=pending').expect(200);
  expect(dashboard.body.kpis.pendingOrders).toBe(3); expect(listing.body.meta.total).toBe(3);
  expect(listing.body.data.map(row => row.status).sort()).toEqual(['confirmed', 'placed', 'preparing']);
  const quick = await request(app).get('/dashboard?type=grocery').expect(200);
  expect(quick.body.kpis.pendingOrders).toBe(1); expect(quick.body.kpis.totalRevenue).toBe(0);
});
test('historical missing net earnings and irreconcilable sales remain pending; delivery date sets the graph day', async () => {
  const deliveredAt = new Date(Date.now() - 86400000);
  await order('delivered', { createdAt: new Date('2020-01-01'), timeline: [{ status: 'delivered', timestamp: deliveredAt }] });
  let response = await request(app).get('/dashboard').expect(200);
  expect(response.body.kpis).toMatchObject({ totalRevenue: 100, netEarnings: null, netEarningsPendingOrders: 1 });
  expect(response.body.salesPerformance.at(-2).revenue).toBe(100);
  await order('delivered', { pricing: { subtotal: 100, totalAmount: 1 } });
  response = await request(app).get('/dashboard').expect(200);
  expect(response.body.kpis).toMatchObject({ totalRevenue: null, knownRevenue: 100, revenuePendingOrders: 1, avgOrderValue: null });
});
const csv = rows => Buffer.from('Product Name,Main Category,Sell Price (₹),MRP Price (₹),Stock,Unit\n' + rows.join('\n'));
test('hybrid account totals reconcile with earnings and missing original commissions are pending, not zero earnings', async () => {
  for (const [type, price] of [['ecommerce', 250], ['ecommerce', 900], ['grocery', 900]]) await order('delivered', { type, items: [item(seller._id, price)], pricing: { subtotal: price, totalAmount: price } });
  for (const [type, status] of [['ecommerce', 'dispatched'], ['ecommerce', 'dispatched'], ['ecommerce', 'preparing'], ['grocery', 'preparing'], ['grocery', 'preparing'], ['grocery', 'preparing'], ['grocery', 'dispatched']]) await order(status, { type });
  const originalOrders = await Order.find().lean();
  const dashboard = (await request(app).get('/dashboard').expect(200)).body;
  expect(dashboard.kpis).toMatchObject({ totalRevenue: 2050, totalOrders: 10, completedOrders: 3, avgOrderValue: 683.33, pendingOrders: 4, netEarnings: null, netEarningsCalculatedOrders: 0, netEarningsPendingOrders: 3 });
  expect(dashboard.byChannel.ecommerce.revenue).toBe(1150); expect(dashboard.byChannel.grocery.revenue).toBe(900);
  const finance = (await request(app).get('/finances').expect(200)).body.data;
  expect(dashboard.kpis).toMatchObject(finance.salesMetrics);
  expect(finance.coverage).toMatchObject({ deliveredOrders: 3, unpostedOrders: 3, netEarningsPendingOrders: 3, ledgerEntryCount: 0 });
  expect(finance.balances).toMatchObject({ eligible: 0, held: 0, earnedEarnings: 0 });
  expect(finance.deliveredSales.orders.every(row => row.sellerAmounts.netEarnings === null && row.items === undefined && row.pricing === undefined)).toBe(true);
  expect(finance.payoutActionsEnabled).toBe(false);
  expect(await Ledger.countDocuments()).toBe(0); expect(await Order.find().lean()).toEqual(originalOrders);
});
const upload = (buffer, filename = 'products.csv') => request(app).post('/bulk?mode=ecommerce').attach('excelFile', buffer, filename);
test('bulk endpoint rejects unsupported extensions, corrupt workbooks, empty sheets, missing headers and invalid archives', async () => {
  await upload(Buffer.from('pdf'), 'products.pdf').expect(400);
  await upload(Buffer.from('not a workbook'), 'products.xlsx').expect(400);
  await upload(Buffer.alloc(0)).expect(400);
  const missing = await upload(Buffer.from('Name,Price\nExample,10')).expect(400);
  expect(missing.body.meta.errors[0].reason).toMatch(/Stock/);
  await request(app).post('/bulk').attach('excelFile', csv(['Good,Food,10,20,1,piece']), 'products.csv').attach('zipFile', Buffer.from('not a zip'), 'images.zip').expect(400);
  expect(await Product.countDocuments()).toBe(0);
});
test('all rows validate before imports, with exact row errors and no invented stock or category', async () => {
  const { body } = await upload(csv(['Good,Food,10,20,1,piece', 'Invalid,Unknown,12oops,5,-1,invalid', ',Food,10,20,1,piece'])).expect(400);
  expect(body.meta.errors.map(row => row.row)).toEqual([3, 4]);
  expect(body.meta.errors[0].reason).toMatch(/Category.*Sell Price.*Stock.*Unit/);
  expect(body.meta.errors[1].reason).toMatch(/Product Name is required/);
  expect(await Product.countDocuments()).toBe(0);
});
test('valid CSV and XLSX import stock zero, numeric cells and multiline descriptions', async () => {
  const { body } = await upload(csv(['Valid,Food,10,20,0,piece'])).expect(200);
  expect(body.successCount).toBe(1); expect((await Product.findOne({ name: 'Valid' })).stock).toBe(0);
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Products');
  sheet.addRow(['Product Name', 'Main Category', 'Sell Price (₹)', 'Stock']); sheet.addRow(['Workbook product', 'Food', 25, 3]);
  const result = await upload(Buffer.from(await workbook.xlsx.writeBuffer()), 'products.xlsx').expect(200);
  expect(result.body.successCount).toBe(1);
  const rows = await parseSpreadsheet(Buffer.from('\uFEFFProduct Name,Main Category,Price,Stock,Description\n"With, comma",Food,12,2,"Line one\nLine two"'), 'products.csv');
  expect(rows[0]['Product Name']).toBe('With, comma'); expect(rows[0].Description).toBe('Line one\nLine two');
  const numbered = await parseSpreadsheet(Buffer.from('Product Name,Price,Stock\nMultiline,12,2\n"Another\nproduct",10,1\nFinal,10,2'), 'products.csv');
  expect(numbered.map(row => row.__rowNumber)).toEqual([2, 3, 5]);
});
test('missing image filenames produce row errors and generated template includes stock with validation', async () => {
  const response = await upload(Buffer.from('Product Name,Main Category,Price,Stock,Primary Image URL\nPicture,Food,10,1,missing.jpg')).expect(400);
  expect(response.body.meta.errors[0].reason).toMatch(/missing.jpg.*missing from the ZIP/);
  const archive = new JSZip(); archive.file('image.txt', 'not an image');
  await request(app).post('/bulk').attach('excelFile', Buffer.from('Product Name,Main Category,Price,Stock,Primary Image URL\nPicture,Food,10,1,missing.jpg'), 'products.csv').attach('zipFile', await archive.generateAsync({ type: 'nodebuffer' }), 'images.zip').expect(400);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await generateBulkTemplateExcelJS());
  expect(workbook.getWorksheet(1).getCell('Q2').value).toBe('Stock');
  expect(workbook.getWorksheet(1).getCell('Q4').dataValidation.type).toBe('whole');
  expect(workbook.definedNames.model.some(name => name.name === 'HeaderCategories')).toBe(true);
});

test('Finance Center and seller Earnings share sales, discounts, storefronts and scope even after some earnings are posted', async()=>{
 for(const [type,price,discount] of [['ecommerce',1300,200],['ecommerce',500,100],['grocery',1800,50],['ecommerce',200,0],['grocery',500,100],['ecommerce',500,0],['grocery',500,50]]){
  await order('delivered',{type,items:[item(seller._id,price)],pricing:{subtotal:price,couponDiscount:discount,totalAmount:price-discount}});
 }
 const sellerView=(await request(app).get('/finances').expect(200)).body.data;
 let adminView=(await request(app).get('/admin-balances').expect(200)).body.data.rows[0];
 expect(adminView.salesMetrics).toEqual(sellerView.salesMetrics);
 expect(adminView.salesMetrics).toMatchObject({grossSales:5300,customerDiscounts:500,totalRevenue:4800,completedOrders:7});
 expect(adminView.salesByChannel.ecommerce).toMatchObject({revenue:2200,grossSales:2500,customerDiscounts:300});
 expect(adminView.salesByChannel.grocery).toMatchObject({revenue:2600,grossSales:2800,customerDiscounts:200});
 expect(adminView.balances.eligible).toBe(0);expect(adminView.unpostedSales.orderCount).toBe(7);
 expect(sellerView.payoutActionsEnabled).toBe(false);expect(await Ledger.countDocuments()).toBe(0);
 // A posted order still contributes to completed sales on both screens, while
 // the unposted-order diagnostic remains a separate subset of those sales.
 await order('delivered',{financialPosting:'eligible',items:[item(seller._id,700)],pricing:{subtotal:700,totalAmount:700}});
 await Ledger.collection.insertOne({sellerId:seller._id,account:'seller_payable',type:'order_earning',direction:'credit',bucket:'eligible',amount:630,currency:'INR'});
 adminView=(await request(app).get('/admin-balances').expect(200)).body.data.rows[0];
 const after=(await request(app).get('/finances').expect(200)).body.data;
 expect(adminView.salesMetrics).toEqual(after.salesMetrics);expect(adminView.salesMetrics.totalRevenue).toBe(5500);expect(adminView.salesMetrics.completedOrders).toBe(8);
 expect(adminView.unpostedSales.orderCount).toBe(7);expect(adminView.balances.eligible).toBe(630);expect(after.balances.eligible).toBe(630);expect(await Ledger.countDocuments()).toBe(1);
});
