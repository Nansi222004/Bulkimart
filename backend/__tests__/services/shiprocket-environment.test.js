import { jest } from '@jest/globals';
import axios from 'axios';
import { shiprocketEnvironment } from '../../config/shiprocketEnvironment.js';
import { getShiprocketToken } from '../../config/shiprocket.js';
import { validateRuntimeConfig } from '../../config/runtime.js';
import * as provider from '../../services/shiprocket.service.js';
const original={...process.env};let get,post,sequence=0;
const sandbox=()=>({NODE_ENV:'test',SHIPROCKET_MODE:'sandbox',SHIPROCKET_SANDBOX_BASE_URL:'https://isolated-provider.invalid',SHIPROCKET_SANDBOX_EMAIL:'fixture'+(++sequence)+'@example.invalid',SHIPROCKET_SANDBOX_PASSWORD:'fixture-secret',SHIPROCKET_SANDBOX_WEBHOOK_SECRET:'fixture-webhook',SHIPROCKET_SANDBOX_CONFIRMED:'true'});
beforeEach(()=>{Object.assign(process.env,sandbox());get=jest.spyOn(axios,'get');post=jest.spyOn(axios,'post');post.mockImplementation(async url=>({data:url.endsWith('/auth/login')?{token:'isolated-token'}:{}}));get.mockResolvedValue({data:{}});});
afterEach(()=>{jest.restoreAllMocks();for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);});
test('sandbox is opt-in, validates at boot and never reuses live credentials or the live API',async()=>{
  process.env.SHIPROCKET_EMAIL='live@example.invalid';process.env.SHIPROCKET_PASSWORD='never-use-this';
  validateRuntimeConfig();await getShiprocketToken();
  expect(post.mock.calls[0]).toEqual(['https://isolated-provider.invalid/v1/external/auth/login',{email:process.env.SHIPROCKET_SANDBOX_EMAIL,password:'fixture-secret'},{timeout:15000,maxRedirects:0}]);
  expect(provider.getShiprocketCapabilities()).toMatchObject({mode:'sandbox',configured:true});expect(JSON.stringify(provider.getShiprocketCapabilities())).not.toMatch(/secret|token|example.invalid/);
});
test.each(['SHIPROCKET_SANDBOX_BASE_URL','SHIPROCKET_SANDBOX_EMAIL','SHIPROCKET_SANDBOX_PASSWORD','SHIPROCKET_SANDBOX_WEBHOOK_SECRET','SHIPROCKET_SANDBOX_CONFIRMED'])('missing %s blocks before any HTTP request even with live credentials configured',async key=>{
  delete process.env[key];process.env.SHIPROCKET_EMAIL='live@example.invalid';process.env.SHIPROCKET_PASSWORD='live-secret';process.env.SHIPROCKET_BASE_URL='https://apiv2.shiprocket.in';
  expect(()=>validateRuntimeConfig()).toThrow(/Sandbox|sandbox/);await expect(provider.createShiprocketOrder({})).rejects.toThrow();expect(post).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
});
test.each(['https://apiv2.shiprocket.in','https://apiv2.shiprocket.in:8443','https://apiv2.shiprocket.in.','https://apidocs-test.shiprocket.in','https://apidocs.shiprocket.in','http://isolated-provider.invalid','https://isolated-provider.invalid/path'])('sandbox rejects unsafe endpoint %s',async url=>{
  process.env.SHIPROCKET_SANDBOX_BASE_URL=url;await expect(getShiprocketToken()).rejects.toThrow();expect(post).not.toHaveBeenCalled();
});
test('production rejects local sandbox settings without isolated staging authorization',()=>{
  expect(()=>validateRuntimeConfig({...process.env,NODE_ENV:'production',OTP_MODE:'live',RAZORPAY_MODE:'live',FCM_MODE:'live',MAPS_MODE:'live',PAYMENT_GATEWAY:'razorpay'})).toThrow(/non-live integrations/);
});
test('mock mode performs no HTTP calls through any provider operation',async()=>{
  process.env.SHIPROCKET_MODE='mock';await getShiprocketToken();await provider.listPickupLocations();await provider.addPickupLocation({pickup_location:'fixture'});await provider.verifyPickupLocation('fixture',{});await provider.checkServiceability({});await provider.createShiprocketOrder({order_id:'fixture'});await provider.assignCourier('fixture');await provider.generateLabel('fixture');await provider.schedulePickup('fixture');await provider.trackShipment('fixture');expect(post).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
});
test('auth is cached for nine days, expires and reauthenticates; environment changes cannot reuse the token',async()=>{
  let now=1000000000000;jest.spyOn(Date,'now').mockImplementation(()=>now);
  await getShiprocketToken();await getShiprocketToken();expect(post).toHaveBeenCalledTimes(1);
  now+=9*24*60*60*1000+1;await getShiprocketToken();expect(post).toHaveBeenCalledTimes(2);
  process.env.SHIPROCKET_SANDBOX_EMAIL='another@example.invalid';await getShiprocketToken();expect(post).toHaveBeenCalledTimes(3);
});
test('authentication failure sanitizes logs and never exposes provider data or credentials',async()=>{
  const log=jest.spyOn(console,'error').mockImplementation(()=>{});post.mockRejectedValue({response:{status:401,data:{password:'secret-leak'}}});await expect(getShiprocketToken()).rejects.toThrow('Shiprocket Auth Failed');expect(JSON.stringify(log.mock.calls)).not.toContain('secret-leak');
});
test('serviceability, shipment, AWB, label, pickup and tracking use only the configured isolated origin',async()=>{
  post.mockImplementation(async url=>({data:url.endsWith('/auth/login')?{token:'isolated-token'}:url.endsWith('/orders/create/adhoc')?{order_id:101,shipment_id:102}:url.endsWith('/courier/assign/awb')?{response:{data:{awb_code:'TEST-AWB',courier_name:'Fixture courier'}}}:url.endsWith('/label')?{label_url:'https://example.invalid/label'}:{pickup_status:1}}));
  get.mockImplementation(async url=>({data:url.includes('serviceability')?{data:{available_courier_companies:[{courier_company_id:1,rate:50}]}}:url.includes('/pickup')?{data:{shipping_address:[{pickup_location:'store',address:'Real fixture store',pin_code:'400001',status:2,phone_verified:1}]}}:{tracking_data:{shipment_status:6}}}));
  expect((await provider.checkServiceability({pickupPostcode:'400001',deliveryPostcode:'400002',weight:1,cod:true})).available).toBe(true);
  expect((await provider.verifyPickupLocation('store',{address:'Real fixture store',pincode:'400001'})).verificationMode).toBe('provider');expect(await provider.verifyPickupLocation('absent',{})).toBeNull();
  expect((await provider.createShiprocketOrder({order_id:'fixture'})).shipment_id).toBe(102);expect((await provider.assignCourier(102,1)).awb).toBe('TEST-AWB');expect((await provider.generateLabel(102)).label_url).toContain('example.invalid');expect((await provider.schedulePickup(102)).pickup_status).toBe(1);expect((await provider.trackShipment('TEST-AWB')).tracking_data.shipment_status).toBe(6);
  for(const [url,,options] of post.mock.calls){expect(url).toMatch(/^https:\/\/isolated-provider\.invalid\//);expect(options.maxRedirects).toBe(0);expect(options.timeout).toBe(15000);}
  for(const [url,options] of get.mock.calls){expect(url).toMatch(/^https:\/\/isolated-provider\.invalid\//);expect(options.maxRedirects).toBe(0);expect(options.timeout).toBe(15000);}
});
test.each([429,500,503])('provider %s and timeout errors propagate without automatic mutation retries',async status=>{
  get.mockRejectedValue({response:{status}});await expect(provider.checkServiceability({})).rejects.toMatchObject({response:{status}});
  post.mockImplementation(async url=>{if(url.endsWith('/auth/login'))return {data:{token:'fixture'}};throw {code:'ECONNABORTED',response:{status}};});jest.spyOn(console,'error').mockImplementation(()=>{});await expect(provider.createShiprocketOrder({})).rejects.toThrow('Failed to create order');expect(post.mock.calls.filter(([url])=>url.endsWith('/orders/create/adhoc'))).toHaveLength(1);
});
test('missing mode cannot infer live from existing credentials',async()=>{
  delete process.env.SHIPROCKET_MODE;await expect(getShiprocketToken()).rejects.toThrow(/explicitly/);expect(post).not.toHaveBeenCalled();
});
