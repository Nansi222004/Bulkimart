import SellerPromotion from '../models/SellerPromotion.js';
import Category from '../models/Category.js';
import { advertisingPilotCapabilities } from './advertisingPolicy.service.js';
import { advertisingId, validateAdvertisingSelection } from './advertisingEligibility.service.js';
import { isWithinRadius } from './radius.service.js';
import { resolveInventoryItem } from './inventory.service.js';
import { publicProduct } from '../utils/publicProduct.js';
import { httpError } from '../utils/response.js';
import { paidAdvertisingEnabled, paidAdvertisingEligible } from './advertisingPaidEligibility.service.js';
import { advertisingServeToken } from './advertisingTelemetry.service.js';

export function placementContext(query) {
  if (!['ecommerce', 'grocery'].includes(query.type)) throw httpError(400, 'Select a retail channel');
  const categoryId = advertisingId(query.category);
  if (query.exclude !== undefined && (typeof query.exclude !== 'string' || query.exclude.length > 5000)) throw httpError(400, 'Invalid exclusions');
  const exclude = query.exclude ? query.exclude.split(',') : [];
  if (exclude.length > 200) throw httpError(400, 'Too many exclusions');
  exclude.forEach(advertisingId);
  let destination;
  if (query.lat !== undefined || query.lng !== undefined) {
    if (typeof query.lat !== 'string' || typeof query.lng !== 'string' || !query.lat.trim() || !query.lng.trim()) throw httpError(400, 'Coordinates must be supplied together');
    const lat = Number(query.lat), lng = Number(query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) throw httpError(400, 'Invalid coordinates');
    destination = { lat, lng };
  }
  return { type: query.type, categoryId, exclude: new Set(exclude.map(value => String(advertisingId(value)))), destination };
}
async function categoryBranch(categoryId, type) {
  const categories = await Category.find({ type }).select('_id parent isActive').limit(2001).lean().maxTimeMS(1500);
  if (categories.length > 2000) throw httpError(503, 'Category pilot capacity exceeded');
  const byId = new Map(categories.map(c => [String(c._id), c]));
  const active = id => {
    const seen = new Set(); let node = byId.get(String(id));
    while (node) {
      const key = String(node._id);
      if (node.isActive === false || seen.has(key) || seen.size >= 20) return false;
      seen.add(key); if (!node.parent) return true; node = byId.get(String(node.parent));
    }
    return false;
  };
  if (!active(categoryId)) return new Set();
  const branch = new Set([String(categoryId)]);
  for (let depth = 0; depth < 20; depth++) {
    const size = branch.size;
    for (const c of categories) if (c.parent && branch.has(String(c.parent)) && active(c._id)) branch.add(String(c._id));
    if (branch.size === size) break;
  }
  return branch;
}
// Read-only. No impression records, payments, inventory repairs, or finance calls.
export async function sponsoredCategoryPlacements(query) {
  const pilotEnabled=advertisingPilotCapabilities().pilotEnabled,paidEnabled=paidAdvertisingEnabled();
  if (!pilotEnabled&&!paidEnabled) return [];
  const context = placementContext(query), now = new Date();
  const branch = await categoryBranch(context.categoryId, context.type);
  if (!branch.size) return [];
  const campaigns = await SellerPromotion.find({ advertisingVersion: 2, status: 'DISABLED',
    module: context.type === 'grocery' ? 'QUICK' : 'ECOMMERCE',
    'advertising.categoryId': { $in: [...branch] }, 'advertising.placement': 'CATEGORY_SPONSORED',
    'advertising.review': 'APPROVED',
    $or:[...(pilotEnabled?[{'advertising.funding':'UNPAID','advertising.delivery':'NOT_SCHEDULED','advertising.pilot.enabled':true,'advertising.pilot.startAt':{$lte:now},'advertising.pilot.endAt':{$gt:now},$expr:{$eq:['$advertising.revision','$advertising.pilot.revision']}}]:[]),
      ...(paidEnabled?[{'advertising.funding':'FUNDED','advertising.delivery':{$in:['SCHEDULED','ACTIVE']},'advertising.paid.startAt':{$lte:now},'advertising.paid.endAt':{$gt:now}}]:[])],
    $expr: { $eq: ['$advertising.revision', '$advertising.approvedRevision'] },
  }).sort({ _id: 1 }).limit(40).lean().maxTimeMS(1500);
  const selected = [], seen = new Set(context.exclude);
  for (const campaign of campaigns) {
    const a = campaign.advertising;
    const paid=a.funding==='FUNDED';
    if(paid&&!await paidAdvertisingEligible(campaign))continue;
    if(!paid&&(!a.pilot?.authorizedBy||!a.pilot.authorizedAt||a.pilot.endAt-a.pilot.startAt>a.terms?.durationDays*86400000))continue;
    if (!Number.isSafeInteger(a.revision) || a.revision < 1 || !a.terms || a.terms.placement !== 'CATEGORY_SPONSORED' || a.terms.module !== campaign.module
      || !Number.isSafeInteger(a.terms.durationDays)) continue;
    let eligible;
    try { eligible = await validateAdvertisingSelection(campaign, null); }
    catch (error) { if ([400, 409].includes(error.status)) continue; throw error; }
    if (!isWithinRadius(eligible.seller.storeDetails, context.destination, eligible.seller.serviceRadiusKm)) continue;
    for (const item of a.items) {
      if (seen.has(String(item.productId))) continue;
      const product = eligible.products.find(p => String(p._id) === String(item.productId));
      // Cart routing currently follows primary type; do not advertise cross-type
      // purchases in a different basket until that contract supports them.
      if (product.type !== context.type) continue;
      const inventory = resolveInventoryItem(product, item.variantId);
      if (inventory.stock < 1) continue;
      const safe = publicProduct({ ...product, price: inventory.price, mrp: inventory.mrp, stock: inventory.stock,
        sellerId: { _id: eligible.seller._id, businessName: eligible.seller.businessName,
          storeDetails: { name: eligible.seller.storeDetails?.name } } });
      const mode=paid?'PAID_CATEGORY':'NON_BILLABLE_PILOT',endAt=paid?a.paid.endAt:a.pilot.endAt;
      selected.push({ product: safe, variantId: inventory.variantId, disclosure: 'Sponsored', mode, expiresAt: endAt,
        serveToken:advertisingServeToken(campaign,item,mode,endAt) });
      seen.add(String(item.productId));
      if (selected.length === 4) return selected;
    }
  }
  return selected;
}
