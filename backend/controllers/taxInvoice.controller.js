import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { customerOrderInvoices, sellerOrderInvoice } from '../services/taxInvoice.service.js';

// @route GET /api/orders/:id/invoices — one invoice per seller on the customer's delivered order
export const getOrderInvoices = asyncHandler(async (req, res) => ok(res,
  await customerOrderInvoices(req.params.id, { userId: req.user._id, isAdmin: req.userType === 'admin' })));

// @route GET /api/seller/orders/:id/invoice — the seller's own invoice for a delivered order
export const getSellerOrderInvoice = asyncHandler(async (req, res) => ok(res,
  await sellerOrderInvoice(req.params.id, req.seller._id)));
