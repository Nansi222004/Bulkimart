import { discountAllocation } from './orderDiscounts.service.js';
import { moneyPaise, allocatePaise } from '../utils/financeMoney.js';
export { moneyPaise, allocatePaise } from '../utils/financeMoney.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Commission from '../models/Commission.js';
import Product from '../models/Product.js';
import { httpError } from '../utils/response.js';

const id = (value, name) => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw httpError(400, `Invalid ${name}`);
  return value;
};

export const validateCommissionRule = (input) => {
  const out = {};
  if (!['general', 'shg'].includes(input.vendorType)) throw httpError(400, 'Vendor type is required');
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
  const effectiveDate = new Date(input.effectiveDate);
  if (!input.effectiveDate || !Number.isFinite(effectiveDate.getTime())) throw httpError(400, 'Effective date is required');
  if (typeof input.isActive !== 'boolean') throw httpError(400, 'Explicit enable status is required');
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 500) throw httpError(400, 'A reason of 5–500 characters is required');
  return { ...out, vendorType: input.vendorType, channel: input.channel, method: input.method,
    value: input.value, base: input.base, fixedScope: input.fixedScope,
    taxTreatment: input.taxTreatment, taxRate: input.taxRate, effectiveDate, isActive: input.isActive,
    categoryId: id(input.categoryId, 'category'), productId: id(input.productId, 'product'), reason };
};

export const saveCommissionVersion = async (input, adminId) => {
  const rule = validateCommissionRule(input);
  // A revision is a new document; optimistic parent check prevents stale edits.
  const scope = { financeVersion: 2, channel: rule.channel, vendorType: rule.vendorType, categoryId: rule.categoryId, productId: rule.productId };
  const { financialTransaction } = await import('./financeSafety.service.js');
  return financialTransaction(async session => {
    const latest = await Commission.findOne(scope).sort({ createdAt: -1, _id: -1 }).session(session);
    if (String(latest?._id || '') !== String(input.supersedes || '')) throw httpError(409, 'Commission changed; refresh before saving');
    if (rule.productId && !await Product.exists({ _id: rule.productId }).session(session)) throw httpError(400, 'Product does not exist');
    if (rule.categoryId) {
      const { default: Category } = await import('../models/Category.js');
      if (!await Category.exists({ _id: rule.categoryId }).session(session)) throw httpError(400, 'Category does not exist');
    }
    // Serialize concurrent edits even when this scope has no previous rule.
    const { default: Admin } = await import('../models/Admin.js');
    // One global fence prevents different admins racing to insert a first rule.
    const fence = await Admin.findOne().sort({ _id: 1 }).session(session);
    if (!fence) throw httpError(409, 'An administrator must exist before configuration');
    await Admin.updateOne({ _id: fence._id }, { $inc: { __v: 1 } }, { session });
    return (await Commission.create([{ ...rule, financeVersion: 2, version: crypto.randomUUID(),
      createdBy: adminId, supersedes: latest?._id }], { session }))[0];
  });
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
export const calculateMarketplaceLine = (grossPaise, eligiblePaise, rule, { tcsRatePercent = 0, tdsRatePercent = 0, gstRatePercent = 0 } = {}) => {
  if (!Number.isSafeInteger(grossPaise) || grossPaise < eligiblePaise) throw httpError(400, 'Invalid item subtotal');
  const { commissionPaise, taxPaise } = commissionCharge(eligiblePaise, rule);
  const taxableValuePaise = roundedRatio(grossPaise, 10000, 10000 + moneyPaise(gstRatePercent));
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

// Same proportional gross-value basis as calculateReturnRefund; distribute
// rounding residuals deterministically so the snapshot conserves every paisa.
export const buildOrderFinancialSnapshot = async (order, session) => {
  const at = new Date();
  const channel = order.salesChannel === 'wholesale' ? 'wholesale' : order.type === 'ecommerce' ? 'ecommerce' : 'quick';
  const query = Commission.find({ financeVersion: 2, channel, effectiveDate: { $lte: at } }).sort({ effectiveDate: -1, createdAt: -1, _id: -1 }).lean();
  if (session) query.session(session);
  const rules = await query;
  const productQuery = Product.find({ _id: { $in: order.items.map(item => item.productId) } }).select('category type channels gstRate').lean();
  if (session) productQuery.session(session);
  const products = await productQuery;
  const gross = order.items.map(item => {
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0 || !item.sellerId) throw httpError(409, 'Financial snapshots require seller-owned order quantities');
    const amount = moneyPaise(item.price) * item.qty;
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
    // Newest rule per scope wins, including an explicit disabled version.
    const scopes = new Map();
    for (const rule of rules.filter(rule => rule.vendorType === vendorType)) {
      const key = `${rule.productId || ''}:${rule.categoryId || ''}`;
      if (!scopes.has(key)) scopes.set(key, rule);
    }
    const candidates = [...scopes.values()].filter(rule => rule.isActive &&
      (!rule.productId || String(rule.productId) === String(item.productId)) &&
      (!rule.categoryId || String(rule.categoryId) === String(categoryId)));
    candidates.sort((a, b) => (Number(Boolean(b.productId)) * 2 + Number(Boolean(b.categoryId))) - (Number(Boolean(a.productId)) * 2 + Number(Boolean(a.categoryId))));
    const rule = candidates[0];
    const allocatedDiscounts = Object.fromEntries(discountKeys.map(key => [key, discounts[key][index]]));
    const eligiblePaise = gross[index] - Object.values(allocatedDiscounts).reduce((a, b) => a + b, 0);
    if (eligiblePaise < 0) throw httpError(409, 'Allocated discounts exceed line subtotal');
    return { itemId: String(item._id), productId: String(item.productId), sellerId: String(item.sellerId), categoryId: categoryId ? String(categoryId) : null,
      qty: item.qty, grossPaise: gross[index], allocatedDiscounts, eligiblePaise,
      rule: rule ? { id: String(rule._id), version: rule.version, method: rule.method, value: rule.value, minimum: rule.minimum, maximum: rule.maximum,
        base: rule.base, fixedScope: rule.fixedScope, taxTreatment: rule.taxTreatment, taxRate: rule.taxRate, effectiveDate: rule.effectiveDate } : null,
      ...(rule ? calculateMarketplaceLine(gross[index], eligiblePaise, rule, { ...withholding, gstRatePercent: productGstRate(product) }) : { platformDiscountPaise: gross[index] - eligiblePaise, gstRatePercent: productGstRate(product), blocker: 'No approved enabled commission rule' }) };
  });
  const expectedPaise = moneyPaise(p.totalAmount);
  const components = { merchandisePaise: lines.reduce((n, line) => n + line.eligiblePaise, 0), deliveryPaise: moneyPaise(p.deliveryCharge || 0), tipPaise: moneyPaise(p.tipAmount || 0), donationPaise: moneyPaise(p.donationAmount || 0) };
  if (Object.values(components).reduce((a, b) => a + b, 0) !== expectedPaise) throw httpError(409, 'Order financial components do not reconcile');
  return { version: 2, snapshotId: new mongoose.Types.ObjectId().toString(), currency: 'INR', frozenAt: at,
    channel, paymentMethod: order.paymentMethod, paymentId: String(order.paymentId), expectedPaise, components, lines,
    discountRepresentation: representation, discountFunding: 'platform', withholding,
    state: lines.every(line => line.rule) ? 'configured' : 'held_missing_rule',
    allocationPolicy: 'proportional-gross-conserved-components-v1', postingPolicy: 'delivered-verified-payment-return-hold-v1' };
};
