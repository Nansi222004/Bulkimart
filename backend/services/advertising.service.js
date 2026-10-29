import SellerPromotion from '../models/SellerPromotion.js';
import PromotionPackage from '../models/PromotionPackage.js';
import Category from '../models/Category.js';
import { financialTransaction } from './financeSafety.service.js';
import { advertisingId, advertisingChannel, validateAdvertisingSelection } from './advertisingEligibility.service.js';
import { httpError } from '../utils/response.js';
import { advertisingPilotCapabilities } from './advertisingPolicy.service.js';
import { validateAdBillingPolicy, adCharge } from './advertisingBillingPolicy.service.js';
import { notifyAdvertisingChange } from './advertisingNotifications.service.js';

export const advertisingVersion = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw httpError(400, 'A current integer version is required');
  return value;
};
export const advertisingBillingAuthorized = a => Boolean(a?.review === 'APPROVED' && a.approvedRevision === a.revision
  && a.paid?.authorizedBy && a.paid.revision === a.revision);
const text = (value, label, max = 200, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw httpError(400, `${label} is required (maximum ${max} characters)`);
  return value.trim();
};
const fields = (input, allowed) => {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k))) throw httpError(400, 'Unsupported advertising fields');
};
export const campaignDTO = row => {
  const r = row.toObject ? row.toObject() : row;
  return { id: r._id, name: r.title, module: r.module, version: r.__v,
    packageId: r.packageId, createdAt: r.createdAt, updatedAt: r.updatedAt,
    ...r.advertising, pilot: r.advertising.pilot ? { enabled: r.advertising.pilot.enabled, revision: r.advertising.pilot.revision,
      startAt: r.advertising.pilot.startAt, endAt: r.advertising.pilot.endAt, billable: false } : undefined,
    paid: r.advertising.paid ? {paymentId:r.advertising.paid.paymentId,revision:r.advertising.paid.revision,startAt:r.advertising.paid.startAt,endAt:r.advertising.paid.endAt,
      invoiceReference:r.advertising.paid.invoiceReference,authorized:advertisingBillingAuthorized(r.advertising)} : undefined,
    history: (r.advertising.history || []).map(({ actorId, ...event }) => event) };
};
export const packageDTO = row => ({ id: row._id, name: row.name, module: row.module,
  placement: row.placement, durationDays: row.durationDays, maxProducts: row.maxProducts,
  isActive: row.isActive, version: row.advertising.version,
  amountPaise: row.advertising.amountPaise, currency: 'INR', billingMode: 'FIXED_DURATION',
  categories: row.advertising.categories, refundPolicyReference: row.advertising.refundPolicyReference,
  pausePolicyReference: row.advertising.pausePolicyReference, taxPolicyReference: row.advertising.taxPolicyReference,
  description: row.advertising.description, archivedAt: row.advertising.archivedAt,
  policies: row.advertising.policies,
  ...(row.advertising.policies?.billing?{billingQuote:adCharge({amountPaise:row.advertising.amountPaise,currency:'INR',policies:row.advertising.policies})}:{}),
  policyApproval: row.advertising.policies?.billing?'CONFIGURED_REQUIRES_CAMPAIGN_AUTHORIZATION':'PENDING', purchasable: false });
