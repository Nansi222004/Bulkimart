import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { executeAccountAction } from '../services/accountLifecycle.service.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Seller from '../models/Seller.js';

const messages = {
  deleted: 'Account permanently deleted because no historical or financial references were found.',
  deactivated: 'Account deactivated and retained because historical references must be preserved.',
};

const handler = (category) => asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, `Invalid ${category} account identifier`);

  const result = await executeAccountAction({
    category,
    targetId: req.params.id,
    actorAdminId: req.user._id,
    source: 'admin',
  });
  if (!result) throw httpError(404, `${category === 'delivery' ? 'Delivery partner' : category} account not found`);
  if (result.outcome === 'skipped') {
    throw httpError(409, 'Account cannot be removed while active fulfillment or unresolved financial obligations exist.', {
      action: 'blocked', reasonCodes: result.reasonCodes,
    });
  }
  return ok(res, { action: result.outcome, reasonCodes: result.reasonCodes }, messages[result.outcome]);
});

export const deleteCustomerAccount = handler('customer');
export const deleteSellerAccount = handler('seller');
export const deleteDeliveryAccount = handler('delivery');

export const deleteMyCustomerAccount = asyncHandler(async (req, res) => {
  const result = await executeAccountAction({
    category: 'customer',
    targetId: req.user._id,
    actorAdminId: null,
    source: 'self',
  });
  if (!result) throw httpError(404, 'User account not found');
  if (result.outcome === 'skipped') {
    throw httpError(409, 'Account cannot be deleted while active orders, unresolved payments, or wallet balance exist.', {
      action: 'blocked', reasonCodes: result.reasonCodes,
    });
  }
  return ok(res, { action: result.outcome, reasonCodes: result.reasonCodes }, messages[result.outcome]);
});

export const deleteMySellerAccount = asyncHandler(async (req, res) => {
  const sellerId = req.seller?._id || (await Seller.findOne({ userId: req.user._id }))?._id;
  if (!sellerId) throw httpError(404, 'Seller profile not found');
  const result = await executeAccountAction({
    category: 'seller',
    targetId: sellerId,
    actorAdminId: null,
    source: 'self',
  });
  if (!result) throw httpError(404, 'Seller account not found');
  if (result.outcome === 'skipped') {
    throw httpError(409, 'Seller account cannot be deleted while active orders, unresolved returns, or pending payouts exist.', {
      action: 'blocked', reasonCodes: result.reasonCodes,
    });
  }
  return ok(res, { action: result.outcome, reasonCodes: result.reasonCodes }, messages[result.outcome]);
});

export const deleteMyDeliveryAccount = asyncHandler(async (req, res) => {
  const partner = await DeliveryPartner.findOne({ userId: req.user._id });
  if (!partner) throw httpError(404, 'Delivery partner profile not found');
  const result = await executeAccountAction({
    category: 'delivery',
    targetId: partner._id,
    actorAdminId: null,
    source: 'self',
  });
  if (!result) throw httpError(404, 'Delivery account not found');
  if (result.outcome === 'skipped') {
    throw httpError(409, 'Delivery account cannot be deleted while active deliveries, returns, or pending earnings exist.', {
      action: 'blocked', reasonCodes: result.reasonCodes,
    });
  }
  return ok(res, { action: result.outcome, reasonCodes: result.reasonCodes }, messages[result.outcome]);
});
