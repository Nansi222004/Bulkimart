import { discountAllocation } from './orderDiscounts.service.js';
import { moneyPaise, allocatePaise } from '../utils/financeMoney.js';
export { moneyPaise, allocatePaise } from '../utils/financeMoney.js';
import crypto from 'crypto';
import { itemGrossPaise } from './productGst.service.js';
import mongoose from 'mongoose';
import Commission from '../models/Commission.js';
import CommissionCurrent, { commissionScopeKey } from '../models/CommissionCurrent.js';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';

const id = (value, name) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw httpError(400, `Invalid ${name}`);
  return value;
};

export const validateCommissionRule = (input) => {
  const out = {};
  // SHG selling is retired; its vendor type stays in the schema only so old
  // audit records still load.
  if (input.vendorType === 'shg') throw httpError(400, 'SHG sellers are retired; commission applies to general sellers only');
  if (input.vendorType !== 'general') throw httpError(400, 'Vendor type is required');
  if (!['ecommerce', 'quick', 'wholesale'].includes(input.channel)) throw httpError(400, 'Commission channel is required');
  if (!['fixed', 'percentage'].includes(input.method)) throw httpError(400, 'Commission method is required');
  if (input.base !== 'eligible_item_subtotal' || input.fixedScope !== 'order_item') throw httpError(400, 'Explicit eligible subtotal base and order-item scope are required');
  moneyPaise(input.value, 'Commission value');
  if (input.method === 'percentage' && input.value > 100) throw httpError(400, 'Percentage cannot exceed 100');
  for (const key of ['minimum', 'maximum']) {
    if (input[key] != null) { moneyPaise(input[key], key); out[key] = input[key]; }
  }
  if (out.maximum != null && out.maximum < (out.minimum || 0)) throw httpError(400, 'Maximum cannot be below minimum');
  if (!['inclusive', 'exclusive', 'exempt'].includes(input.taxTreatment)) throw httpError(400, 'Explicit tax treatment is required');
  moneyPaise(input.taxRate, 'Tax rate');
  if (input.taxRate > 100 || (input.taxTreatment === 'exempt' && input.taxRate !== 0)) throw httpError(400, 'Invalid tax rate');
  if (typeof input.isActive !== 'boolean') throw httpError(400, 'Explicit enable status is required');
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw httpError(400, 'A reason of 5–500 characters is required');
  // Rules take effect when saved; there is no scheduling, so no date is read from the request.
  return { ...out, vendorType: input.vendorType, channel: input.channel, method: input.method,
    value: input.value, base: input.base, fixedScope: input.fixedScope,
    taxTreatment: input.taxTreatment, taxRate: input.taxRate, isActive: input.isActive,
    categoryId: id(input.categoryId, 'category'), productId: id(input.productId, 'product'), reason };
};

/**
 * Replace the current rule for one scope. The old version stays in
 * `commissions` for audit; the scope pointer moves to the new one, so the
 * next order uses it and orders already placed keep their frozen snapshot.
 * `supersedes` must name the rule the admin was editing (empty for a new
 * scope), which rejects stale or concurrent edits.
 */
// One scope's replacement, inside the caller's transaction.
const saveScope = async (rule, supersedes, adminId, session) => {
  const key = commissionScopeKey(rule);
  const current = await CommissionCurrent.findById(key).session(session);
  if (String(current?.ruleId || '') !== String(supersedes || '')) throw httpError(409, 'Commission changed; refresh before saving');
  if (rule.productId && !await Product.exists({ _id: rule.productId }).session(session)) throw httpError(400, 'Product does not exist');
  if (rule.categoryId) {
    const { default: Category } = await import('../models/Category.js');
    if (!await Category.exists({ _id: rule.categoryId }).session(session)) throw httpError(400, 'Category does not exist');
  }
  const [saved] = await Commission.create([{ ...rule, effectiveDate: new Date(), financeVersion: 2, version: crypto.randomUUID(),
    createdBy: adminId, supersedes: current?.ruleId }], { session });
  const revision = (current?.revision || 0) + 1;
  if (current) {
    const moved = await CommissionCurrent.updateOne({ _id: key, revision: current.revision }, { $set: { ruleId: saved._id, revision, updatedBy: adminId } }, { session });
    if (!moved.matchedCount) throw httpError(409, 'Commission changed; refresh before saving');
  } else {
    await CommissionCurrent.create([{ _id: key, channel: rule.channel, vendorType: rule.vendorType, categoryId: rule.categoryId,
      productId: rule.productId, ruleId: saved._id, revision, updatedBy: adminId }], { session });
  }
  return saved;
};