const setCampaignFields = (campaign, input) => {
  fields(input, ['name', 'module', 'categoryId', 'items', 'packageId', 'requestedStartAt', 'version']);
  const a = campaign.advertising;
  if (input.module !== undefined && input.module !== campaign.module) throw httpError(400, 'Campaign module cannot change');
  if (input.name !== undefined) campaign.title = text(input.name, 'Campaign name');
  if (input.categoryId !== undefined) a.categoryId = advertisingId(input.categoryId);
  if (input.packageId !== undefined) campaign.packageId = advertisingId(input.packageId);
  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length > 20) throw httpError(400, 'Select at most 20 products');
    a.items = input.items.map(item => {
      fields(item, ['productId', 'variantId']);
      return { productId: advertisingId(item.productId), ...(item.variantId ? { variantId: advertisingId(item.variantId) } : {}) };
    });
    campaign.selectedProducts = a.items.map(i => i.productId);
  }
  if (input.requestedStartAt !== undefined) {
    if (typeof input.requestedStartAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(input.requestedStartAt)) throw httpError(400, 'Start date must include a timezone');
    const date = new Date(input.requestedStartAt);
    if (!Number.isFinite(date.getTime())) throw httpError(400, 'Invalid start date');
    a.requestedStartAt = date;
  }
};
const audit = (row, action, actorId, actorType, reason = '') => {
  if (row.advertising.history.length >= 500) throw httpError(409, 'Campaign history limit reached; create a new campaign');
  row.advertising.history.push({ action, actorId, actorType, reason, at: new Date(),
    revision: row.advertising.revision, review: row.advertising.review, delivery: row.advertising.delivery });
};
const editable = row => {
  if (!['DRAFT', 'CHANGES_REQUESTED'].includes(row.advertising.review) || row.advertising.funding !== 'UNPAID' || row.advertising.delivery !== 'NOT_SCHEDULED') throw httpError(409, 'Campaign cannot be edited in its current state');
};
export async function createAdvertisingCampaign(sellerId, actorId, input) {
  fields(input, ['name', 'module', 'categoryId', 'items', 'packageId', 'requestedStartAt', 'version']);
  advertisingChannel(input.module);
  const row = new SellerPromotion({ advertisingVersion: 2, sellerId, module: input.module,
    title: text(input.name, 'Campaign name'), status: 'DISABLED', advertising: {
      revision: 1, review: 'DRAFT', funding: 'UNPAID', delivery: 'NOT_SCHEDULED',
      placement: 'CATEGORY_SPONSORED', items: [], history: [],
    } });
  setCampaignFields(row, input); audit(row, 'create', actorId, 'seller');
  return financialTransaction(async session => {
    if (row.advertising.items.length) await validateAdvertisingSelection(row, session);
    await row.save({ session }); return campaignDTO(row);
  });
}
export async function advertisingCampaign(id, sellerId, session = null) {
  const row = await SellerPromotion.findOne({ _id: advertisingId(id), advertisingVersion: 2,
    ...(sellerId ? { sellerId } : {}) }).session(session);
  if (!row?.advertising) throw httpError(404, 'Advertising campaign not found');
  return row;
}
async function commercialTerms(row, session) {
  const a = row.advertising;
  const p = row.packageId && await PromotionPackage.findOne({ _id: row.packageId, advertisingVersion: 2, isActive: true, module: row.module, placement: a.placement }).session(session);
  if (!p?.advertising || p.advertising.archivedAt) throw httpError(409, 'Select a current enabled advertising package');
  if (a.items.length > p.maxProducts) throw httpError(400, 'Package product limit exceeded');
  if (p.advertising.categories.length && !p.advertising.categories.some(id => String(id) === String(a.categoryId))) throw httpError(400, 'Package does not support this category');
  return { packageId: p._id, packageVersion: p.advertising.version, name: p.name,
    amountPaise: p.advertising.amountPaise, durationDays: p.durationDays,
    maxProducts: p.maxProducts, currency: 'INR', billingMode: 'FIXED_DURATION',
    refundPolicyReference: p.advertising.refundPolicyReference, pausePolicyReference: p.advertising.pausePolicyReference,
    taxPolicyReference: p.advertising.taxPolicyReference, placement: p.placement, module: p.module,
    description: p.advertising.description, policies: p.advertising.policies?.toObject() };
}
export async function changeAdvertisingCampaign({ id, sellerId, actorId, admin = false, input, action }) {
  if (!input || typeof input !== 'object') throw httpError(400, 'Advertising payload is required');
  const updated = await financialTransaction(async session => {
    const row = await advertisingCampaign(id, sellerId, session);
    const version = advertisingVersion(input.version);
    if (row.__v !== version) throw httpError(409, 'Campaign changed; refresh before continuing');
    const a = row.advertising;
    if (action === 'edit') {
      editable(row); setCampaignFields(row, input); a.revision += 1;
      a.review = 'DRAFT'; a.terms = undefined; a.approvedRevision = undefined; a.pilot = undefined; a.paid = undefined;
      if (a.items.length) await validateAdvertisingSelection(row, session);
    } else {
      fields(input, action === 'submit' ? ['version', 'packageVersion'] : action === 'pilot' ? ['version', 'reason', 'enabled', 'startAt', 'endAt'] : ['version', 'reason']);
      if (action === 'submit') {
        editable(row); text(row.title, 'Campaign name');
        if (!a.requestedStartAt || a.requestedStartAt <= new Date()) throw httpError(400, 'Choose a future requested start date');
        await validateAdvertisingSelection(row, session);
        const terms = await commercialTerms(row, session);
        if (input.packageVersion !== terms.packageVersion) throw httpError(409, 'Package changed; review and confirm its current version before submitting');
        a.terms = terms; a.review = 'PENDING_REVIEW';
      } else if (admin && ['approve', 'request-changes', 'reject'].includes(action)) {
        if (a.review !== 'PENDING_REVIEW' || a.funding !== 'UNPAID' || a.delivery !== 'NOT_SCHEDULED') throw httpError(409, 'Campaign is not awaiting review');
        text(input.reason, 'Decision reason', 2000);
        if (action === 'approve') {
          await validateAdvertisingSelection(row, session);
          // Review the seller-accepted snapshot, never today's package price.
          if (!a.terms?.packageVersion) throw httpError(409, 'A submitted commercial snapshot is required');
          if (a.requestedStartAt <= new Date()) throw httpError(409, 'Schedule has passed; request changes');
          a.review = 'APPROVED'; a.approvedRevision = a.revision;
          // Approval opens payment: the seller already accepted the package's billing rules. Only a
          // package that needs an external invoice number still waits for finance to authorize it.
          a.paid = undefined;
          let charge = null;
          try { charge = adCharge(a.terms); } catch (error) {
            // Legacy or incomplete snapshots stay blocked until their billing terms are reviewed.
            if (![400, 409].includes(error.status)) throw error;
          }
          if (charge && charge.policy.invoiceMode !== 'EXTERNAL_REFERENCE') a.paid = { revision: a.revision, authorizedBy: actorId, authorizedAt: new Date() };
        } else a.review = action === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED';
      } else if (admin && action === 'pilot') {
        text(input.reason, 'Pilot authorization reason', 2000);
        if (typeof input.enabled !== 'boolean') throw httpError(400, 'Explicit pilot enable state required');
        if (input.enabled) {
          if (!advertisingPilotCapabilities().pilotEnabled) throw httpError(503, 'Non-billable category pilot is disabled in this environment');
          if (a.review !== 'APPROVED' || a.approvedRevision !== a.revision || a.funding !== 'UNPAID' || a.delivery !== 'NOT_SCHEDULED') throw httpError(409, 'Pilot requires the current approved unpaid revision with no paid delivery');
          for (const key of ['startAt', 'endAt']) if (typeof input[key] !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(input[key])) throw httpError(400, 'Pilot dates must include a timezone');
          const startAt = new Date(input.startAt), endAt = new Date(input.endAt);
          if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt || endAt <= new Date()
            || !Number.isSafeInteger(a.terms?.durationDays) || endAt - startAt > a.terms.durationDays * 86400000) throw httpError(400, 'Invalid pilot schedule or package duration exceeded');
          await validateAdvertisingSelection(row, session);
          a.pilot = { enabled: true, revision: a.revision, startAt, endAt, authorizedBy: actorId, authorizedAt: new Date() };
        } else {
          if (!a.pilot) throw httpError(409, 'No pilot authorization exists');
          a.pilot.enabled = false;
        }
      } else if (admin && action === 'suspend') {
        text(input.reason, 'Suspension reason', 2000);
        if (['CANCELLED', 'COMPLETED', 'ADMIN_SUSPENDED'].includes(a.delivery)) throw httpError(409, 'Campaign cannot be suspended');
        a.delivery = 'ADMIN_SUSPENDED';
        if (a.pilot) a.pilot.enabled = false;
      } else if (!admin && action === 'cancel') {
        if (a.funding !== 'UNPAID' || a.delivery !== 'NOT_SCHEDULED') throw httpError(409, 'Cancellation requires a financial policy review');
        a.delivery = 'CANCELLED';
        if (a.pilot) a.pilot.enabled = false;
      } else throw httpError(400, 'Unsupported campaign action');
    }
    audit(row, action, actorId, admin ? 'admin' : 'seller', input.reason ? text(input.reason, 'Reason', 2000) : '');
    const updated = await SellerPromotion.findOneAndUpdate({ _id: row._id, advertisingVersion: 2, __v: version }, {
      $set: { title: row.title, selectedProducts: row.selectedProducts, packageId: row.packageId, advertising: a.toObject() }, $inc: { __v: 1 },
    }, { session, returnDocument: 'after', runValidators: true });
    if (!updated) throw httpError(409, 'Campaign changed; refresh before continuing');
    return updated;
  });
  await notifyAdvertisingChange(updated, action);
  return campaignDTO(updated);
}

