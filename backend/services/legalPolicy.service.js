import crypto from 'node:crypto';
import Commission from '../models/Commission.js';
import { fail, text } from './serviceForms.service.js';
import { moneyPaise, calculateCommission } from './vendorCommission.service.js';
import { MAX_CHECKOUT_PAISE } from '../utils/money.js';
import { requireServiceGateway } from './servicePaymentPolicy.service.js';

export const legalFlags = () => ({
  submissions: true, fulfilment: true, payments: true, refunds: true,
  // External provider transfers need a payout adapter and verified banking.
  payouts: false,
});
export function requireLegalFlag(kind) {
  if (!legalFlags()[kind]) fail('Legal Services capability is not enabled', 503);
}
export function requireLegalGateway(kind = 'payments') {
  requireLegalFlag(kind);
  requireServiceGateway();
}
export const legalAdminPermission = (req, _res, next) => {
  if (req.userType !== 'admin' || (req.user.role !== 'superAdmin' && !req.user.permissions?.includes('manage_services'))) fail('Service management permission required', 403);
  next();
};
export const legalFinancePermission = (req, _res, next) => {
  if (req.user.role !== 'superAdmin' && !req.user.permissions?.includes('manage_finance')) fail('Finance permission required', 403);
  next();
};
export function validateLegalPolicy(body) {
  const rate = body.rate;
  moneyPaise(rate, 'Commission rate');
  if (rate > 100 || body.base !== 'service_excluding_tax' || body.gatewayFees !== 'platform_absorbed' || body.providerDeductions !== 'none' || body.refundAllocation !== 'proportional_total') fail('Explicit supported commission, fee, deduction and refund allocation policies are required');
  if (!['exempt', 'exclusive'].includes(body.serviceTaxTreatment)) fail('Select an explicit service tax treatment');
  moneyPaise(body.serviceTaxRate, 'Service tax rate');
  if (body.serviceTaxRate > 100 || (body.serviceTaxTreatment === 'exempt' && body.serviceTaxRate !== 0)) fail('Invalid service tax policy');
  if (!['exempt', 'exclusive', 'inclusive'].includes(body.commissionTaxTreatment)) fail('Commission tax treatment is required');
  moneyPaise(body.commissionTaxRate, 'Commission tax rate');
  if (body.commissionTaxRate > 100 || (body.commissionTaxTreatment === 'exempt' && body.commissionTaxRate !== 0)) fail('Invalid commission tax policy');
  const effectiveDate = new Date(body.effectiveDate);
  if (!Number.isFinite(effectiveDate.getTime()) || !Number.isSafeInteger(body.settlementHoldHours) || body.settlementHoldHours < 0 || body.settlementHoldHours > 8760) fail('Effective date and settlement hold hours are required');
  return { financeVersion: 2, vendorType: 'general', channel: 'legal', method: 'percentage', value: rate,
    base: 'confirmed_service_amount', taxTreatment: body.commissionTaxTreatment, taxRate: body.commissionTaxRate,
    version: crypto.randomUUID(), effectiveDate, isActive: true,
    reason: text(body.approvalReference, 'Policy approval reference', 500, true),
    legalPolicy: { serviceTaxTreatment: body.serviceTaxTreatment, serviceTaxRate: body.serviceTaxRate,
      base: body.base, gatewayFees: body.gatewayFees, providerDeductions: body.providerDeductions,
      refundAllocation: body.refundAllocation, settlementHoldHours: body.settlementHoldHours,
      terms: text(body.terms, 'Customer cancellation, refund and payment terms', 10000, true) } };
}
export const ratio = (n, multiplier, divisor) => Number((BigInt(n) * BigInt(multiplier) + BigInt(Math.floor(divisor / 2))) / BigInt(divisor));
export function quotationSnapshot(input, rule, application, adminId, now = new Date()) {
  if (!rule || rule.channel !== 'legal' || !rule.isActive || !rule.legalPolicy || new Date(rule.effectiveDate) > now) fail('An effective approved Legal Services policy is required', 409);
  const servicePaise = moneyPaise(input.serviceAmount, 'Service amount');
  if (servicePaise <= 0) fail('Confirmed service amount must be positive');
  const serviceTaxPaise = ratio(servicePaise, moneyPaise(rule.legalPolicy.serviceTaxRate), 10000);
  const c = calculateCommission(servicePaise, rule);
  const totalPaise = servicePaise + serviceTaxPaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise > MAX_CHECKOUT_PAISE) fail('Quotation exceeds the existing gateway adapter amount limit');
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) fail('Quotation expiry must be in the future');
  return { version: (application.legal?.quotes?.length || 0) + 1, requestId: String(application._id), serviceId: String(application.service),
    scope: text(input.scope, 'Scope', 10000, true), currency: 'INR', servicePaise, serviceTaxPaise, totalPaise,
    commissionPaise: c.commissionPaise, commissionTaxPaise: c.taxPaise, providerPaise: c.netPaise,
    policyId: String(rule._id), policyVersion: rule.version, rate: rule.value, policy: structuredClone(rule.legalPolicy),
    confirmedAt: now, expiresAt, confirmedBy: String(adminId) };
}
export const currentQuote = a => a.legal?.quotes?.at(-1);
export function quotePayable(a, now = new Date()) {
  const q = currentQuote(a);
  return Boolean(q && a.status === 'awaiting_payment' && !a.legal?.hold && !a.legal?.cancellation && (!q.expiresAt || new Date(q.expiresAt) > now));
}
export function settlementBlockers(a, now = new Date()) {
  const q = currentQuote(a), l = a.legal || {}, blockers = [];
  if (a.status !== 'completed' || !l.completionVerifiedAt) blockers.push('completion_not_verified');
  if (!['paid', 'partial_refund'].includes(l.paymentStatus) || !q || l.capturedPaise !== q.totalPaise) blockers.push('full_payment_not_verified');
  if (l.bankReconciliation?.status !== 'verified') blockers.push('bank_settlement_unreconciled');
  if (l.hold || l.cancellation || l.refunds?.some(r => r.status !== 'processed')) blockers.push('financial_hold');
  if (l.extraCaptures?.length) blockers.push('additional_capture_requires_reconciliation');
  if (q && (!l.completionVerifiedAt || new Date(l.completionVerifiedAt).getTime() + q.policy.settlementHoldHours * 3600000 > now.getTime())) blockers.push('settlement_hold_period');
  if (l.payout) blockers.push('payout_already_reserved');
  return blockers;
}
export const latestLegalRule = session => {
  const q = Commission.findOne({ channel: 'legal', financeVersion: 2, effectiveDate: { $lte: new Date() } }).sort({ effectiveDate: -1, createdAt: -1, _id: -1 });
  return session ? q.session(session) : q;
};