const inCommissionTransaction = async (work) => {
  const { financialTransaction } = await import('./financeSafety.service.js');
  try {
    return await financialTransaction(work);
  } catch (error) {
    // Two admins creating the first rule for one scope collide on the pointer key.
    if (error?.code === 11000) throw httpError(409, 'Commission changed; refresh before saving');
    throw error;
  }
};

export const saveCommissionVersion = async (input, adminId) => {
  const rule = validateCommissionRule(input);
  return inCommissionTransaction(session => saveScope(rule, input.supersedes, adminId, session));
};

/**
 * The same channel-wide rule for every channel, saved together: either every
 * channel moves to the new rate or none does. `supersedesByChannel` names the
 * rule the admin saw for each channel (null where there was none). Category
 * and product overrides are channel-specific, so they are set per channel.
 */
export const saveCommissionForAllChannels = async (input, adminId) => {
  if (input.categoryId || input.productId) throw httpError(400, 'Category and product overrides are set one channel at a time');
  const supersedes = input.supersedesByChannel || {};
  const rules = COMMISSION_CHANNELS.map(channel => validateCommissionRule({ ...input, channel }));
  return inCommissionTransaction(async session => {
    const saved = [];
    for (const rule of rules) saved.push(await saveScope(rule, supersedes[rule.channel], adminId, session));
    return saved;
  });
};

// Current rules for one channel, as rule documents carrying their scope.
const currentRulesFor = async (channel, session) => {
  const pointerQuery = CommissionCurrent.find({ channel }).lean();
  if (session) pointerQuery.session(session);
  const pointers = await pointerQuery;
  if (!pointers.length) return [];
  const ruleQuery = Commission.find({ _id: { $in: pointers.map(row => row.ruleId) } }).lean();
  if (session) ruleQuery.session(session);
  return ruleQuery;
};

// Product rule beats category rule beats the channel-wide rule; a switched-off
// override simply falls through to the broader scope.
export const resolveCommissionRule = (rules, { vendorType, productId, categoryId }) => rules
  .filter(rule => rule.vendorType === vendorType && rule.isActive
    && (!rule.productId || String(rule.productId) === String(productId))
    && (!rule.categoryId || String(rule.categoryId) === String(categoryId)))
  .sort((a, b) => (Number(Boolean(b.productId)) * 2 + Number(Boolean(b.categoryId))) - (Number(Boolean(a.productId)) * 2 + Number(Boolean(a.categoryId))))[0] || null;

export const COMMISSION_CHANNELS = ['ecommerce', 'quick', 'wholesale'];
export const COMMISSION_VENDOR_TYPES = ['general'];

