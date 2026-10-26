import QuickCommerceDeliveryConfig from '../models/QuickCommerceDeliveryConfig.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { getShiprocketCapabilities } from './shiprocket.service.js';
import { httpError } from '../utils/response.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import Order from '../models/Order.js';
import { validateRazorpayConfig } from './razorpay.service.js';
import { getPaymentGateway } from '../config/runtime.js';
import { shiprocketEnvironment } from '../config/shiprocketEnvironment.js';

export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Where an order's prepaid Shiprocket obligation lives. New obligations use
 * their own seller account so an unpaid quote never looks like negative
 * earnings; orders charged before that keep their original account so the
 * matching payment credit nets against it.
 */
export const courierObligationAccount = async (orderId, session = null) => {
  const query = SellerLedgerEntry.findOne({ orderId, type: { $in: ['quick_freight_obligation', 'quick_service_fee', 'quick_fee_tax'] } }).select('account').lean();
  if (session) query.session(session);
  const existing = await query;
  return existing ? existing.account || 'seller_payable' : 'seller_courier_obligation';
};

const pendingPolicies = (config) => [
  ['Customer delivery-charge surplus', config?.policy?.customerSurplusTreatment],
  ['Return-window and hold', config?.policy?.returnAndHoldPolicy],
  ['Cancellation costs', config?.policy?.cancellationCostPolicy],
  ['COD reconciliation', config?.policy?.codReconciliationPolicy],
  ['Insufficient seller funds', config?.policy?.insufficientFundsPolicy],
  ['Shared freight allocation', config?.policy?.sharedFreightAllocation],
  ['Service-fee tax treatment', config?.fee?.taxTreatment],
  ['Live shipment and financial-deduction release verification', config?.policy?.liveReleaseApproval],
].filter(([, value]) => !value || value === 'pending_approval').map(([label]) => label);

