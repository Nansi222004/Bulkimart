import mongoose from 'mongoose';
import {MongoMemoryReplSet, MongoMemoryServer} from 'mongodb-memory-server';
import Payment from '../models/Payment.js';
import Event from '../models/AdEvent.js';
import Receipt from '../models/AdWebhookReceipt.js';
import Ledger from '../models/SellerLedgerEntry.js';
import {financialTransaction} from '../services/financeSafety.service.js';
import {advertisingEventSummary} from '../services/advertisingTelemetry.service.js';

// No configured database URI is read. Only test-owned loopback databases are
// created, indexed and removed. Never import index.js or config/db.js here.
let database;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const id=()=>new mongoose.Types.ObjectId();
beforeAll(async()=>{
  database=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1},
    instanceOpts:[{args:['--setParameter','ttlMonitorSleepSecs=1']}]});
  const uri=database.getUri('advertising_acceptance_isolated');
  if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(uri))throw Error('Acceptance refused a non-loopback database');
  await mongoose.connect(uri);
  for(const model of [Payment,Event,Receipt,Ledger])await model.init();
});
afterAll(async()=>{await mongoose.disconnect();await database?.stop();});

test('actual replica-set topology supports committed and rolled-back financial transactions',async()=>{
  const hello=await mongoose.connection.db.admin().command({hello:1});
  expect(hello.setName).toBeTruthy();expect(hello.isWritablePrimary).toBe(true);expect(hello.logicalSessionTimeoutMinutes).toBeGreaterThan(0);
  const probe=mongoose.connection.collection('advertising_acceptance_transaction_probe');
  await probe.createIndex({key:1},{unique:true});
  await financialTransaction(async session=>{await probe.insertOne({key:'committed'},{session});});
  await expect(financialTransaction(async session=>{await probe.insertOne({key:'rolled-back'},{session});throw Error('intentional rollback');})).rejects.toThrow('intentional rollback');
  expect(await probe.countDocuments({key:'committed'})).toBe(1);expect(await probe.countDocuments({key:'rolled-back'})).toBe(0);
});

test('actual Payment indexes have the required unique keys and advertising-only partial filters',async()=>{
  const indexes=await Payment.collection.listIndexes().toArray();
  const expected=[['advertising_gateway_order_unique',{'gateway.orderId':1},{'advertising.campaignId':{$type:'objectId'},'gateway.orderId':{$type:'string'}}],
    ['advertising_capture_unique',{'captures.gatewayPaymentId':1},{'advertising.campaignId':{$type:'objectId'},'captures.gatewayPaymentId':{$type:'string'}}]];
  for(const [name,key,partial]of expected){const index=indexes.find(i=>i.name===name);expect(index?.unique).toBe(true);expect(index?.key).toEqual(key);expect(index?.partialFilterExpression).toEqual(partial);}
  expect(indexes.find(i=>i.name==='_id_')?.key).toEqual({_id:1});
});

test('real database enforces advertising order/capture uniqueness without constraining merchandise orders',async()=>{
  const row=(order,capture)=>({_id:id(),advertising:{campaignId:id()},gateway:{orderId:order},captures:[{gatewayPaymentId:capture}]});
  await Payment.collection.insertOne(row('order_index_a','pay_index_a'));
  await expect(Payment.collection.insertOne(row('order_index_a','pay_index_b'))).rejects.toMatchObject({code:11000});
  await expect(Payment.collection.insertOne(row('order_index_b','pay_index_a'))).rejects.toMatchObject({code:11000});
  await Payment.collection.insertMany([{gateway:{orderId:'order_merch_fixture'}},{gateway:{orderId:'order_merch_fixture'}}]);
  expect(await Payment.collection.countDocuments({'gateway.orderId':'order_merch_fixture'})).toBe(2);
});

test('AdEvent TTL/reporting indexes and webhook/ledger deduplication indexes exist in the database',async()=>{
  const events=await Event.collection.listIndexes().toArray(),receipts=await Receipt.collection.listIndexes().toArray(),ledger=await Ledger.collection.listIndexes().toArray();
  expect(events.find(i=>same(i.key,{expiresAt:1}))?.expireAfterSeconds).toBe(0);
  expect(events.some(i=>same(i.key,{campaignId:1,revision:1,mode:1,type:1,at:1}))).toBe(true);
  expect(events.some(i=>same(i.key,{_id:1}))).toBe(true);expect(receipts.some(i=>same(i.key,{_id:1}))).toBe(true);
  expect(ledger.find(i=>same(i.key,{idempotencyKey:1}))?.unique).toBe(true);
  expect(ledger.find(i=>same(i.key,{entryNo:1}))?.unique).toBe(true);
});

test('durable concurrent event, webhook and ledger duplicate submissions cannot create duplicates',async()=>{
  const campaignId=id(),productId=id(),paymentId=id();
  const event={_id:'acceptance-event-concurrent',campaignId,revision:1,productId,placement:'CATEGORY_SPONSORED',mode:'NON_BILLABLE_PILOT',type:'IMPRESSION',at:new Date(),expiresAt:new Date(Date.now()+60000)};
  const receipt={_id:'acceptance-webhook-concurrent',paymentId,kind:'COMPLETED',processedAt:new Date()};
  const entry={entryNo:'AD-ACCEPTANCE-ENTRY',idempotencyKey:'AD-ACCEPTANCE-KEY',advertisingCampaignId:campaignId,advertiserSellerId:id(),advertisingRevision:1,paymentId,account:'advertising_cash',type:'advertising_receipt',direction:'credit',bucket:'held',amount:1,description:'Synthetic index acceptance'};
  for(const [model,data]of [[Event,event],[Receipt,receipt],[Ledger,entry]]){
    const results=await Promise.allSettled([1,2,3,4].map(()=>model.create(data)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected').every(r=>r.reason.code===11000)).toBe(true);
  }
});

test('expired events disappear from reports immediately and the actual TTL monitor deletes them',async()=>{
  const campaignId=id();
  await Event.create({_id:'acceptance-expired-event',campaignId,revision:1,productId:id(),placement:'CATEGORY_SPONSORED',mode:'NON_BILLABLE_PILOT',type:'IMPRESSION',at:new Date(Date.now()-1000),expiresAt:new Date(Date.now()-1000)});
  expect((await advertisingEventSummary(campaignId)).rows).toEqual([]);
  const until=Date.now()+12000;
  while(await Event.exists({_id:'acceptance-expired-event'})&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,200));
  expect(await Event.exists({_id:'acceptance-expired-event'})).toBeNull();
});

test('standalone MongoDB rejects financial transactions rather than falling back to nontransactional writes',async()=>{
  await mongoose.disconnect();const standalone=await MongoMemoryServer.create({binary:{version:'7.0.14'}});
  try{
    await mongoose.connect(standalone.getUri('advertising_acceptance_standalone'));
    const probe=mongoose.connection.collection('advertising_acceptance_transaction_probe');await probe.createIndex({key:1});
    await expect(financialTransaction(async session=>{await probe.insertOne({key:'must-not-commit'},{session});})).rejects.toMatchObject({status:503});
    expect(await probe.countDocuments({key:'must-not-commit'})).toBe(0);
  }finally{await mongoose.disconnect();await standalone.stop();await mongoose.connect(database.getUri('advertising_acceptance_isolated'));}
});