/** Every current rule, plus which rule covers each channel and vendor type by default. */
export const describeCurrentCommissionRules = async () => {
  const pointers = await CommissionCurrent.find({}).lean();
  const rules = await Commission.find({ _id: { $in: pointers.map(row => row.ruleId) } }).lean();
  const byId = new Map(rules.map(rule => [String(rule._id), rule]));
  const current = pointers.map(pointer => ({ ...byId.get(String(pointer.ruleId)), scopeKey: pointer._id, revision: pointer.revision, updatedAt: pointer.updatedAt }))
    .filter(rule => rule._id);
  const coverage = COMMISSION_CHANNELS.flatMap(channel => COMMISSION_VENDOR_TYPES.map(vendorType => {
    const rule = current.find(row => row.channel === channel && row.vendorType === vendorType && !row.categoryId && !row.productId);
    return { channel, vendorType, ruleId: rule?._id || null, active: Boolean(rule?.isActive),
      overrides: current.filter(row => row.channel === channel && row.vendorType === vendorType && (row.categoryId || row.productId)).length };
  }));
  return { current, coverage };
};

/**
 * One-time move from date-selected versions to current-rule pointers. For each
 * scope it picks the rule the old date-based selection applies today, so new
 * orders keep the same rate after the switch. Future-dated versions are
 * reported, never activated. Dry run unless `apply` is true; writes only
 * pointers, never `commissions` or orders.
 */
export const bootstrapCurrentCommissionRules = async ({ apply = false, now = new Date() } = {}) => {
  const rules = await Commission.find({ financeVersion: 2, channel: { $in: COMMISSION_CHANNELS } }).sort({ effectiveDate: -1, createdAt: -1, _id: -1 }).lean();
  const scopes = new Map(), futureVersions = [];
  for (const rule of rules) {
    const key = commissionScopeKey(rule);
    if (rule.effectiveDate && new Date(rule.effectiveDate) > now) { futureVersions.push({ scopeKey: key, ruleId: String(rule._id), effectiveDate: rule.effectiveDate }); continue; }
    if (!scopes.has(key)) scopes.set(key, rule);
  }
  const existing = new Set((await CommissionCurrent.find({}).select('_id').lean()).map(row => row._id));
  const plan = [...scopes.entries()].map(([scopeKey, rule]) => ({ scopeKey, ruleId: String(rule._id), channel: rule.channel, vendorType: rule.vendorType,
    method: rule.method, value: rule.value, isActive: rule.isActive, action: existing.has(scopeKey) ? 'already_current' : 'set_current' }));
  if (apply) {
    for (const row of plan.filter(item => item.action === 'set_current')) {
      const rule = scopes.get(row.scopeKey);
      await CommissionCurrent.updateOne({ _id: row.scopeKey }, { $setOnInsert: { channel: rule.channel, vendorType: rule.vendorType,
        categoryId: rule.categoryId || null, productId: rule.productId || null, ruleId: rule._id, revision: 1 } }, { upsert: true });
    }
  }
  return { applied: apply, plan, futureVersions };
};

const roundedRatio = (amount, multiplier, divisor) => Number((BigInt(amount) * BigInt(multiplier) + BigInt(Math.floor(divisor / 2))) / BigInt(divisor));
const commissionCharge = (eligiblePaise, rule) => {
  if (!Number.isSafeInteger(eligiblePaise) || eligiblePaise < 0) throw httpError(400, 'Invalid eligible subtotal');
  let charge = rule.method === 'fixed' ? moneyPaise(rule.value) : roundedRatio(eligiblePaise, moneyPaise(rule.value), 10000);
  if (rule.minimum != null) charge = Math.max(charge, moneyPaise(rule.minimum));
  if (rule.maximum != null) charge = Math.min(charge, moneyPaise(rule.maximum));
  // Empty/fully discounted lines never generate a minimum or fixed charge.
  if (eligiblePaise === 0) charge = 0;
  const tax = rule.taxTreatment === 'exempt' ? 0 : rule.taxTreatment === 'inclusive'
    ? charge - roundedRatio(charge, 10000, 10000 + moneyPaise(rule.taxRate)) : roundedRatio(charge, moneyPaise(rule.taxRate), 10000);
  return { commissionPaise: rule.taxTreatment === 'inclusive' ? charge - tax : charge, taxPaise: tax };
};

