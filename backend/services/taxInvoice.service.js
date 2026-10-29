import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import TaxInvoice, { InvoiceCounter } from '../models/TaxInvoice.js';
import { PRODUCT_GST_VERSION } from './productGst.service.js';
import { financialTransaction } from './financeSafety.service.js';
import { resolveIndianState, indianStateByCode } from '../utils/indianStates.js';
import { httpError } from '../utils/response.js';

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Indian financial year (April–March, India time) of a date, e.g. "2026-27". */
export const financialYearOf = (date) => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

// At most 16 characters, unique and consecutive within the seller's financial year.
export const invoiceNumberOf = (financialYear, sequence) => `INV${financialYear.replace('-', '').slice(2)}-${String(sequence).padStart(6, '0')}`;

export const sellerGstin = seller => {
  const gstin = String(seller?.gstin || '').trim().toUpperCase();
  return GSTIN.test(gstin) ? gstin : null;
};

const sum = (rows, key) => rows.reduce((n, row) => n + (row[key] || 0), 0);

/**
 * The invoice body for one seller's goods on a delivered order, built only from the order's frozen
 * GST snapshot. Prices include GST; the value shown is the full price, because discounts on Bulkimart
 * are paid by Bulkimart, not the seller. Delivery is Bulkimart's own charge, carries no GST, and is
 * not part of the seller's invoice.
 */
export function buildInvoiceDocument({ order, seller, issuedAt, invoiceNumber }) {
  const gstin = sellerGstin(seller);
  const store = seller.storeDetails || {};
  // A registered seller's state is the one on their GSTIN; otherwise the one on their store address.
  const supplierState = gstin ? indianStateByCode(gstin.slice(0, 2)) : resolveIndianState(store.state);
  const placeOfSupply = resolveIndianState(order.shippingAddress?.state);
  // Same state: CGST + SGST in halves. Different states: IGST. Either state unknown: GST in total only.
  const split = !gstin ? 'none' : !supplierState || !placeOfSupply ? 'undetermined'
    : supplierState.code === placeOfSupply.code ? 'cgst_sgst' : 'igst';
  const lines = order.productTax.lines.map((line, index) => ({ line, item: order.items[index] }))
    .filter(({ line }) => String(line.sellerId) === String(seller._id))
    .map(({ line, item }) => {
      const cgstPaise = split === 'cgst_sgst' ? Math.floor(line.gstPaise / 2) : 0;
      return {
        description: [item?.name || 'Item', item?.variantName].filter(Boolean).join(' — '),
        qty: line.qty, unitPricePaise: line.unitPricePaise, grossPaise: line.grossPaise,
        discountPaise: line.discountPaise || 0, customerPaidPaise: line.customerPaidPaise ?? line.grossPaise,
        ...(gstin ? { gstRate: line.gstRate, taxableValuePaise: line.taxableValuePaise, gstPaise: line.gstPaise,
          cgstPaise, sgstPaise: split === 'cgst_sgst' ? line.gstPaise - cgstPaise : 0, igstPaise: split === 'igst' ? line.gstPaise : 0 } : {}),
      };
    });
  if (!lines.length) throw httpError(404, 'This seller has no items on this order');
  const totals = Object.fromEntries(['grossPaise', 'discountPaise', 'customerPaidPaise', ...(gstin ? ['taxableValuePaise', 'gstPaise', 'cgstPaise', 'sgstPaise', 'igstPaise'] : [])]
    .map(key => [key, sum(lines, key)]));
  return {
    title: gstin ? 'Tax Invoice' : 'Invoice', invoiceNumber, issuedAt, deliveredAt: order.deliveredAt || null,
    orderId: String(order._id), orderNo: order.orderNo || null, pricesIncludeGst: true, gstSplit: split,
    seller: { name: seller.businessName || store.name || 'Seller', storeName: store.name || null, gstin,
      address: [store.address, store.city, supplierState?.name || store.state, store.pincode].filter(Boolean).join(', '),
      stateCode: supplierState?.code || null },
    customer: { name: order.shippingAddress?.name || null,
      address: [order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.city, placeOfSupply?.name || order.shippingAddress?.state, order.shippingAddress?.pincode].filter(Boolean).join(', ') },
    placeOfSupply: placeOfSupply ? `${placeOfSupply.name} (${placeOfSupply.code})` : order.shippingAddress?.state || null,
    lines, totals,
    notes: [
      gstin ? 'All prices include GST.' : 'The seller is not registered for GST, so no GST is charged on this invoice.',
      ...(totals.discountPaise ? ['Discounts were paid by Bulkimart; the seller received the full price.'] : []),
      'Delivery fees are charged by Bulkimart, carry no GST, and are not part of this invoice.',
    ],
  };
}

const deliveredOrder = async (orderId) => {
  const order = await Order.findById(orderId).lean();
  if (!order) throw httpError(404, 'Order not found');
  if (!order.deliveredAt) throw httpError(409, 'An invoice is available once the order is delivered');
  if (order.productTax?.version !== PRODUCT_GST_VERSION) throw httpError(409, 'An invoice is available for orders placed after GST invoicing started');
  return order;
};

/**
 * The seller's invoice for this order, issued on first request and stored for good. Numbering runs
 * in the same transaction as the invoice, so a failed or repeated request never skips or reuses a number.
 */
export async function issueSellerInvoice(order, sellerId) {
  const existing = await TaxInvoice.findOne({ orderId: order._id, sellerId }).lean();
  if (existing) return existing;
  const seller = await Seller.findById(sellerId).lean();
  if (!seller) throw httpError(404, 'Seller not found');
  try {
    return await financialTransaction(async (session) => {
      const again = await TaxInvoice.findOne({ orderId: order._id, sellerId }).session(session).lean();
      if (again) return again;
      const issuedAt = new Date(), financialYear = financialYearOf(issuedAt);
      const { sequence } = await InvoiceCounter.findOneAndUpdate({ sellerId, financialYear }, { $inc: { sequence: 1 } },
        { upsert: true, returnDocument: 'after', session });
      const invoiceNumber = invoiceNumberOf(financialYear, sequence);
      const document = buildInvoiceDocument({ order, seller, issuedAt, invoiceNumber });
      const [invoice] = await TaxInvoice.create([{ orderId: order._id, sellerId, userId: order.userId, invoiceNumber, financialYear,
        sequence, kind: document.seller.gstin ? 'tax_invoice' : 'invoice', issuedAt, document }], { session });
      return invoice.toObject();
    });
  } catch (error) {
    // Two first requests at once: the other one issued it.
    if (error?.code === 11000) {
      const issued = await TaxInvoice.findOne({ orderId: order._id, sellerId }).lean();
      if (issued) return issued;
    }
    throw error;
  }
}

/** Every seller's invoice on the customer's own delivered order. */
export async function customerOrderInvoices(orderId, { userId, isAdmin = false }) {
  const order = await deliveredOrder(orderId);
  if (!isAdmin && String(order.userId) !== String(userId)) throw httpError(403, 'This is not your order');
  const sellerIds = [...new Set(order.productTax.lines.map(line => line.sellerId).filter(Boolean).map(String))];
  const invoices = [];
  for (const sellerId of sellerIds) invoices.push(await issueSellerInvoice(order, sellerId));
  return invoices;
}

/** The seller's own invoice on an order that carries their items. */
export async function sellerOrderInvoice(orderId, sellerId) {
  const order = await deliveredOrder(orderId);
  if (!order.items.some(item => String(item.sellerId) === String(sellerId))) throw httpError(404, 'Order not found');
  return issueSellerInvoice(order, sellerId);
}
