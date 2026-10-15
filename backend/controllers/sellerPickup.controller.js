import Seller from '../models/Seller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { queueSellerPickupSync, pickupStatus } from '../services/sellerPickupSync.service.js';

const ownedSeller = async req => {
  if (req.userType !== 'user' || !req.user.roles?.includes('seller')) throw httpError(403, 'Seller membership is required');
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) throw httpError(404, 'Seller profile not found');
  if (['suspended', 'rejected'].includes(seller.status)) throw httpError(403, 'Seller account is not eligible for pickup synchronization');
  return seller;
};
export const getPickupStatus = asyncHandler(async (req, res) => ok(res, pickupStatus(await ownedSeller(req), req.user)));
export const retryPickupSync = asyncHandler(async (req, res) => {
  if (Object.keys(req.body || {}).length) throw httpError(400, 'Retry uses your saved store address and accepts no seller or address override');
  const seller = await ownedSeller(req);
  const state = await queueSellerPickupSync(seller._id, { retry: true });
  return ok(res, pickupStatus({ pickupSync: state, thirdPartyFulfillment: seller.thirdPartyFulfillment }), 'Pickup synchronization scheduled or awaiting its retry window');
});