export const calculateCommission = (eligiblePaise, rule) => {
  const { commissionPaise, taxPaise } = commissionCharge(eligiblePaise, rule);
  const deduction = commissionPaise + taxPaise;
  if (deduction > eligiblePaise) throw httpError(409, 'Commission and tax exceed eligible item subtotal; policy review required');
  return { commissionPaise, taxPaise, netPaise: eligiblePaise - deduction };
};

/**
 * One marketplace order line under the approved platform-funded discount
 * policy: commission (and GST on it) is charged on the price the customer
 * paid after discounts, but the seller is paid on the full item price because
 * Bulkimart funds the discount. Item prices include GST, so TCS (GST s.52) is
 * withheld on the value excluding the item's GST, and TDS (194-O) on the full
 * item price, at the admin-set rates.
 */
export const calculateMarketplaceLine = (grossPaise, eligiblePaise, rule, { tcsRatePercent = 0, tdsRatePercent = 0, gstRatePercent = 0, taxableValuePaise: frozenTaxableValue } = {}) => {
  if (!Number.isSafeInteger(grossPaise) || grossPaise < eligiblePaise) throw httpError(400, 'Invalid item subtotal');
  const { commissionPaise, taxPaise } = commissionCharge(eligiblePaise, rule);
  const taxableValuePaise = frozenTaxableValue ?? roundedRatio(grossPaise, 10000, 10000 + moneyPaise(gstRatePercent));
  const tcsPaise = roundedRatio(taxableValuePaise, moneyPaise(tcsRatePercent), 10000);
  const tdsPaise = roundedRatio(grossPaise, moneyPaise(tdsRatePercent), 10000);
  const deduction = commissionPaise + taxPaise + tcsPaise + tdsPaise;
  if (deduction > grossPaise) throw httpError(409, 'Commission, tax and withholding exceed the item price; policy review required');
  return { commissionPaise, taxPaise, tcsPaise, tdsPaise, gstRatePercent, taxableValuePaise, platformDiscountPaise: grossPaise - eligiblePaise, netPaise: grossPaise - deduction };
};

