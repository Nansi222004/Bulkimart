import express from 'express';
import rateLimit from 'express-rate-limit';
import PromotionPackage from '../models/PromotionPackage.js';
import Product from '../models/Product.js';
import { channelVisibility } from '../utils/productChannels.js';
import { advertisingChannel, advertisingId } from '../services/advertisingEligibility.service.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, httpError } from '../utils/response.js';
import { advertisingCapabilities, advertisingPermission, requireAdvertisingManagement, advertisingUnavailable } from '../services/advertisingPolicy.service.js';
import { advertisingCampaign, campaignDTO, createAdvertisingCampaign, changeAdvertisingCampaign, requestAdvertisingPayment, listAdvertisingCampaigns, campaignViews, packageDTO, saveAdvertisingPackage, advertisingPagination } from '../services/advertising.service.js';
import * as billing from '../services/advertisingBilling.service.js';
import { advertisingEventSummary, campaignRun } from '../services/advertisingTelemetry.service.js';

export function advertisingRouter(admin = false) {
  const router = express.Router();
  router.use(protect);
  if (admin) router.use(requireAdmin, advertisingPermission('advertising_review', 'advertising_configure', 'advertising_finance', 'advertising_reconcile','advertising_refund'));
  else router.use((req, _res, next) => {
    if (req.userType !== 'user' || !req.user.roles?.includes('seller') || (req.tokenRole !== undefined && req.tokenRole !== 'seller')) throw httpError(403, 'An authenticated seller portal session is required');
    next();
  }, requireApprovedSeller);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const mutationLimit=rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-7',legacyHeaders:false,
    message:{success:false,data:null,message:'Too many advertising changes',meta:{}}});
  router.use((req,res,next)=>req.method==='GET'?next():mutationLimit(req,res,next));
  router.get('/capabilities', (req, res) => ok(res, { ...advertisingCapabilities(), permissions: admin
    ? ['advertising_review', 'advertising_configure', 'advertising_finance', 'advertising_reconcile','advertising_refund'].filter(p => req.user.role === 'superAdmin' || req.user.permissions?.includes(p)) : [] }));
  // Financial evidence/reconciliation stays reachable after new sales are disabled.
  const financeRead=admin?[advertisingPermission('advertising_finance','advertising_reconcile','advertising_refund')]:[];
  router.get('/campaigns/:id/billing',...financeRead,asyncHandler(async(req,res)=>ok(res,await billing.advertisingBillingStatus(req.params.id,admin?undefined:req.seller._id))));
  router.get('/campaigns/:id/analytics',...(admin?[advertisingPermission('advertising_review')]:[]),asyncHandler(async(req,res)=>{
    const c=await advertisingCampaign(req.params.id,admin?undefined:req.seller._id);
    return ok(res,await advertisingEventSummary(c._id,req.query.from,req.query.to,campaignRun(c)));
  }));
  if(admin){
    router.post('/campaigns/:id/refund',advertisingPermission('advertising_refund'),asyncHandler(async(req,res)=>ok(res,await billing.requestAdvertisingRefund(req.params.id,req.user._id,req.body))));
    router.get('/finance',...financeRead,asyncHandler(async(req,res)=>ok(res,await billing.advertisingFinanceReport(req.query))));
    router.get('/reconciliation',advertisingPermission('advertising_reconcile'),asyncHandler(async(req,res)=>ok(res,await billing.advertisingFinanceReport(req.query))));
    router.post('/campaigns/:id/reconcile',advertisingPermission('advertising_reconcile'),asyncHandler(async(req,res)=>ok(res,await billing.reconcileAdvertisingPayment(req.params.id,req.user._id,req.body))));
    router.post('/campaigns/:id/refund-reconcile',advertisingPermission('advertising_reconcile'),asyncHandler(async(req,res)=>ok(res,await billing.reconcileAdvertisingRefund(req.params.id,req.user._id,req.body))));
  }
  router.use(requireAdvertisingManagement);
  const scope = req => admin ? undefined : req.seller._id;
  const review = admin ? [advertisingPermission('advertising_review')] : [];
  const config = admin ? [advertisingPermission('advertising_configure')] : [];
  router.get('/campaigns', ...review, asyncHandler(async (req, res) => {
    const { rows, ...meta } = await listAdvertisingCampaigns(scope(req), req.query); return paginated(res, rows, meta);
  }));
  router.get('/campaigns/:id', ...review, asyncHandler(async (req, res) => {
    const row = await advertisingCampaign(req.params.id, scope(req));
    return ok(res, (await campaignViews([row], { admin }))[0]);
  }));
  router.get('/packages', ...config, asyncHandler(async (req, res) => {
    const { page, limit, skip } = advertisingPagination(req.query);
    const filter = { advertisingVersion: 2, ...(!admin ? { isActive: true, 'advertising.archivedAt': null } : {}) };
    const [rows, total] = await Promise.all([PromotionPackage.find(filter).sort({ _id: -1 }).skip(skip).limit(limit), PromotionPackage.countDocuments(filter)]);
    return paginated(res, rows.map(packageDTO), { page, limit, total });
  }));
  router.get('/packages/:id', ...config, asyncHandler(async (req, res) => {
    const row = await PromotionPackage.findOne({ _id: advertisingId(req.params.id), advertisingVersion: 2,
      ...(!admin ? { isActive: true, 'advertising.archivedAt': null } : {}) });
    if (!row) throw httpError(404, 'Advertising package not found');
    return ok(res, packageDTO(row));
  }));
  // Rate limits are an additional process-local control, never a financial lock.
  if (admin) {
    router.post('/campaigns/:id/request-payment', advertisingPermission('advertising_review'), asyncHandler(async(req,res)=>ok(res, await requestAdvertisingPayment(req.params.id, req.body))));
    router.post('/campaigns/:id/billing-authorize',advertisingPermission('advertising_finance'),asyncHandler(async(req,res)=>ok(res,await billing.authorizeAdvertisingBilling(req.params.id,req.user._id,req.body))));
    router.post('/campaigns/:id/recognize',advertisingPermission('advertising_finance'),asyncHandler(async(req,res)=>ok(res,await billing.recognizeAdvertisingRevenue(req.params.id,req.user._id,req.body))));
    router.post('/campaigns/:id/cancel',advertisingPermission('advertising_review'),asyncHandler(async(req,res)=>ok(res,await billing.cancelAdvertisingCampaign(req.params.id,undefined,req.user._id,req.body))));
    router.post('/packages', ...config, asyncHandler(async (req, res) => created(res, await saveAdvertisingPackage(req.user._id, req.body))));
    router.patch('/packages/:id', ...config, asyncHandler(async (req, res) => ok(res, await saveAdvertisingPackage(req.user._id, req.body, req.params.id))));
    for (const action of ['approve', 'request-changes', 'reject', 'suspend', 'pilot']) router.post(`/campaigns/:id/${action}`, ...review, asyncHandler(async (req, res) => ok(res, await changeAdvertisingCampaign({ id: req.params.id, actorId: req.user._id, admin: true, input: req.body, action }))));
  } else {
    router.post('/payment-verification',asyncHandler(async(req,res)=>ok(res,await billing.verifyAdvertisingPayment(req.body.orderId,req.seller._id,req.body))));
    router.post('/campaigns/:id/cancel',asyncHandler(async(req,res)=>ok(res,await billing.cancelAdvertisingCampaign(req.params.id,req.seller._id,req.user._id,req.body))));
    router.get('/products', asyncHandler(async (req, res) => {
      const { page, limit, skip } = advertisingPagination(req.query);
      const channel = advertisingChannel(req.query.module);
      const filter = { sellerId: req.seller._id, isDeleted: false, $and: [channelVisibility(channel), { $or: [{ type: channel }, { channels: { $elemMatch: { type: channel, isActive: { $ne: false } } } }] }] };
      // Optional search by name or SKU, and a category filter matching the category rule of campaigns.
      if (req.query.q !== undefined) {
        if (typeof req.query.q !== 'string' || req.query.q.length > 100) throw httpError(400, 'Invalid product search');
        const words = req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (words) filter.$and.push({ $or: [{ name: { $regex: words, $options: 'i' } }, { sku: { $regex: words, $options: 'i' } }] });
      }
      if (req.query.category !== undefined) {
        const category = advertisingId(req.query.category);
        filter.$and.push({ $or: [{ type: channel, $or: [{ category }, { subCategory: category }] }, { channels: { $elemMatch: { type: channel, isActive: { $ne: false }, $or: [{ category }, { subCategory: category }] } } }] });
      }
      const [rows, total] = await Promise.all([Product.find(filter).select('name images sku price stock variants category subCategory channels type status isActive fulfillmentType')
        .populate('category', 'name parent').populate('subCategory', 'name parent').populate('channels.category', 'name parent').populate('channels.subCategory', 'name parent')
        .sort({ _id: -1 }).skip(skip).limit(limit).lean(), Product.countDocuments(filter)]);
      const placements = p => [...(p.type === channel ? [p] : []), ...(p.channels || []).filter(c => c.type === channel && c.isActive !== false)];
      // Every category a campaign may use for this product (its category or sub-category in this
      // storefront), most specific first, each with its parent so the seller can merge groups.
      const adCategories = p => {
        const seen = new Map();
        for (const { category, subCategory } of placements(p)) for (const c of [subCategory, category]) if (c?._id && !seen.has(String(c._id))) {
          const parent = c === subCategory && category?._id && String(category._id) === String(c.parent) ? category : null;
          seen.set(String(c._id), { id: c._id, name: c.name, parentId: c.parent || null, parentName: parent?.name || '' });
        }
        return [...seen.values()];
      };
      const data = rows.map(p => ({ id: p._id, name: p.name, image: p.images?.[0], sku: p.sku,
        eligible: p.status === 'approved' && p.isActive && p.fulfillmentType !== 'digital' && p.stock > 0,
        reason: p.status !== 'approved' ? 'Product is not approved' : !p.isActive ? 'Product is inactive' : p.fulfillmentType === 'digital' ? 'Digital ads are outside this release' : p.stock < 1 ? 'Out of stock' : '',
        categories: placements(p).map(c => c.category).filter(c => c?._id).map(c => ({ id: c._id, name: c.name })),
        adCategories: adCategories(p),
        variants: (p.variants?.length ? p.variants : [{ name: 'Standard', price: p.price, stock: p.stock }]).map(v => ({ id: v._id, name: v.name, price: v.price, stock: v.stock })),
      }));
      return paginated(res, data, { page, limit, total });
    }));
    router.post('/campaigns', asyncHandler(async (req, res) => created(res, await createAdvertisingCampaign(req.seller._id, req.user._id, req.body))));
    router.patch('/campaigns/:id', asyncHandler(async (req, res) => ok(res, await changeAdvertisingCampaign({ id: req.params.id, sellerId: req.seller._id, actorId: req.user._id, input: req.body, action: 'edit' }))));
    router.post('/campaigns/:id/submit', asyncHandler(async (req, res) => ok(res, await changeAdvertisingCampaign({ id: req.params.id, sellerId: req.seller._id, actorId: req.user._id, input: req.body, action: 'submit' }))));
    router.post('/campaigns/:id/actions', asyncHandler(async (req, res) => {
      if (Object.keys(req.body).some(k => !['action', 'version', 'reason'].includes(k))) throw httpError(400, 'Unsupported advertising fields');
      const { action, ...input } = req.body;
      if (action !== 'cancel') {
        await advertisingCampaign(req.params.id, scope(req));
        if (['pause', 'resume', 'renew'].includes(action)) advertisingUnavailable();
        throw httpError(400, 'Unsupported campaign action');
      }
      return ok(res, await changeAdvertisingCampaign({ id: req.params.id, sellerId: req.seller._id, actorId: req.user._id, input, action }));
    }));
    router.post('/campaigns/:id/payment-attempts',asyncHandler(async(req,res)=>{
      await advertisingCampaign(req.params.id,req.seller._id);
      return ok(res,await billing.initiateAdvertisingPayment(req.params.id,req.seller._id,req.user._id,req.body));
    }));
    router.post('/campaigns/:id/payment-verification',asyncHandler(async(req,res)=>{
      await advertisingCampaign(req.params.id,req.seller._id);
      if(!advertisingCapabilities().paymentsEnabled)advertisingUnavailable();
      return ok(res,await billing.verifyAdvertisingPayment(req.params.id,req.seller._id,req.body));
    }));
  }
  return router;
}
