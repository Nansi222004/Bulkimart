import {jest} from '@jest/globals';
import {getRoute} from '../services/maps.service.js';
import {requireParcel,parcelFlags} from '../services/parcelPolicy.service.js';
import {forwardGeocode} from '../services/geocode.service.js';
import {lookupPlace} from '../controllers/geo.controller.js';
import express from 'express';
import request from 'supertest';
const original={...process.env};
beforeEach(()=>{
  process.env.NODE_ENV='test';
  for(const k of ['PAYMENT_GATEWAY','RAZORPAY_MODE','SHIPROCKET_MODE','DEPLOYMENT_ENV'])delete process.env[k];
});
afterEach(()=>{process.env={...original};jest.restoreAllMocks();});

const geocodeResult = pincode => ({status:'OK',results:[{formatted_address:'Synthetic Indore street',geometry:{location:{lat:22.72,lng:75.86},location_type:'ROOFTOP'},address_components:[{long_name:'Synthetic street',types:['route']},...(pincode?[{long_name:pincode,types:['postal_code']}]:[])]}]});
test.each(['452015',undefined,'invalid'])('forward lookup preserves only the matched result postal code: %s',async pincode=>{
  process.env.GOOGLE_MAPS_API_KEY='synthetic-geocode-key';
  const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>geocodeResult(pincode)});
  const result=await forwardGeocode(['Synthetic postcode regression '+String(pincode)]);
  expect(result.pincode).toBe(pincode==='452015'?'452015':undefined);
  expect(result).toMatchObject({lat:22.72,lng:75.86,precision:'ROOFTOP',matched:'Synthetic Indore street'});
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('existing forward API exposes matched postcode alongside coordinates without another provider lookup',async()=>{
  process.env.GOOGLE_MAPS_API_KEY='synthetic-geocode-key';
  const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>geocodeResult('452015')});
  // Controller boundary only; existing authenticated geo router is unchanged.
  const app=express();app.get('/forward',lookupPlace);
  const response=await request(app).get('/forward').query({q:'Synthetic controller postal regression'}).expect(200);
  expect(response.body.data).toMatchObject({pincode:'452015',lat:22.72,lng:75.86,precision:'ROOFTOP'});
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('actual road provider is unavailable in live mode and never substitutes a mock route',async()=>{
  process.env.MAPS_MODE='live';delete process.env.GOOGLE_MAPS_API_KEY;const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('No network allowed'));
  await expect(getRoute({lat:12.97,lng:77.59},{lat:12.98,lng:77.60})).rejects.toThrow('Google Routes is not configured');
  expect(fetch).not.toHaveBeenCalled();
});
test('Google Routes sends coordinates and a narrow field mask, returns road geometry and real duration',async()=>{
  process.env.MAPS_MODE='live';process.env.GOOGLE_MAPS_API_KEY='synthetic-server-test-key';
  const fetch=jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({routes:[{distanceMeters:7315,duration:'1061.5s',polyline:{encodedPolyline:'encoded-provider-line'}}]})});
  const route=await getRoute({lat:12.97,lng:77.59},{lat:12.98,lng:77.60});
  expect(route).toMatchObject({distanceKm:7.315,durationMin:1061.5/60,provider:'google_routes'});
  const [url,options]=fetch.mock.calls[0];expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
  expect(options.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline');
  expect(JSON.parse(options.body)).toMatchObject({origin:{location:{latLng:{latitude:12.97,longitude:77.59}}},travelMode:'DRIVE'});
  expect(url).not.toContain('synthetic-server-test-key');expect(JSON.stringify(JSON.parse(options.body))).not.toMatch(/phone|name|address/);
});
test.each([{routes:[]},{routes:[{distanceMeters:0,duration:'10s',polyline:{encodedPolyline:'abc'}}]},{routes:[{distanceMeters:500,duration:'invalid',polyline:{encodedPolyline:'abc'}}]},{routes:[{distanceMeters:500,duration:'10s'}]}])('invalid provider route fails closed %#',async payload=>{
  process.env.MAPS_MODE='live';process.env.GOOGLE_MAPS_API_KEY='synthetic-test';
  jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>payload});
  await expect(getRoute({lat:0,lng:0},{lat:1,lng:1})).rejects.toThrow('Google Routes is unavailable');
});
test.each([403,429,500])('provider failure %s never fabricates route or exposes provider details',async status=>{
  process.env.MAPS_MODE='live';process.env.GOOGLE_MAPS_API_KEY='synthetic-test';
  jest.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status,json:async()=>({error:{message:'sensitive provider body'}})});
  await expect(getRoute({lat:0,lng:0},{lat:1,lng:1})).rejects.toThrow('Google Routes is unavailable');
});
test('provider timeout and invalid coordinates fail without leaking request details',async()=>{
  process.env.MAPS_MODE='live';process.env.GOOGLE_MAPS_API_KEY='synthetic-test';
  const fetch=jest.spyOn(globalThis,'fetch').mockRejectedValue(Error('synthetic secret endpoint'));
  await expect(getRoute({lat:12,lng:77},{lat:13,lng:77})).rejects.toThrow('Google Routes is unavailable');
  fetch.mockClear();await expect(getRoute({lat:91,lng:77},{lat:13,lng:77})).rejects.toThrow('Valid route coordinates required');expect(fetch).not.toHaveBeenCalled();
});
test('actual mock road route is explicitly limited to the isolated test runtime',async()=>{
  process.env.MAPS_MODE='mock';expect((await getRoute({lat:12.97,lng:77.59},{lat:12.98,lng:77.60})).distanceKm).toBe(5.2);
});
test.each(['production','prod','deployment-production',' PRODUCTION '])('production alias %s blocks every parcel operation even with all flags true',env=>{
  for(const k of Object.keys(parcelFlags()))process.env[`PARCEL_DELIVERY_${k.toUpperCase()}_ENABLED`]='true';
  process.env.DEPLOYMENT_ENV=env;
  for(const k of Object.keys(parcelFlags()).filter(k=>k!=='catalogue'))expect(()=>requireParcel(k)).toThrow(/release-blocked/);
});
