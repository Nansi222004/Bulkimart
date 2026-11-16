import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, getPagination } from '../utils/response.js';
import CourierEventLog from '../models/CourierEventLog.js';
import { listShipmentExceptions, resolveShipmentException } from '../services/courierTracking.service.js';

/** Admin review of Shiprocket shipment problems (RTO, lost, damaged, destroyed, cancelled, undelivered). */

// @route GET /api/admin/shipment-exceptions?status=open|resolved|all
export const getShipmentExceptions = asyncHandler(async (req, res) => {
  const status = ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open';
  const { page, limit } = getPagination(req.query, 20, 50);
  return ok(res, await listShipmentExceptions({ status, page, limit }));
});

// @route GET /api/admin/shipment-exceptions/:orderId/events — the courier audit trail for one order
export const getShipmentEvents = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.orderId)) throw httpError(400, 'Invalid order');
  const events = await CourierEventLog.find({ orderId: req.params.orderId }).sort({ createdAt: -1 }).limit(100).lean();
  return ok(res, events);
});

// @route POST /api/admin/shipment-exceptions/:orderId/resolve
// body: { decision: CANCEL_AND_REFUND | CLOSE_WITHOUT_REFUND, restock, sellerSettlement, customerMessage, note }
export const resolveShipmentExceptionAdmin = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.orderId)) throw httpError(400, 'Invalid order');
  const { decision, restock = false, sellerSettlement = 'NO_EARNING', customerMessage = '', note } = req.body || {};
  const order = await resolveShipmentException({ orderId: req.params.orderId, adminId: req.user._id, decision, restock, sellerSettlement, customerMessage, note });
  return ok(res, order, decision === 'CANCEL_AND_REFUND' ? 'Order cancelled and refunded under the usual refund rules' : 'Shipment exception closed');
});