export const getQuickCommerceConfig = async () => {
  const config = await QuickCommerceDeliveryConfig.findOne({ key: 'quick_third_party' }).lean();
  const capabilities = getShiprocketCapabilities();
  const blockers = pendingPolicies(config);
  if (getPaymentGateway() !== 'razorpay') blockers.push('Existing Razorpay payment gateway must be configured');
  try { validateRazorpayConfig(); } catch { blockers.push('Razorpay configuration and verified webhook setup'); }
  try { validateServiceFeeConfiguration(config); } catch (error) { blockers.push(error.message); }
  if (!config?.effectiveAt || new Date(config.effectiveAt) > new Date()) blockers.push('Effective date has not been reached');
  if (config?.paymentRequired !== true) blockers.push('Approved postpaid seller collection is not implemented');
  if (!config?.fee?.type || !Number.isFinite(config?.fee?.value) || !config?.fee?.version) {
    blockers.push('Complete service-fee rule');
  }
  if (!capabilities.configured) blockers.push('Provider credentials and webhook verification');
  if (!capabilities.quickCommerce) blockers.push('Provider Quick Commerce capability verification');
  return {
    config: config || {
      key: 'quick_third_party', enabled: false,
      fee: { taxTreatment: 'pending_approval' },
      policy: {
        customerFreightAllocation: 'apply_first', historicalOrderPolicy: 'no_retroactive_deductions',
        customerSurplusTreatment: 'pending_approval', returnAndHoldPolicy: 'pending_approval',
        cancellationCostPolicy: 'pending_approval', codReconciliationPolicy: 'pending_approval',
        insufficientFundsPolicy: 'pending_approval', sharedFreightAllocation: 'pending_approval',
        liveReleaseApproval: 'pending_approval',
      },
    },
    provider: capabilities,
    activationReady: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
};

export const validateServiceFeeConfiguration = (config) => {
  const fee = config?.fee;
  if (!fee || !['flat', 'percent'].includes(fee.type) || typeof fee.value !== 'number' || !Number.isFinite(fee.value) || fee.value < 0 || (fee.type === 'percent' && fee.value > 100)) throw httpError(400, 'Choose a fee method and valid non-negative amount/rate');
  if (!String(fee.version || '').trim()) throw httpError(400, 'Fee version is required');
  if (!['eligible_courier_freight', 'vendor_freight_share'].includes(fee.calculationBasis)) throw httpError(400, 'Select an approved percentage calculation base');
  for (const key of ['minimum', 'maximum']) if (fee[key] != null && (typeof fee[key] !== 'number' || !Number.isFinite(fee[key]) || fee[key] < 0)) throw httpError(400, 'Fee limits must be non-negative numbers');
  if (fee.minimum != null && fee.maximum != null && fee.minimum > fee.maximum) throw httpError(400, 'Minimum fee cannot exceed maximum fee');
  if (!['inclusive', 'exclusive', 'exempt'].includes(fee.taxTreatment) || typeof fee.taxRate !== 'number' || !Number.isFinite(fee.taxRate) || fee.taxRate < 0 || fee.taxRate > 100 || (fee.taxTreatment === 'exempt' && fee.taxRate !== 0)) throw httpError(400, 'Approved tax treatment and explicit tax rate are required');
  if (config.currency !== 'INR') throw httpError(400, 'The existing payment provider supports INR collection only');
  if (!config.effectiveAt || !Number.isFinite(new Date(config.effectiveAt).getTime())) throw httpError(400, 'A valid effective date is required');
  if (typeof config.paymentRequired !== 'boolean') throw httpError(400, 'Specify whether prepayment is required');
  return true;
};

export const saveQuickCommerceDraft = async ({ fee, adminId, enabled, currency, effectiveAt, paymentRequired, revision }) => {
  const current = await QuickCommerceDeliveryConfig.findOne({ key: 'quick_third_party' }).lean();
  if (revision !== (current?.revision || 0)) throw httpError(409, 'Configuration changed; reload before saving');
  const next = { fee, currency, effectiveAt, paymentRequired, enabled: enabled === true };
  validateServiceFeeConfiguration(next);
  if (next.enabled) {
    const state = await getQuickCommerceConfig();
    // Policy approval is deliberately separate from this fee editor.
    if (pendingPolicies({ ...current, fee }).length || !state.provider.configured || !state.provider.quickCommerce || paymentRequired !== true || new Date(effectiveAt) > new Date()) throw httpError(409, 'Live activation requires approved policies, provider/reconciliation checks and an effective prepaid fee rule');
  }
  const updated = await QuickCommerceDeliveryConfig.findOneAndUpdate(
    current ? { _id: current._id, revision: current.revision == null ? { $exists: false } : current.revision } : { key: 'quick_third_party', revision: { $exists: false } },
    { $set: { ...next, updatedBy: adminId }, $inc: { revision: 1 }, $push: { history: { revision: (current?.revision || 0) + 1, changedAt: new Date(), changedBy: adminId, configuration: next } } },
    { upsert: !current, returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw httpError(409, 'Configuration changed; reload before saving');
  return updated;
};

export const calculateOptionB = ({ customerDeliveryCharge, eligibleCourierFreight, feeRule }) => {
  if (customerDeliveryCharge == null || customerDeliveryCharge === '' || eligibleCourierFreight == null || eligibleCourierFreight === '') throw httpError(400, 'Customer contribution and authoritative courier freight are required');
  const customerCharge = Number(customerDeliveryCharge);
  const freight = Number(eligibleCourierFreight);
  if (!Number.isFinite(customerCharge) || customerCharge < 0) throw httpError(400, 'Customer delivery charge is invalid');
  if (!Number.isFinite(freight) || freight < 0) throw httpError(400, 'Eligible courier freight is invalid');
  if (!['flat', 'percent'].includes(feeRule?.type)) throw httpError(503, 'Quick Commerce service-fee type is not configured');
  const feeValue = Number(feeRule?.value);
  if (feeRule.value == null || feeRule.value === '' || !Number.isFinite(feeValue) || feeValue < 0 || !feeRule?.version) throw httpError(503, 'Quick Commerce service-fee rule is incomplete');
  if (feeRule.type === 'percent' && feeValue > 100) throw httpError(503, 'Quick Commerce percentage fee is outside the accepted technical range');
  for (const key of ['minimum', 'maximum']) if (feeRule[key] != null && (typeof feeRule[key] !== 'number' || !Number.isFinite(feeRule[key]) || feeRule[key] < 0)) throw httpError(503, 'Fee limits are invalid');
  if (feeRule.minimum != null && feeRule.maximum != null && feeRule.minimum > feeRule.maximum) throw httpError(503, 'Fee limits are invalid');
  if (feeRule.taxRate != null && (typeof feeRule.taxRate !== 'number' || !Number.isFinite(feeRule.taxRate) || feeRule.taxRate < 0 || feeRule.taxRate > 100)) throw httpError(503, 'Tax rate is invalid');

  const customerFreightContribution = money(Math.min(customerCharge, freight));
  const vendorFreightShare = money(Math.max(0, freight - customerFreightContribution));
  const basis = feeRule.calculationBasis || 'eligible_courier_freight';
  if (!['eligible_courier_freight', 'vendor_freight_share'].includes(basis)) throw httpError(503, 'Invalid percentage calculation base');
  const basisAmount = basis === 'vendor_freight_share' ? vendorFreightShare : freight;
  let serviceFee = money(feeRule.type === 'flat' ? feeValue : basisAmount * feeValue / 100);
  if (feeRule.minimum != null) serviceFee = Math.max(serviceFee, feeRule.minimum);
  if (feeRule.maximum != null) serviceFee = Math.min(serviceFee, feeRule.maximum);
  serviceFee = money(serviceFee);
  const rate = Number(feeRule.taxRate || 0);
  const inclusive = feeRule.taxTreatment === 'inclusive';
  const net = inclusive ? money(serviceFee / (1 + rate / 100)) : serviceFee;
  const tax = inclusive ? money(serviceFee - net) : feeRule.taxTreatment === 'exclusive' ? money(net * rate / 100) : 0;
  const gross = inclusive ? serviceFee : money(net + tax);
  return {
    customerDeliveryChargeAvailableForFreight: money(customerCharge),
    customerFreightContribution,
    eligibleCourierFreight: money(freight),
    vendorFreightShare,
    bulkimartServiceFee: serviceFee,
    vendorDeliveryFeeObligation: money(vendorFreightShare + gross),
    serviceFeeNet: net, applicableTax: tax, serviceFeeGross: gross, basisAmount,
    calculationBasis: basis,
  };
};

export const createImmutableFinancialSnapshot = async ({ order, sellerId, quote, config, session = null }) => {
  const existingQuery = QuickCommerceFinancialSnapshot.findOne({ orderId: order._id });
  if (session) existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) return { snapshot: existing, alreadyExists: true };
  if (config?.enabled !== true) throw httpError(409, 'Quick Commerce third-party delivery is disabled');
  validateServiceFeeConfiguration(config);
  const eligibleFreight = Number(quote?.freight_charge);
  if (quote?.freight_charge == null || quote.freight_charge === '' || !Number.isFinite(eligibleFreight) || eligibleFreight < 0) throw httpError(409, 'Provider quote has no valid freight_charge');
  const calculation = calculateOptionB({
    customerDeliveryCharge: order.pricing?.deliveryCharge || 0,
    eligibleCourierFreight: eligibleFreight,
    feeRule: config.fee,
  });
  const payload = {
    snapshotNo: `QCF-${order._id}`,
    orderId: order._id, sellerId, groupRef: order.groupRef,
    configRevision: config.revision,
    providerEnvironment: shiprocketEnvironment().mode, paymentEnvironment: process.env.RAZORPAY_MODE,
    provider: 'shiprocket', providerQuoteReference: quote.quote_id || quote.courier_company_id,
    providerCourierId: quote.courier_company_id,
    customerDeliveryChargeAvailableForFreight: calculation.customerDeliveryChargeAvailableForFreight,
    customerFreightContribution: calculation.customerFreightContribution,
    quotedCourierFreight: money(eligibleFreight), eligibleCourierFreight: calculation.eligibleCourierFreight,
    vendorFreightShare: calculation.vendorFreightShare,
    serviceFee: {
      type: config.fee.type, configuredValue: config.fee.value,
      calculationBasis: calculation.calculationBasis, basisAmount: calculation.basisAmount,
      amount: calculation.serviceFeeNet,
      netAmount: calculation.serviceFeeNet, taxAmount: calculation.applicableTax, grossAmount: calculation.serviceFeeGross, taxRate: config.fee.taxRate, version: config.fee.version,
      minimum: config.fee.minimum, maximum: config.fee.maximum,
      taxTreatment: config.fee.taxTreatment,
    },
    vendorDeliveryFeeObligation: calculation.vendorDeliveryFeeObligation,
    accountingStatus: 'pending', quoteCapturedAt: new Date(),
    quoteExpiresAt: quote.expires_at ? new Date(quote.expires_at) : undefined,
  };
  const [snapshot] = await QuickCommerceFinancialSnapshot.create([payload], session ? { session } : {});
  return { snapshot, alreadyExists: false };
};

/**
 * Transactional internal primitive for the future activation path. It records
 * the immutable Option B calculation and both auditable liabilities before an
 * external shipment call is permitted. No live route invokes it while policy
 * activation is blocked.
 */
export const recordQuickCommerceObligation = async ({ order, sellerId, quote, config, session }) => {
  if (!session) throw httpError(500, 'A MongoDB transaction is required for financial posting');
  const { snapshot, alreadyExists } = await createImmutableFinancialSnapshot({ order, sellerId, quote, config, session });
  if (!alreadyExists) {
    const account = 'seller_courier_obligation';
    const freight = snapshot.vendorFreightShare > 0 ? await postLedgerEntry({
      idempotencyKey: `QUICK_FREIGHT:${order._id}`, sellerId, orderId: order._id, snapshotId: snapshot._id, account,
      type: 'quick_freight_obligation', direction: 'debit', bucket: 'held', amount: snapshot.vendorFreightShare,
      reference: snapshot.snapshotNo, description: `Quick courier freight obligation for ${order.orderNo}`,
      metadata: { calculationVersion: snapshot.calculationVersion },
    }, { session }) : null;
    const fee = snapshot.serviceFee.amount > 0 ? await postLedgerEntry({
      idempotencyKey: `QUICK_SERVICE_FEE:${order._id}`, sellerId, orderId: order._id, snapshotId: snapshot._id, account,
      type: 'quick_service_fee', direction: 'debit', bucket: 'held', amount: snapshot.serviceFee.amount,
      reference: snapshot.snapshotNo, description: `Bulkimart Quick third-party service fee for ${order.orderNo}`,
      metadata: { feeVersion: snapshot.serviceFee.version, basis: snapshot.serviceFee.calculationBasis },
    }, { session }) : null;
    const tax = snapshot.serviceFee.taxAmount > 0 ? await postLedgerEntry({
      idempotencyKey: `QUICK_TAX:${order._id}`, sellerId, orderId: order._id, snapshotId: snapshot._id, account,
      type: 'quick_fee_tax', direction: 'debit', bucket: 'held', amount: snapshot.serviceFee.taxAmount,
      reference: snapshot.snapshotNo, description: 'Tax on Quick Shiprocket service fee',
    }, { session }) : null;
    await Order.updateOne(
      { _id: order._id, 'fulfillment.financialSnapshotId': { $exists: false } },
      { $set: { 'fulfillment.financialSnapshotId': snapshot._id, 'fulfillment.chargeStatus': 'pending' } },
      { session },
    );
    return { snapshot, entries: [freight?.entry, fee?.entry, tax?.entry].filter(Boolean), alreadyExists: false };
  }
  return { snapshot, entries: [], alreadyExists: true };
};
