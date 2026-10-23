import crypto from 'node:crypto';
import AdEvent from '../models/AdEvent.js';
import Promotion from '../models/SellerPromotion.js';
import { advertisingPilotCapabilities } from './advertisingPolicy.service.js';
import { validateAdvertisingSelection } from './advertisingEligibility.service.js';
import { httpError } from '../utils/response.js';
export function advertisingTelemetryConfig() {
  const retentionDays=Number(process.env.ADVERTISING_EVENT_RETENTION_DAYS);
  return {enabled:process.env.ADVERTISING_MANAGEMENT_ENABLED==='true'&&process.env.ADVERTISING_TELEMETRY_ENABLED==='true'
    &&typeof process.env.ADVERTISING_TOKEN_SECRET==='string'&&process.env.ADVERTISING_TOKEN_SECRET.length>=32
    &&Number.isSafeInteger(retentionDays)&&retentionDays>=1&&retentionDays<=365,
  retentionDays,viewabilityRatio:0.5,viewabilityMs:1000};
}
const sign=value=>crypto.createHmac('sha256',process.env.ADVERTISING_TOKEN_SECRET).update(value).digest('base64url');
export function advertisingServeToken(campaign,item,mode,endAt) {
  if(!advertisingTelemetryConfig().enabled)return undefined;
  const payload=Buffer.from(JSON.stringify({c:String(campaign._id),r:campaign.advertising.revision,p:String(item.productId),
    v:item.variantId?String(item.variantId):null,m:mode,placement:'CATEGORY_SPONSORED',
    exp:Math.min(Date.now()+120000,new Date(endAt).getTime()),n:crypto.randomBytes(18).toString('base64url')})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export async function recordAdvertisingEvent(input) {
  const config=advertisingTelemetryConfig();if(!config.enabled)throw httpError(503,'Advertising telemetry is disabled or unconfigured');
  if(!input||Object.keys(input).some(k=>!['token','type'].includes(k))||!['IMPRESSION','CLICK'].includes(input.type)||typeof input.token!=='string'||input.token.length>2048)throw httpError(400,'Invalid advertising event');
  const [payload,signature,...extra]=input.token.split('.');
  const expected=payload?sign(payload):'';
  if(extra.length||!signature||!/^[A-Za-z0-9_-]{43}$/.test(signature)||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw httpError(401,'Invalid serving token');
  let token;try{token=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw httpError(400,'Invalid serving token');}
  if(!/^[a-f\d]{24}$/.test(token.c)||!/^[a-f\d]{24}$/.test(token.p)||token.placement!=='CATEGORY_SPONSORED'||!Number.isFinite(token.exp)||token.exp<=Date.now()||token.exp>Date.now()+120000||typeof token.n!=='string')throw httpError(400,'Expired or invalid serving token');
  const c=await Promotion.findOne({_id:token.c,advertisingVersion:2,status:'DISABLED'}).lean();
  const a=c?.advertising;
  if(!a||a.review!=='APPROVED'||a.revision!==token.r||a.approvedRevision!==token.r||!a.items.some(i=>String(i.productId)===token.p&&String(i.variantId||'')===String(token.v||'')))throw httpError(409,'Campaign or product revision is no longer eligible');
  if(token.m==='NON_BILLABLE_PILOT'){
    if(!advertisingPilotCapabilities().pilotEnabled||!a.pilot?.enabled||!a.pilot.authorizedBy||!a.pilot.authorizedAt||a.pilot.revision!==token.r||a.funding!=='UNPAID'||a.delivery!=='NOT_SCHEDULED'||a.pilot.startAt>new Date()||a.pilot.endAt<=new Date()||a.pilot.endAt-a.pilot.startAt>a.terms.durationDays*86400000)throw httpError(409,'Pilot is no longer eligible');
  }else if(token.m==='PAID_CATEGORY'){
    const {paidAdvertisingEligible}=await import('./advertisingPaidEligibility.service.js');
    if(!await paidAdvertisingEligible(c))throw httpError(409,'Paid campaign is no longer eligible');
  }else throw httpError(400,'Unsupported event mode');
  await validateAdvertisingSelection(c,null);
  const eventId=crypto.createHash('sha256').update(`${token.n}:${input.type}`).digest('hex');
  try{await AdEvent.create({_id:eventId,campaignId:c._id,revision:token.r,productId:token.p,placement:token.placement,mode:token.m,type:input.type,
    at:new Date(),expiresAt:new Date(Date.now()+config.retentionDays*86400000)});return {accepted:true,duplicate:false};}
  catch(error){if(error.code===11000)return {accepted:true,duplicate:true};throw error;}
}
export async function advertisingEventSummary(campaignId,from,to) {
  const start=from===undefined?new Date(Date.now()-30*86400000):new Date(from),end=to===undefined?new Date():new Date(to);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end||end-start>366*86400000)throw httpError(400,'Invalid reporting range (maximum 366 days)');
  const rows=await AdEvent.aggregate([{$match:{campaignId,at:{$gte:start,$lte:end},expiresAt:{$gt:new Date()}}},{$group:{_id:{mode:'$mode',type:'$type'},count:{$sum:1}}}]);
  return {from:start,to:end,retentionDays:advertisingTelemetryConfig().retentionDays||null,
    rows:rows.map(r=>({mode:r._id.mode,type:r._id.type,count:r.count})),
    note:'Client-reported viewability, signed serving linkage and deduplicated submissions; not verified human reach. Counts are limited by retention. No conversions or ROAS.'};
}
