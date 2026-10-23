import { httpError } from '../utils/response.js';
import { validateRazorpayConfig } from './razorpay.service.js';
export const advertisingProduction = () => ['NODE_ENV','DEPLOYMENT_ENV','APP_ENV','VERCEL_ENV','RENDER_ENV'].some(k => ['production','prod','deployment-production'].includes(String(process.env[k] || '').trim().toLowerCase()));
export function advertisingBillingEnabled() {
  return process.env.ADVERTISING_MANAGEMENT_ENABLED === 'true' && process.env.ADVERTISING_BILLING_ENABLED === 'true'
    && (!advertisingProduction() || process.env.ADVERTISING_PRODUCTION_ENABLED === 'true');
}
export function requireAdvertisingGateway() {
  if (!advertisingBillingEnabled()) throw httpError(503, 'Advertising billing is disabled');
  validateAdvertisingGatewayEnvironment();
}
export function requireAdvertisingRefundGateway(){
  if(process.env.ADVERTISING_REFUNDS_ENABLED!=='true'||(advertisingProduction()&&process.env.ADVERTISING_PRODUCTION_ENABLED!=='true'))throw httpError(503,'Advertising refunds are disabled');
  validateAdvertisingGatewayEnvironment();
}
function validateAdvertisingGatewayEnvironment(){
  const expectedMode = advertisingProduction() ? 'live' : 'test';
  if (process.env.PAYMENT_GATEWAY !== 'razorpay' || process.env.RAZORPAY_MODE !== expectedMode) throw httpError(503, `Advertising requires Razorpay ${expectedMode} mode in this environment`);
  try { validateRazorpayConfig(); } catch { throw httpError(503, 'Configure the matching Razorpay key, server secret and webhook secret'); }
}
export function validateAdBillingPolicy(input) {
  const keys = ['approvalReference','taxTreatment','taxRateBps','taxRecognition','issuer','invoiceMode','creditNoteMode','startCondition','interruption','refunds','recognition'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!keys.includes(k))) throw httpError(400,'Invalid advertising billing policy');
  for (const key of ['approvalReference','issuer']) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 200) throw httpError(400,`Specify ${key}`);
  if (!['NONE','INCLUSIVE','EXCLUSIVE'].includes(input.taxTreatment) || !Number.isSafeInteger(input.taxRateBps) || input.taxRateBps<0 || input.taxRateBps>10000 || (input.taxTreatment==='NONE' && input.taxRateBps!==0)
    || input.taxRecognition!=='ON_RECEIPT' || !['NOT_REQUIRED','EXTERNAL_REFERENCE'].includes(input.invoiceMode) || !['NOT_REQUIRED','EXTERNAL_REFERENCE'].includes(input.creditNoteMode)
    || input.startCondition!=='VERIFIED_PAYMENT_OR_REQUESTED_START' || input.interruption!=='STOP_AND_REVIEW' || input.recognition!=='MANUAL_AFTER_COMPLETION') throw httpError(400,'Incomplete or unsupported advertising billing policy');
  const reasons=['cancellationBps','suspensionBps','unavailableBps','unusedBps'];
  if (!input.refunds || Object.keys(input.refunds).length!==4 || reasons.some(k=>!Number.isSafeInteger(input.refunds[k]) || input.refunds[k]<0 || input.refunds[k]>10000)) throw httpError(400,'Configure every refund limit explicitly in basis points');
  return Object.fromEntries(keys.map(k=>[k,input[k]]));
}
export function adCharge(terms) {
  if (!terms?.policies?.billing) throw httpError(409,'Campaign has no approved billing policy snapshot; submit and approve a new campaign with configured terms');
  const source=terms.policies.billing.toObject ? terms.policies.billing.toObject() : terms.policies.billing;
  const policy=validateAdBillingPolicy(source), amount=terms.amountPaise;
  if (!Number.isSafeInteger(amount) || amount<1 || terms.currency!=='INR') throw httpError(409,'Invalid accepted campaign amount/currency');
  const basePaise=policy.taxTreatment==='INCLUSIVE' ? Math.round(amount*10000/(10000+policy.taxRateBps)) : amount;
  const taxPaise=policy.taxTreatment==='NONE' ? 0 : policy.taxTreatment==='INCLUSIVE' ? amount-basePaise : Math.round(amount*policy.taxRateBps/10000);
  const totalPaise=basePaise+taxPaise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise>100000000 || basePaise<1) throw httpError(400,'Invalid advertising total');
  return {basePaise,taxPaise,totalPaise,currency:'INR',policy};
}
