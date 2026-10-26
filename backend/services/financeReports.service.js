import mongoose from 'mongoose';
import Ledger from '../models/SellerLedgerEntry.js';
import Seller from '../models/Seller.js';
import { httpError } from '../utils/response.js';

/**
 * Read-only reports built from the append-only ledger. Nothing here writes.
 *   - taxReport / sellerTaxStatement: TCS (GST s.52, GSTR-8) and TDS (194-O,
 *     26Q) per seller per month, with the supply values they were worked out on.
 *   - journal / trialBalance: each marketplace ledger entry expressed as a
 *     balanced debit/credit pair, for import into the accounting system.
 * Months and dates are India time.
 */
const IST_MS = 5.5 * 3600 * 1000;
const paise = amount => Math.round(Number(amount || 0) * 100);
const signed = row => (row.direction === 'credit' ? 1 : -1) * paise(row.amount);

export const monthRange = month => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw httpError(400, 'Month must look like 2026-10');
  const [year, number] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(year, number - 1, 1) - IST_MS), to: new Date(Date.UTC(year, number, 1) - IST_MS) };
};
const dateRange = (from, to) => {
  const start = new Date(`${from}T00:00:00+05:30`), end = new Date(`${to}T00:00:00+05:30`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw httpError(400, 'Choose a valid from and to date');
  if (end - start > 370 * 24 * 3600 * 1000) throw httpError(400, 'Choose at most one year');
  return { from: start, to: new Date(end.getTime() + 24 * 3600 * 1000) };
};

const TAX_ACCOUNTS = ['merchandise_gross', 'tcs_liability', 'tds_liability'];
const addTax = (target, row) => {
  if (row.account === 'merchandise_gross') {
    target.grossPaise += signed(row);
    const taxable = Number.isSafeInteger(row.metadata?.taxableValuePaise) ? row.metadata.taxableValuePaise : paise(row.amount);
    target.taxablePaise += (row.direction === 'credit' ? 1 : -1) * taxable;
  } else if (row.account === 'tcs_liability') target.tcsPaise += signed(row);
  else if (row.account === 'tds_liability') target.tdsPaise += signed(row);
};
const emptyTotals = () => ({ grossPaise: 0, taxablePaise: 0, tcsPaise: 0, tdsPaise: 0 });

export const taxReport = async ({ month }) => {
  const { from, to } = monthRange(month);
  const entries = await Ledger.find({ account: { $in: TAX_ACCOUNTS }, sellerId: { $exists: true }, createdAt: { $gte: from, $lt: to } })
    .select('sellerId account direction amount metadata').lean();
  const bySeller = new Map();
  for (const row of entries) {
    const key = String(row.sellerId);
    if (!bySeller.has(key)) bySeller.set(key, emptyTotals());
    addTax(bySeller.get(key), row);
  }
  const sellers = await Seller.find({ _id: { $in: [...bySeller.keys()] } }).select('businessName storeDetails.name gstin pan').lean();
  const info = new Map(sellers.map(seller => [String(seller._id), seller]));
  const rows = [...bySeller.entries()].map(([sellerId, totals]) => {
    const seller = info.get(sellerId) || {};
    return { sellerId, sellerName: seller.storeDetails?.name || seller.businessName || '', gstin: seller.gstin || '', pan: seller.pan || '', ...totals,
      missing: [...(totals.tcsPaise && !seller.gstin ? ['GSTIN'] : []), ...(totals.tdsPaise && !seller.pan ? ['PAN'] : [])] };
  }).sort((a, b) => a.sellerName.localeCompare(b.sellerName));
  const totals = rows.reduce((sum, row) => { for (const key of Object.keys(sum)) sum[key] += row[key]; return sum; }, emptyTotals());
  return { month, from, to, rows, totals, sellersMissingIds: rows.filter(row => row.missing.length).length };
};

export const sellerTaxStatement = async ({ sellerId, months = 12, now = Date.now() }) => {
  const current = new Date(now + IST_MS);
  const list = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const earliest = monthRange(list.at(-1)).from;
  const entries = await Ledger.find({ sellerId: new mongoose.Types.ObjectId(String(sellerId)), account: { $in: TAX_ACCOUNTS }, createdAt: { $gte: earliest } })
    .select('account direction amount metadata createdAt').lean();
  const byMonth = new Map(list.map(month => [month, emptyTotals()]));
  for (const row of entries) {
    const local = new Date(new Date(row.createdAt).getTime() + IST_MS);
    const month = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
    if (byMonth.has(month)) addTax(byMonth.get(month), row);
  }
  return { months: list.map(month => ({ month, ...byMonth.get(month) })) };
};

// ---- accounting journal ---------------------------------------------------
const CLEARING = 'Customer payments clearing';
// [debit, credit] for a credit-direction entry; a debit-direction entry is the
// same pair reversed. null = internal bucket move or memo, not an accounting event.
// Prepaid Quick Shiprocket charges are a seller receivable settled by the
// seller's own payment, whichever ledger account they were posted to.
const SELLER_COURIER = 'Seller courier receivable';
const courierObligationPair = row => ({
  quick_freight_obligation: ['Courier payable (Shiprocket)', SELLER_COURIER],
  quick_service_fee: ['Shiprocket service fee income', SELLER_COURIER],
  quick_fee_tax: ['GST payable', SELLER_COURIER],
  quick_fee_payment: ['Bank', SELLER_COURIER],
})[row.type] || null;
const accountPair = row => {
  const account = row.account || 'seller_payable', key = String(row.idempotencyKey || '');
  switch (account) {
    case 'seller_payable':
      if (row.type === 'order_earning' || row.type === 'reversal' || row.type === 'same_day_incentive' || (row.type === 'adjustment' && row.metadata?.source === 'historical-reviewed-v1')) return [CLEARING, 'Seller payable'];
      if (row.type === 'payout_settlement') return row.bucket === 'settled' ? ['Seller payable', 'Bank'] : null;
      return courierObligationPair(row);
    case 'seller_courier_obligation': return courierObligationPair(row);
    case 'courier_expense': return ['Courier expense', 'Courier payable (Shiprocket)'];
    case 'commission_revenue': return [CLEARING, 'Commission income'];
    case 'tax_liability': return [CLEARING, 'GST payable'];
    case 'tcs_liability': return [CLEARING, 'TCS payable'];
    case 'tds_liability': return [CLEARING, 'TDS payable'];
    case 'platform_discount_expense': return ['Discounts funded by Bulkimart', CLEARING];
    case 'cod_shortage_expense': return ['COD shortages absorbed', CLEARING];
    case 'customer_delivery': return [CLEARING, 'Delivery charges income'];
    case 'rider_payable':
      if (row.type === 'delivery_earning') return ['Delivery cost', 'Rider payable'];
      if (row.type === 'payout_settlement') return row.bucket === 'settled' ? ['Rider payable', 'Bank'] : null;
      return null;
    case 'cod_custody':
      if (key.includes(':SHORTAGE_WRITEOFF')) return ['COD cash with riders', CLEARING];
      if (key.includes(':RECEIPT:')) return ['COD cash with riders', 'Bank'];
      return ['COD cash with riders', CLEARING];
    case 'cod_excess_liability': return ['Bank', 'Excess COD cash payable'];
    default: return null;
  }
};
const JOURNAL_ACCOUNTS = ['seller_payable', 'seller_courier_obligation', 'courier_expense','commission_revenue', 'tax_liability', 'tcs_liability', 'tds_liability', 'platform_discount_expense', 'cod_shortage_expense', 'customer_delivery', 'rider_payable', 'cod_custody', 'cod_excess_liability'];

export const journal = async ({ from, to }) => {
  const range = dateRange(from, to);
  const entries = await Ledger.find({ $or: [{ account: { $in: JOURNAL_ACCOUNTS } }, { account: { $exists: false } }], advertisingCampaignId: { $exists: false }, createdAt: { $gte: range.from, $lt: range.to } })
    .sort({ createdAt: 1, _id: 1 }).select('entryNo idempotencyKey account type direction bucket amount description reference orderId sellerId partnerId metadata createdAt').lean();
  const lines = [];
  for (const row of entries) {
    const pair = accountPair(row);
    if (!pair) continue;
    const [debit, credit] = row.direction === 'credit' ? pair : [pair[1], pair[0]];
    lines.push({ date: row.createdAt, entryNo: row.entryNo, debit, credit, amountPaise: paise(row.amount), description: row.description, reference: row.reference || '',
      orderId: row.orderId ? String(row.orderId) : '', party: row.sellerId ? `seller:${row.sellerId}` : row.partnerId ? `rider:${row.partnerId}` : '' });
  }
  return { from, to, lines };
};

export const trialBalance = async ({ from, to }) => {
  const { lines } = await journal({ from, to });
  const accounts = new Map();
  const add = (name, side, amount) => { const row = accounts.get(name) || { account: name, debitPaise: 0, creditPaise: 0 }; row[side] += amount; accounts.set(name, row); };
  for (const line of lines) { add(line.debit, 'debitPaise', line.amountPaise); add(line.credit, 'creditPaise', line.amountPaise); }
  const rows = [...accounts.values()].map(row => ({ ...row, balancePaise: row.debitPaise - row.creditPaise })).sort((a, b) => a.account.localeCompare(b.account));
  const totals = rows.reduce((sum, row) => ({ debitPaise: sum.debitPaise + row.debitPaise, creditPaise: sum.creditPaise + row.creditPaise }), { debitPaise: 0, creditPaise: 0 });
  return { from, to, rows, totals, balanced: totals.debitPaise === totals.creditPaise };
};

// Spreadsheet-safe CSV (cells that could run as formulas are quoted as text).
export const toCsv = (header, rows) => [header, ...rows].map(row => row.map(value => {
  const text = String(value ?? '');
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}).join(',')).join('\r\n');
export const rupees = value => (value / 100).toFixed(2);
