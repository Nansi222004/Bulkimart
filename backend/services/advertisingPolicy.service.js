import { httpError } from '../utils/response.js';
import { advertisingBillingEnabled, requireAdvertisingGateway, requireAdvertisingRefundGateway } from './advertisingBillingPolicy.service.js';
import { paidAdvertisingEnabled } from './advertisingPaidEligibility.service.js';
import { advertisingTelemetryConfig } from './advertisingTelemetry.service.js';
const gatewayReady=()=>{try{requireAdvertisingGateway();return true;}catch{return false;}};
const refundsReady=()=>{try{requireAdvertisingRefundGateway();return true;}catch{return false;}};
export const advertisingPilotCapabilities = () => {
  const productionBlocked = ['NODE_ENV', 'DEPLOYMENT_ENV', 'APP_ENV', 'VERCEL_ENV', 'RENDER_ENV'].some(key =>
    ['prod', 'production', 'deployment-production'].includes(String(process.env[key] || '').trim().toLowerCase()));
  return { pilotEnabled: !productionBlocked,
  productionBlocked, billable: false, telemetryEnabled: false };
};
export const advertisingCapabilities = () => ({
  ...advertisingPilotCapabilities(),
  managementEnabled: true,
  paymentsEnabled: advertisingBillingEnabled()&&gatewayReady(), deliveryEnabled: paidAdvertisingEnabled(), searchEnabled: false,
  refundsEnabled: refundsReady(),
  telemetryEnabled: advertisingTelemetryConfig().enabled,
  supportedPlacements: ['CATEGORY_SPONSORED'], billingModes: ['FIXED_DURATION'],
  blockers: [
    ...(!gatewayReady()?['BILLING_DISABLED_OR_GATEWAY_UNCONFIGURED']:[]),
    ...(!paidAdvertisingEnabled()?['PAID_CATEGORY_DELIVERY_DISABLED']:[]),
    ...(!advertisingTelemetryConfig().enabled?['TELEMETRY_DISABLED_OR_UNCONFIGURED']:[]),
  ],
});
export const requireAdvertisingManagement = (_req, _res, next) => {
  next();
};
export const advertisingPermission = (...permissions) => (req, _res, next) => {
  if (req.userType !== 'admin' || (req.user.role !== 'superAdmin' && !permissions.some(p => req.user.permissions?.includes(p)))) {
    throw httpError(403, 'Advertising permission required');
  }
  next();
};
export const advertisingUnavailable = () => {
  throw httpError(503, 'Advertising payments and delivery require approved financial policy and a verified integration', { code: 'ADVERTISING_RELEASE_BLOCKED' });
};
