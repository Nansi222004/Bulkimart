import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { moneyPaise, codCashDuePaise } from '../utils/financeMoney.js';

const id = value => String(value || '');
const integer = value => { if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid journal amount'); return value; };
const sum = (a,b) => { const result = a+b; if (!Number.isSafeInteger(result)) throw Error('Unsupported total'); return result; };
export const newMetric = () => ({ amountPaise: 0, verifiedSubtotalPaise: 0, excludedRecords: 0, incompleteRecords: 0, issues: [] });
const finish = metric => ({ ...metric, status: metric.incompleteRecords ? 'incomplete' : 'complete', amountPaise: metric.incompleteRecords ? null : metric.verifiedSubtotalPaise });
const issueDefinitions = {
  invalid_order_total: ['Completed order pricing is missing or invalid.', 'Review the original order pricing in Finance Center.'],
  payment_link_missing: ['A completed order has missing or mismatched payment evidence.', 'Review the linked payment and original receipt in Finance Center.'],
  cash_unverified: ['Delivered COD cash has not been verified.', 'Reconcile cash remittance and independent verification in Finance Center.'],
  cash_evidence_invalid: ['COD verification or refund evidence is incomplete.', 'Review cash verification and refund evidence in Finance Center.'],
  collection_evidence_invalid: ['Payment capture, refund or order totals require reconciliation.', 'Review the original payment receipt, captured amount and refund journal in Finance Center.'],
  capture_missing: ['A payment marked paid has no settled capture recorded.', 'Verify the original gateway receipt and reconcile its capture; a paid status alone is insufficient.'],
  capture_total_mismatch: ['Captured payment and linked order amounts differ.', 'Reconcile the original payment amount and all orders sharing it before counting the collection.'],
  historical_commission_missing: ['Historical completed orders lack frozen commission evidence.', 'Use Finance Center’s Old orders review with the original commission agreement; current settings do not establish historical earnings.'],
  commission_posting_missing: ['Completed orders have no posted commission allocation.', 'Review the frozen commission policy and allocate eligible orders in Finance Center.'],
  commission_entry_invalid: ['A commission entry has unsupported or invalid evidence.', 'Review the original ledger entry and its source in Finance Center.'],
  revenue_entry_invalid: ['A platform income entry has incomplete source evidence.', 'Review the parcel or advertising income entry in Finance Center.'],
};
function addIssue(metric, code) {
  metric.incompleteRecords++;
  const previous = metric.issues.find(row => row.code === code);
  if (previous) { previous.count++; return; }
  const [message, resolution] = issueDefinitions[code];
  metric.issues.push({ code, count: 1, message, resolution });
}

export function addCompletedOrder(metric, order) {
  if (order.status !== 'delivered') return;
  try { metric.verifiedSubtotalPaise = sum(metric.verifiedSubtotalPaise, moneyPaise(order.pricing?.totalAmount)); }
  catch { addIssue(metric, 'invalid_order_total'); }
}

// Payment documents are visited once. No gateway attempt is a receipt.
export function addOrderCollection(metric, payment, orders, returns, seenCaptures = new Set(), seenRefunds = new Set()) {
  try {
    if (payment.method === 'wallet') { metric.excludedRecords++; return; }
    // Abandoned/failed checkouts are not receipts and may never have produced
    // an Order. They must not make otherwise verified collections incomplete.
    if (payment.method === 'online' && ['pending','failed'].includes(payment.status) && !payment.captures?.some(row => row.disposition === 'settled')) { metric.excludedRecords++; return; }
    if (!payment.userId || !orders.length || orders.some(order => !order.userId || id(order.userId) !== id(payment.userId) || order.paymentMethod !== payment.method
      || (payment.groupRef ? order.groupRef !== payment.groupRef : id(order._id) !== id(payment.orderId)))) throw Error('Unmatched order payment');
    if (payment.method === 'cod') {
      for (const order of orders) {
        const cash = order.codFinance;
        if (!['verified','allocated'].includes(cash?.status)) {
          if (order.status==='delivered' || ['disputed','discrepancy'].includes(cash?.status)) addIssue(metric, 'cash_unverified');
          metric.excludedRecords++;
          continue;
        }
        try {
          const expected = moneyPaise(order.pricing?.totalAmount);
          const remit = cash.events?.find(row => row.action === 'remit');
          const verified = cash.events?.filter(row => row.action === 'verify').at(-1);
          if (!expected || order.financialSnapshot?.version !== 2 || order.financialSnapshot.expectedPaise !== expected || cash.verifiedPaise !== codCashDuePaise(expected)
            || !remit?.actorId || !verified?.actorId || id(remit.actorId) === id(verified.actorId) || verified.amountPaise !== codCashDuePaise(expected)|| !verified.reference) throw Error('Unverified cash');
          let refunds = 0;
          for (const ret of returns.filter(row => id(row.orderId) === id(order._id) && row.status === 'REFUNDED')) {
            const amount = moneyPaise(ret.refundAmount);
            if (amount && (!ret.codSettledBy || !ret.codSettledAt || ret.refundReference !== 'MANUAL-COD' || ret.codSettlementNote?.length < 5)) throw Error('Unverified COD refund');
            refunds = sum(refunds, amount);
          }
          if (refunds > expected) throw Error('Excess refund');
          metric.verifiedSubtotalPaise = sum(metric.verifiedSubtotalPaise, expected - refunds);
        } catch { addIssue(metric, 'cash_evidence_invalid'); }
      }
      return;
    }
    if (payment.method !== 'online') throw Error('Unknown method');
    const captures = new Map();
    for (const row of payment.captures || []) {
      if (row.disposition !== 'settled') continue;
      if (!row.gatewayPaymentId || !row.gatewayOrderId || row.currency !== 'INR') throw Error('Invalid capture');
      const amount = integer(row.amountPaise);
      const prior = captures.get(row.gatewayPaymentId);
      if (prior && (prior.amountPaise !== amount || prior.gatewayOrderId !== row.gatewayOrderId)) throw Error('Conflicting capture');
      captures.set(row.gatewayPaymentId,row);
    }
    if (!captures.size) {
      if (['paid','partial_refund','refunded'].includes(payment.status)) throw Error('Legacy payment lacks capture');
      metric.excludedRecords++; return;
    }
    if (!['paid','partial_refund','refunded'].includes(payment.status)) throw Error('Captured payment projection requires reconciliation');
    let gross = 0;
    for (const [key,row] of captures) {
      if (seenCaptures.has(key)) throw Error('Capture reused across payments');
      seenCaptures.add(key); gross = sum(gross,row.amountPaise);
    }
    if (gross !== moneyPaise(payment.amount) || orders.reduce((total,order) => sum(total,moneyPaise(order.pricing?.totalAmount)),0) !== gross) throw Error('Capture/order totals differ');
    const refunds = new Map();
    for (const row of payment.refundObligations || []) {
      if (row.status !== 'processed') continue;
      if (!row.providerRefundId || !row.verifiedAt || row.currency !== 'INR' || !captures.has(row.gatewayPaymentId)) throw Error('Unverified refund');
      integer(row.amountPaise);
      const prior = refunds.get(row.providerRefundId);
      if (prior && (prior.amountPaise !== row.amountPaise || prior.gatewayPaymentId !== row.gatewayPaymentId || id(prior.returnId) !== id(row.returnId) || id(prior.orderId) !== id(row.orderId))) throw Error('Conflicting refund');
      refunds.set(row.providerRefundId,row);
    }
    let refunded = 0;
    for (const row of refunds.values()) {
      if (seenRefunds.has(row.providerRefundId)) throw Error('Refund reused across payments');
      seenRefunds.add(row.providerRefundId); refunded = sum(refunded,row.amountPaise);
    }
    if (refunded > gross || refunded !== moneyPaise(payment.refund?.totalRefundedAmount ?? 0)) throw Error('Refund projection differs');
    if ((payment.status==='refunded' && refunded!==gross) || (payment.status==='partial_refund' && (!refunded || refunded===gross))
      || (payment.status==='paid' && refunded>0) || (payment.refund?.status==='processed' && moneyPaise(payment.refund.amount ?? 0)>0 && !refunded)) throw Error('Refund status requires reconciliation');
    for (const ret of returns.filter(row => row.status === 'REFUNDED')) {
      const amount = moneyPaise(ret.refundAmount);
      if (amount && ![...refunds.values()].some(row => id(row.returnId) === id(ret._id) && row.providerRefundId === ret.refundReference && row.amountPaise === amount)) throw Error('Return cash refund lacks journal');
    }
    metric.verifiedSubtotalPaise = sum(metric.verifiedSubtotalPaise,gross-refunded);
  } catch (error) { addIssue(metric, error.message === 'Legacy payment lacks capture' ? 'capture_missing' : error.message === 'Unmatched order payment' ? 'payment_link_missing' : error.message === 'Capture/order totals differ' ? 'capture_total_mismatch' : 'collection_evidence_invalid'); }
}

export function addPostedCommission(metric, entry) {
  // Legal-service commissions have their own lifecycle; do not mistake them
  // for broken merchandise records or silently combine different measures.
  if (entry.serviceApplicationId) { metric.excludedRecords++; return; }
  try {
    if (entry.currency !== 'INR' || !['order-finance-v2', 'historical-reviewed-v1'].includes(entry.metadata?.source)
      || !['platform_commission','reversal'].includes(entry.type) || !['credit','debit'].includes(entry.direction)) throw Error('Uncovered commission entry');
    metric.verifiedSubtotalPaise = sum(metric.verifiedSubtotalPaise, moneyPaise(entry.amount)*(entry.direction==='credit'?1:-1));
  } catch { addIssue(metric, 'commission_entry_invalid'); }
}

export function addPostedRevenue(metric, entry) {
  const before = metric.verifiedSubtotalPaise;
  let component;
  if (entry.account === 'commission_revenue') {
    component = 'orderCommissionPaise'; addPostedCommission(metric, entry);
  } else {
    try {
      const amount = moneyPaise(entry.amount);
      if (entry.currency !== 'INR' || !['credit','debit'].includes(entry.direction)) throw Error('Invalid income');
      if (entry.account === 'parcel_revenue') {
        if (!entry.parcelDeliveryId || !['adjustment','reversal'].includes(entry.type) || entry.metadata?.amountPaise !== amount) throw Error('Invalid parcel income');
        component = 'parcelRevenuePaise';
      } else if (entry.account === 'advertising_revenue') {
        if (!entry.advertisingCampaignId || !entry.paymentId || !['advertising_recognition','advertising_refund'].includes(entry.type)) throw Error('Invalid advertising income');
        component = 'advertisingRevenuePaise';
      } else { metric.excludedRecords++; return; }
      metric.verifiedSubtotalPaise = sum(before, amount * (entry.direction === 'credit' ? 1 : -1));
    } catch { addIssue(metric, 'revenue_entry_invalid'); return; }
  }
  if (metric.breakdown) metric.breakdown[component] = sum(metric.breakdown[component], metric.verifiedSubtotalPaise - before);
}

const orderProjection = { _id:1, userId:1, groupRef:1, paymentMethod:1, paymentId:1, status:1, 'pricing.totalAmount':1,
  'codFinance.status':1,'codFinance.verifiedPaise':1,'codFinance.events.action':1,'codFinance.events.actorId':1,'codFinance.events.amountPaise':1,'codFinance.events.reference':1,
  'financialSnapshot.version':1,'financialSnapshot.expectedPaise':1,financialPosting:1,'items._id':1 };
const otherPurposes = ['isWalletTopup','advertising','parcelDeliveryId','serviceApplicationId','quickFeeSnapshotId','subscriptionId','shgSubscriptionId','premiumMembershipId','sellerPromotionId','packagingOrderId'];

export async function getAdminFinancialMetrics() {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const orderValue = newMetric(), collections = newMetric(), commission = newMetric();
      commission.breakdown = { orderCommissionPaise: 0, parcelRevenuePaise: 0, advertisingRevenuePaise: 0 };
      const seenCaptures = new Set(), seenRefunds = new Set();
      // Project only finance fields; no names, contacts, destinations or provider calls.
      for await (const order of Order.aggregate([{$project:orderProjection},{$lookup:{from:Payment.collection.name,localField:'paymentId',foreignField:'_id',pipeline:[{$project:Object.fromEntries(['_id','userId','orderId','groupRef','method',...otherPurposes].map(key=>[key,1]))}],as:'paymentEvidence'}},
        {$lookup:{from:Ledger.collection.name,localField:'_id',foreignField:'orderId',pipeline:[{$match:{'metadata.source':'historical-reviewed-v1',account:'merchandise_gross',direction:'credit'}},{$project:{'metadata.itemId':1}}],as:'historicalEvidence'}}]).session(session).cursor()) {
        addCompletedOrder(orderValue,order);
        const historicalCovered = order.items?.length > 0 && order.items.every(item => order.historicalEvidence.some(entry => entry.metadata?.itemId === id(item._id)));
        if (order.status === 'delivered' && !historicalCovered) {
          if (order.financialSnapshot?.version !== 2) addIssue(commission, 'historical_commission_missing');
          else if (!order.financialPosting) addIssue(commission, 'commission_posting_missing');
        }
        if (order.status === 'delivered' && (!order.paymentId || !order.paymentEvidence.length || order.paymentEvidence.some(payment=>
          !payment.userId || !order.userId || id(payment.userId)!==id(order.userId) || payment.method!==order.paymentMethod
          || (payment.groupRef ? payment.groupRef!==order.groupRef : id(payment.orderId)!==id(order._id))
          || otherPurposes.some(key=>key==='isWalletTopup'?payment[key]===true:payment[key]!=null)))) addIssue(collections, 'payment_link_missing');
      }
      const purposeMatch = { $or:[{orderId:{$exists:true}},{groupRef:{$exists:true}}], isWalletTopup:{$ne:true} };
      for (const key of otherPurposes.filter(key=>key!=='isWalletTopup')) purposeMatch[key] = {$exists:false};
      const pipeline = [{$match:purposeMatch}, {$project:{_id:1,userId:1,orderId:1,groupRef:1,amount:1,method:1,status:1,captures:1,refundObligations:1,refund:1}},
        {$lookup:{from:Order.collection.name,let:{payment:'$_id'},pipeline:[{$match:{$expr:{$eq:['$paymentId','$$payment']}}},{$project:orderProjection}],as:'orders'}},
        {$lookup:{from:Return.collection.name,localField:'orders._id',foreignField:'orderId',pipeline:[{$project:{_id:1,orderId:1,status:1,refundAmount:1,refundReference:1,codSettledBy:1,codSettledAt:1,codSettlementNote:1}}],as:'returns'}}];
      for await (const payment of Payment.aggregate(pipeline).session(session).cursor()) addOrderCollection(collections,payment,payment.orders,payment.returns,seenCaptures,seenRefunds);
      for await (const entry of Ledger.find({account:{$in:['commission_revenue','parcel_revenue','advertising_revenue']}}).select('account amount currency direction type metadata serviceApplicationId parcelDeliveryId advertisingCampaignId paymentId').session(session).lean().cursor()) addPostedRevenue(commission, entry);
      result = {version:1,currency:'INR',unit:'paise',scope:'all-time',timezone:'Asia/Kolkata',asOf:new Date().toISOString(),
        orderValue:{...finish(orderValue),basis:'Gross completed order value before subsequent item refunds; includes customer delivery, tip and donation.'},
        collections:{...finish(collections),basis:'Net verified external order collections after verified completed refunds. Wallet transfers excluded; not bank settlement.'},
        platformRevenue:{...finish(commission),basis:'Net posted order commissions, earned parcel income and recognized advertising income, after posted reversals. Taxes, seller/rider payables, pending legal commissions and other unrecognized fees excluded.',scope:'posted-platform-income'}};
    }, {readConcern:{level:'snapshot'},readPreference:'primary'});
    return result;
  } finally { await session.endSession(); }
}
