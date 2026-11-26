import mongoose from 'mongoose';
import Return from '../models/Return.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { sellerDecideReturnCtrl, getReturnPickupOptions, selectReturnPickup, refreshReturnCourier, sellerConfirmReturnReceived } from './return.controller.js';

/**
 * FBB returns, handled by Bulkimart (warehouse permission): approve/reject, arrange the reverse pickup back to
 * the warehouse, and confirm the warehouse received it. These run the same return handlers a seller uses —
 * with the return's own seller as the owner and the warehouse as the destination (fulfilmentOrigin.service.js).
 * Inspection, restock (resellable → warehouse sale stock, otherwise damaged) and refund stay on the existing
 * admin return screens (PATCH /api/admin/returns/:id/status, refund endpoints).
 */

const fbbReturn = async (returnId) => {
  if (!mongoose.isValidObjectId(returnId)) throw httpError(400, 'Invalid return');
  const ret = await Return.findById(returnId).select('orderId sellerId').lean();
  if (!ret) throw httpError(404, 'Return not found');
  const order = await Order.findById(ret.orderId).select('fulfillmentOwner').lean();
  if (order?.fulfillmentOwner !== 'bulkimart') throw httpError(409, 'This return belongs to a seller-fulfilled order; the seller handles it');
  return ret;
};

const asBulkimart = (handler) => asyncHandler(async (req, res, next) => {
  const ret = await fbbReturn(req.params.returnId);
  req.seller = { _id: ret.sellerId };
  req.fbbAdmin = true;
  return handler(req, res, next);
});

export const decideFbbReturn = asBulkimart(sellerDecideReturnCtrl);
export const fbbReturnPickupOptions = asBulkimart(getReturnPickupOptions);
export const selectFbbReturnPickup = asBulkimart(selectReturnPickup);
export const refreshFbbReturnCourier = asBulkimart(refreshReturnCourier);
export const markFbbReturnReceived = asBulkimart(sellerConfirmReturnReceived);

/** FBB returns needing Bulkimart's attention. */
export const listFbbReturns = asyncHandler(async (req, res) => {
  const orderIds = await Order.find({ fulfillmentOwner: 'bulkimart' }).distinct('_id');
  const statuses = String(req.query.status || 'RETURN_REQUESTED,UNDER_REVIEW,APPROVED,AWAITING_RETURN,RETURN_RECEIVED').split(',');
  const rows = await Return.find({ orderId: { $in: orderIds }, status: { $in: statuses } }).sort({ requestedAt: -1 }).limit(200)
    .select('-requestKey -reverseBooking.operationToken -refundLockedAt -pickup.offerAttempts').lean();
  return ok(res, rows);
});