// Product GST rate frozen into the order; anything unusable counts as exempt (0%).
const productGstRate = product => {
  const rate = Number(product?.gstRate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 40 && Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-6 ? rate : 0;
};

/**
 * The Same-Day seller incentive the customer paid inside the delivery charge,
 * on the seller's behalf (Order.delivery.sellerIncentive, frozen at checkout).
 * Only a Same-Day order carries one; it can never exceed the delivery charge.
 */
export const sameDayIncentiveOf = (order, deliveryChargePaise = moneyPaise(order.pricing?.deliveryCharge || 0)) => {
  if (order.delivery?.mode !== 'same_day' || !(order.delivery?.sellerIncentive > 0)) return 0;
  const incentive = moneyPaise(order.delivery.sellerIncentive, 'Same-day seller incentive');
  if (incentive > deliveryChargePaise) throw httpError(409, 'Same-day seller incentive exceeds the delivery charge');
  return incentive;
};

// Same proportional gross-value basis as calculateReturnRefund; distribute
// rounding residuals deterministically so the snapshot conserves every paisa.
export const buildOrderFinancialSnapshot = async (order, session) => {
  const at = new Date();
  const channel = order.salesChannel === 'wholesale' ? 'wholesale' : order.type === 'ecommerce' ? 'ecommerce' : 'quick';
  const rules = await currentRulesFor(channel, session);
  const productQuery = Product.find({ _id: { $in: order.items.map(item => item.productId) } }).select('category type channels gstRate').lean();
  if (session) productQuery.session(session);
  const products = await productQuery;
  const gross = order.items.map(item => {
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0 || !item.sellerId) throw httpError(409, 'Financial snapshots require seller-owned order quantities');
    const amount = itemGrossPaise(item);
    if (!Number.isSafeInteger(amount)) throw httpError(409, 'Item amount exceeds supported precision');
    return amount;
  });
  const p = order.pricing;
  if (gross.reduce((a, b) => a + b, 0) !== moneyPaise(p.subtotal)) throw httpError(409, 'Merchandise subtotal does not reconcile');
  const { keys: discountKeys, discounts, representation } = discountAllocation(p, gross);
  const { getFinancePolicy } = await import('./financePolicy.service.js');
  const { tcsRatePercent, tdsRatePercent } = await getFinancePolicy({ session });
  const withholding = { tcsRatePercent, tdsRatePercent };
  const lines = order.items.map((item, index) => {
    const product = products.find(product => String(product._id) === String(item.productId));
    const categoryId = !product?.type || product.type === order.type ? product?.category
      : product.channels?.find(channel => channel.type === order.type && channel.isActive !== false)?.category;
    const vendorType = item.type === 'shg' ? 'shg' : 'general';
    const rule = resolveCommissionRule(rules, { vendorType, productId: item.productId, categoryId });
    const allocatedDiscounts = Object.fromEntries(discountKeys.map(key => [key, discounts[key][index]]));
    const eligiblePaise = gross[index] - Object.values(allocatedDiscounts).reduce((a, b) => a + b, 0);
    const tax = order.productTax?.lines[index];
    const productTaxFields = tax ? { gstRatePercent: tax.gstRate, gstPriceType: tax.gstPriceType, taxableValuePaise: tax.taxableValuePaise, productGstPaise: tax.gstPaise } : {};
    if (eligiblePaise < 0) throw httpError(409, 'Allocated discounts exceed line subtotal');
    return { itemId: String(item._id), productId: String(item.productId), sellerId: String(item.sellerId), categoryId: categoryId ? String(categoryId) : null,
      ...productTaxFields, qty: item.qty, grossPaise: gross[index], allocatedDiscounts, eligiblePaise,
      rule: rule ? { id: String(rule._id), version: rule.version, method: rule.method, value: rule.value, minimum: rule.minimum, maximum: rule.maximum,
        base: rule.base, fixedScope: rule.fixedScope, taxTreatment: rule.taxTreatment, taxRate: rule.taxRate, effectiveDate: rule.effectiveDate } : null,
      ...(rule ? calculateMarketplaceLine(gross[index], eligiblePaise, rule, { ...withholding, gstRatePercent: tax?.gstRate ?? productGstRate(product), taxableValuePaise: tax?.taxableValuePaise }) : { platformDiscountPaise: gross[index] - eligiblePaise, gstRatePercent: tax?.gstRate ?? productGstRate(product), blocker: 'No approved enabled commission rule' }) };
  });
  const expectedPaise = moneyPaise(p.totalAmount);
  const deliveryChargePaise = moneyPaise(p.deliveryCharge || 0);
  const sellerIncentivePaise = sameDayIncentiveOf(order, deliveryChargePaise);
  const components = { merchandisePaise: lines.reduce((n, line) => n + line.eligiblePaise, 0), deliveryPaise: deliveryChargePaise - sellerIncentivePaise,
    sellerIncentivePaise, tipPaise: moneyPaise(p.tipAmount || 0), donationPaise: moneyPaise(p.donationAmount || 0) };
  if (Object.values(components).reduce((a, b) => a + b, 0) !== expectedPaise) throw httpError(409, 'Order financial components do not reconcile');
  return { version: 2, snapshotId: new mongoose.Types.ObjectId().toString(), currency: 'INR', frozenAt: at,
    channel, paymentMethod: order.paymentMethod, paymentId: String(order.paymentId), expectedPaise, components, lines,
    discountRepresentation: representation, discountFunding: 'platform', withholding,
    state: lines.every(line => line.rule) ? 'configured' : 'held_missing_rule',
    allocationPolicy: 'proportional-gross-conserved-components-v1', postingPolicy: 'delivered-verified-payment-return-hold-v1' };
};