export async function requestAdvertisingPayment(id, input) {
  fields(input, ['version']);
  const row = await advertisingCampaign(id);
  if (row.__v !== advertisingVersion(input.version)) throw httpError(409, 'Campaign changed; refresh before continuing');
  if (!advertisingBillingAuthorized(row.advertising) || !['UNPAID', 'PAYMENT_FAILED'].includes(row.advertising.funding)
    || row.advertising.delivery !== 'NOT_SCHEDULED' || row.advertising.pilot?.enabled) throw httpError(409, 'Payment is not available for this campaign');
  await notifyAdvertisingChange(row, 'request-payment');
  return campaignDTO(row);
}
export function advertisingPagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw httpError(400, 'Invalid pagination');
  return { page, limit, skip: (page - 1) * limit };
}
export async function listAdvertisingCampaigns(sellerId, query) {
  const { page, limit, skip } = advertisingPagination(query);
  const filter = { advertisingVersion: 2, ...(sellerId ? { sellerId } : {}) };
  for (const key of ['review', 'funding', 'delivery']) if (query[key] !== undefined) {
    if (typeof query[key] !== 'string' || !SellerPromotion.schema.path(`advertising.${key}`).enumValues.includes(query[key])) throw httpError(400, 'Invalid campaign filter');
    filter[`advertising.${key}`] = query[key];
  }
  const [rows, total] = await Promise.all([SellerPromotion.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit), SellerPromotion.countDocuments(filter)]);
  return { rows: rows.map(campaignDTO), page, limit, total };
}
const parsePolicies = input => {
  if (input === undefined) return undefined;
  fields(input, ['sellerPause', 'cancellation', 'rejection', 'suspension', 'unusedService', 'refunds', 'tax', 'attribution', 'billing']);
  const result = {};
  if (input.billing !== undefined) result.billing = validateAdBillingPolicy(input.billing);
  for (const key of ['sellerPause', 'cancellation', 'rejection', 'suspension', 'unusedService', 'refunds']) if (input[key] !== undefined && input[key] !== '') result[key] = text(input[key], key, 2000);
  if (input.tax !== undefined) {
    fields(input.tax, ['treatment', 'invoiceIssuer', 'calculation', 'creditNotes']); result.tax = {};
    for (const [key, value] of Object.entries(input.tax)) if (value) result.tax[key] = text(value, key, 2000);
  }
  if (input.attribution !== undefined) {
    fields(input.attribution, ['windowHours', 'conversionEvent', 'model']);
    const a = input.attribution;
    if (!Number.isSafeInteger(a.windowHours) || a.windowHours < 1 || a.windowHours > 8760 || !['PAID', 'DELIVERED'].includes(a.conversionEvent) || !['LAST_CLICK', 'FIRST_CLICK'].includes(a.model)) throw httpError(400, 'Invalid attribution policy');
    result.attribution = a;
  }
  return result;
};
export async function saveAdvertisingPackage(actorId, input, id) {
  fields(input, ['name', 'description', 'module', 'placement', 'archived', 'policies', 'durationDays', 'maxProducts', 'amountPaise', 'categories', 'isActive', 'version', 'reason', 'refundPolicyReference', 'pausePolicyReference', 'taxPolicyReference']);
  advertisingChannel(input.module);
  const name = text(input.name, 'Package name'), reason = text(input.reason, 'Configuration reason', 2000);
  for (const [key, max] of [['durationDays', 365], ['maxProducts', 20], ['amountPaise', 100000000]]) if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > max) throw httpError(400, `Invalid ${key}`);
  if (typeof input.isActive !== 'boolean' || !Array.isArray(input.categories) || input.categories.length > 100) throw httpError(400, 'Specify active state and at most 100 categories');
  const categories = input.categories.map(advertisingId);
  if (new Set(categories.map(String)).size !== categories.length || await Category.countDocuments({ _id: { $in: categories }, type: advertisingChannel(input.module), isActive: true }) !== categories.length) throw httpError(400, 'Package categories must be active and belong to the selected module');
  const policies = parsePolicies(input.policies);
  const placement = input.placement || 'CATEGORY_SPONSORED';
  if (placement !== 'CATEGORY_SPONSORED') throw httpError(400, 'This placement is not implemented or enabled');
  if (input.archived !== undefined && typeof input.archived !== 'boolean') throw httpError(400, 'Invalid archive state');
  const description = input.description ? text(input.description, 'Description', 2000) : '';
  if (input.archived && input.isActive) throw httpError(400, 'Archived packages cannot be active');
  const policy = Object.fromEntries(['refundPolicyReference', 'pausePolicyReference', 'taxPolicyReference'].map(k => [k, input[k] === undefined || input[k] === '' ? '' : text(input[k], k, 200)]));
  if (!id) {
    const row = await PromotionPackage.create({ advertisingVersion: 2, name, module: input.module,
      durationDays: input.durationDays, price: input.amountPaise / 100, maxProducts: input.maxProducts,
      placement: 'CATEGORY_SPONSORED', isActive: input.isActive, advertising: {
        version: 1, amountPaise: input.amountPaise, billingMode: 'FIXED_DURATION', categories, ...policy,
        description, policies, ...(input.archived ? { archivedAt: new Date() } : {}),
        history: [{ version: 1, actorId, reason, at: new Date() }],
      } });
    return packageDTO(row);
  }
  const version = advertisingVersion(input.version);
  const row = await PromotionPackage.findOneAndUpdate({ _id: advertisingId(id), advertisingVersion: 2, 'advertising.version': version, 'advertising.archivedAt': null }, {
    $set: { name, module: input.module, durationDays: input.durationDays, price: input.amountPaise / 100,
      maxProducts: input.maxProducts, isActive: input.isActive, 'advertising.amountPaise': input.amountPaise,
      'advertising.description': description, 'advertising.policies': policies || {},
      ...(input.archived ? { 'advertising.archivedAt': new Date() } : {}),
      'advertising.categories': categories, ...Object.fromEntries(Object.entries(policy).map(([k,v]) => [`advertising.${k}`, v])) },
    $inc: { 'advertising.version': 1, __v: 1 },
    $push: { 'advertising.history': { version: version + 1, actorId, reason, at: new Date() } },
  }, { returnDocument: 'after', runValidators: true });
  if (!row) throw httpError(409, 'Package changed or unavailable; refresh before continuing');
  return packageDTO(row);
}
