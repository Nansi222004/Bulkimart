import QuickCommerceDeliveryConfig from '../models/QuickCommerceDeliveryConfig.js';
import QuickCommerceFinancialSnapshot from '../models/QuickCommerceFinancialSnapshot.js';
import { getShiprocketCapabilities } from './shiprocket.service.js';
import { httpError } from '../utils/response.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import Order from '../models/Order.js';

export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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
  if (!config?.fee?.type || !Number.isFinite(config?.fee?.value) || !config?.fee?.version) {
    blockers.push('Complete service-fee rule');
  }
  if (!capabilities.configured) blockers.push('Provider credentials and webhook verification');
  if (!capabilities.quickCommerce) blockers.push('Provider Quick Commerce capability verification');
  return {
    config: config || {
      key: 'quick_third_party', enabled: false,
      fee: { calculationBasis: 'eligible_courier_freight', taxTreatment: 'pending_approval' },
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

export const saveQuickCommerceDraft = async ({ fee, adminId, enabled }) => {
  if (enabled === true) {
    throw httpError(409, 'Live Quick Commerce third-party delivery cannot be enabled while policy approvals remain outstanding');
  }
  const type = fee?.type;
  const value = Number(fee?.value);
  const version = String(fee?.version || '').trim();
  if (type !== undefined && !['flat', 'percent'].includes(type)) throw httpError(400, 'Fee type must be flat or percent');
  if (fee?.value !== undefined && (!Number.isFinite(value) || value < 0)) throw httpError(400, 'Fee value must be a finite non-negative number');
  if (type === 'percent' && value > 100) throw httpError(400, 'A percentage draft cannot exceed 100');
  if (fee?.version !== undefined && !version) throw httpError(400, 'Fee version cannot be blank');

  const set = { enabled: false, updatedBy: adminId };
  if (type !== undefined) set['fee.type'] = type;
  if (fee?.value !== undefined) set['fee.value'] = money(value);
  if (fee?.version !== undefined) set['fee.version'] = version;
  const config = await QuickCommerceDeliveryConfig.findOneAndUpdate(
    { key: 'quick_third_party' },
    { $set: set, $setOnInsert: { key: 'quick_third_party' } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  return config;
};

export const calculateOptionB = ({ customerDeliveryCharge, eligibleCourierFreight, feeRule }) => {
  const customerCharge = Number(customerDeliveryCharge);
  const freight = Number(eligibleCourierFreight);
  if (!Number.isFinite(customerCharge) || customerCharge < 0) throw httpError(400, 'Customer delivery charge is invalid');
  if (!Number.isFinite(freight) || freight < 0) throw httpError(400, 'Eligible courier freight is invalid');
  if (!['flat', 'percent'].includes(feeRule?.type)) throw httpError(503, 'Quick Commerce service-fee type is not configured');
  const feeValue = Number(feeRule?.value);
  if (!Number.isFinite(feeValue) || feeValue < 0 || !feeRule?.version) throw httpError(503, 'Quick Commerce service-fee rule is incomplete');
  if (feeRule.type === 'percent' && feeValue > 100) throw httpError(503, 'Quick Commerce percentage fee is outside the accepted technical range');

  const customerFreightContribution = money(Math.min(customerCharge, freight));
  const vendorFreightShare = money(Math.max(0, freight - customerFreightContribution));
  const serviceFee = money(feeRule.type === 'flat' ? feeValue : freight * feeValue / 100);
  return {
    customerDeliveryChargeAvailableForFreight: money(customerCharge),
    customerFreightContribution,
    eligibleCourierFreight: money(freight),
    vendorFreightShare,
    bulkimartServiceFee: serviceFee,
    vendorDeliveryFeeObligation: money(vendorFreightShare + serviceFee),
    calculationBasis: 'eligible_courier_freight',
  };
};

export const createImmutableFinancialSnapshot = async ({ order, sellerId, quote, config, session = null }) => {
  const existingQuery = QuickCommerceFinancialSnapshot.findOne({ orderId: order._id });
  if (session) existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) return { snapshot: existing, alreadyExists: true };
  if (config?.enabled !== true) throw httpError(409, 'Quick Commerce third-party delivery is disabled');
  const eligibleFreight = Number(quote?.freight_charge);
  if (!Number.isFinite(eligibleFreight) || eligibleFreight < 0) throw httpError(409, 'Provider quote has no valid freight_charge');
  const calculation = calculateOptionB({
    customerDeliveryCharge: order.pricing?.deliveryCharge || 0,
    eligibleCourierFreight: eligibleFreight,
    feeRule: config.fee,
  });
  const payload = {
    snapshotNo: `QCF-${order._id}`,
    orderId: order._id, sellerId, groupRef: order.groupRef,
    provider: 'shiprocket', providerQuoteReference: quote.quote_id || quote.courier_company_id,
    customerDeliveryChargeAvailableForFreight: calculation.customerDeliveryChargeAvailableForFreight,
    customerFreightContribution: calculation.customerFreightContribution,
    quotedCourierFreight: money(eligibleFreight), eligibleCourierFreight: calculation.eligibleCourierFreight,
    vendorFreightShare: calculation.vendorFreightShare,
    serviceFee: {
      type: config.fee.type, configuredValue: config.fee.value,
      calculationBasis: 'eligible_courier_freight', basisAmount: calculation.eligibleCourierFreight,
      amount: calculation.bulkimartServiceFee, version: config.fee.version,
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
    const freight = snapshot.vendorFreightShare > 0 ? await postLedgerEntry({
      idempotencyKey: `QUICK_FREIGHT:${order._id}`, sellerId, orderId: order._id, snapshotId: snapshot._id,
      type: 'quick_freight_obligation', direction: 'debit', bucket: 'held', amount: snapshot.vendorFreightShare,
      reference: snapshot.snapshotNo, description: `Quick courier freight obligation for ${order.orderNo}`,
      metadata: { calculationVersion: snapshot.calculationVersion },
    }, { session }) : null;
    const fee = snapshot.serviceFee.amount > 0 ? await postLedgerEntry({
      idempotencyKey: `QUICK_SERVICE_FEE:${order._id}`, sellerId, orderId: order._id, snapshotId: snapshot._id,
      type: 'quick_service_fee', direction: 'debit', bucket: 'held', amount: snapshot.serviceFee.amount,
      reference: snapshot.snapshotNo, description: `Bulkimart Quick third-party service fee for ${order.orderNo}`,
      metadata: { feeVersion: snapshot.serviceFee.version, basis: snapshot.serviceFee.calculationBasis },
    }, { session }) : null;
    await Order.updateOne(
      { _id: order._id, 'fulfillment.financialSnapshotId': { $exists: false } },
      { $set: { 'fulfillment.financialSnapshotId': snapshot._id, 'fulfillment.chargeStatus': 'pending' } },
      { session },
    );
    return { snapshot, entries: [freight?.entry, fee?.entry].filter(Boolean), alreadyExists: false };
  }
  return { snapshot, entries: [], alreadyExists: true };
};
