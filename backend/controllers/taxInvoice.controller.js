import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { customerOrderInvoices, sellerOrderInvoice } from '../services/taxInvoice.service.js';
import { createInvoicePrintToken, verifyInvoicePrintToken, renderInvoiceHtml, INVOICE_PRINT_HEADERS } from '../services/invoicePrint.service.js';

// @route GET /api/orders/:id/invoices — one invoice per seller on the customer's delivered order
export const getOrderInvoices = asyncHandler(async (req, res) => ok(res,
  await customerOrderInvoices(req.params.id, { userId: req.user._id, isAdmin: req.userType === 'admin' })));

// @route GET /api/seller/orders/:id/invoice — the seller's own invoice for a delivered order
export const getSellerOrderInvoice = asyncHandler(async (req, res) => ok(res,
  await sellerOrderInvoice(req.params.id, req.seller._id)));

// @route POST /api/sellers/orders/:id/invoice/print-link — a 10-minute link to a printable copy
// of the seller's own invoice, for the seller app (which has no print/PDF engine of its own).
export const createSellerInvoicePrintLink = asyncHandler(async (req, res) => {
  await sellerOrderInvoice(req.params.id, req.seller._id); // ownership + delivered checks, same as viewing
  const { token, expiresInSeconds } = createInvoicePrintToken({ sellerId: req.seller._id, orderId: req.params.id });
  return ok(res, { path: `/api/invoice-print/${token}`, expiresInSeconds });
});

// @route GET /api/invoice-print/:token — public, but only through a valid signed link
export const renderInvoicePrintPage = async (req, res) => {
  try {
    const { sellerId, orderId } = verifyInvoicePrintToken(req.params.token);
    const invoice = await sellerOrderInvoice(orderId, sellerId);
    res.set(INVOICE_PRINT_HEADERS).status(200).send(renderInvoiceHtml(invoice));
  } catch (error) {
    const status = error?.status && error.status < 500 ? error.status : 500;
    const message = status === 500 ? 'The invoice could not be loaded. Please try again.' : error.message;
    res.set(INVOICE_PRINT_HEADERS).status(status).send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice</title><p style="font:15px system-ui,sans-serif;padding:24px">${String(message).replace(/[&<>"']/g, '')}</p>`);
  }
};
