import {jest} from '@jest/globals';
import {getRoute} from '../services/maps.service.js';
import {requireParcel,parcelFlags} from '../services/parcelPolicy.service.js';
const original={...process.env};
beforeEach(()=>{
  process.env.NODE_ENV='test';
  for(const k of ['PAYMENT_GATEWAY','RAZORPAY_MODE','SHIPROCKET_MODE','DEPLOYMENT_ENV'])delete process.env[k];
});
afterEach(()=>{process.env={...original};jest.restoreAllMocks();});
test('actual road provider is unavailable in live mode and never substitutes a mock route',async()=>{
  process.env.MAPS_MODE='live';const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('No network allowed'));
  await expect(getRoute({lat:12.97,lng:77.59},{lat:12.98,lng:77.60})).rejects.toThrow('Real Google Maps directions are not implemented');
  expect(fetch).not.toHaveBeenCalled();
});
test('actual mock road route is explicitly limited to the isolated test runtime',async()=>{
  process.env.MAPS_MODE='mock';expect((await getRoute({lat:12.97,lng:77.59},{lat:12.98,lng:77.60})).distanceKm).toBe(5.2);
});
test.each(['production','prod','deployment-production',' PRODUCTION '])('production alias %s blocks every parcel operation even with all flags true',env=>{
  for(const k of Object.keys(parcelFlags()))process.env[`PARCEL_DELIVERY_${k.toUpperCase()}_ENABLED`]='true';
  process.env.DEPLOYMENT_ENV=env;
  for(const k of Object.keys(parcelFlags()).filter(k=>k!=='catalogue'))expect(()=>requireParcel(k)).toThrow(/release-blocked/);
});
