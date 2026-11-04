import crypto from 'node:crypto';
import { JWT_SECRET } from '../config/jwt.js';
import { httpError } from '../utils/response.js';

/**
 * Printable invoice pages for the seller app.
 *
 * The native app has no print/PDF engine, so it opens this page in the phone's
 * browser, whose print screen offers "Save as PDF". The page is reached by a
 * short-lived link that names one seller and one order and is signed with a key
 * derived from the server secret, so the link works without the app's session
 * and cannot be altered to show another invoice. The HTML formats the
 * server-built invoice only; nothing is recalculated here.
 */

const LINK_TTL_SECONDS = 10 * 60;
const signingKey = crypto.createHmac('sha256', JWT_SECRET).update('bulkimart:invoice-print:v1').digest();
const b64url = (buffer) => Buffer.from(buffer).toString('base64url');
const sign = (payload) => b64url(crypto.createHmac('sha256', signingKey).update(payload).digest());

export const createInvoicePrintToken = ({ sellerId, orderId, now = Date.now() }) => {
  const payload = b64url(JSON.stringify({ s: String(sellerId), o: String(orderId), e: Math.floor(now / 1000) + LINK_TTL_SECONDS }));
  return { token: `${payload}.${sign(payload)}`, expiresInSeconds: LINK_TTL_SECONDS };
};

export const verifyInvoicePrintToken = (token, now = Date.now()) => {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra !== undefined) throw httpError(404, 'This invoice link is not valid');
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw httpError(404, 'This invoice link is not valid');
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw httpError(404, 'This invoice link is not valid'); }
  if (!/^[a-f\d]{24}$/i.test(claims?.s || '') || !/^[a-f\d]{24}$/i.test(claims?.o || '') || !Number.isSafeInteger(claims?.e)) throw httpError(404, 'This invoice link is not valid');
  if (claims.e * 1000 < now) throw httpError(410, 'This invoice link has expired. Open the invoice in the app again.');
  return { sellerId: claims.s, orderId: claims.o };
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (paise) => (Number.isSafeInteger(paise) ? `₹${(paise / 100).toFixed(2)}` : '—');
const date = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

// Same layout as the website's printed invoice (frontend/src/components/finance/OrderInvoices.jsx).
const STYLES = `
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111}
.bar{position:sticky;top:0;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 14px;background:#0B2D6B;color:#fff}
.bar span{font-size:13px}.bar button{border:0;border-radius:8px;padding:10px 14px;font:600 14px system-ui,sans-serif;background:#fff;color:#0B2D6B}
.bm-invoice{max-width:820px;margin:14px auto;font:13px/1.45 system-ui,sans-serif;color:#111;background:#fff;padding:16px;border:1px solid #d6dde3;border-radius:8px;overflow-wrap:anywhere}
.bm-invoice h2{margin:0 0 4px;font-size:18px}.bm-meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:#444;font-size:12px}
.bm-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.bm-parties strong{display:block;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:.4px}
.bm-table{width:100%;overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border-bottom:1px solid #e3e8ec;padding:6px 4px;text-align:right;vertical-align:top}
th:first-child,td:first-child{text-align:left}tfoot td{font-weight:700}
ul{margin:10px 0 0;padding-left:18px;color:#444;font-size:12px}
@media print{body{background:#fff}.bar{display:none}.bm-invoice{border:0;margin:0;max-width:none}}`;

export const renderInvoiceHtml = (invoice) => {
  const doc = invoice.document;
  const gst = Boolean(doc.seller?.gstin);
  const split = doc.gstSplit;
  const taxColumns = !gst ? [] : split === 'cgst_sgst' ? [['CGST', 'cgstPaise'], ['SGST', 'sgstPaise']] : split === 'igst' ? [['IGST', 'igstPaise']] : [['GST', 'gstPaise']];
  const e = escapeHtml;
  const sellerName = `${e(doc.seller?.name)}${doc.seller?.storeName && doc.seller.storeName !== doc.seller.name ? ` (${e(doc.seller.storeName)})` : ''}`;
  const rows = (doc.lines || []).map((line) => `<tr><td>${e(line.description)}</td><td>${e(line.qty)}</td><td>${money(line.unitPricePaise)}</td>`
    + (gst ? `<td>${money(line.taxableValuePaise)}</td><td>${e(line.gstRate)}%</td>` : '')
    + taxColumns.map(([, key]) => `<td>${money(line[key])}</td>`).join('') + `<td>${money(line.grossPaise)}</td></tr>`).join('');
  const title = `${doc.title || 'Invoice'} ${invoice.invoiceNumber || ''}`.trim();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${e(title)}</title><style>${STYLES}</style></head><body>
<div class="bar"><span>Use Print → Save as PDF</span><button type="button" id="print">Print / Save PDF</button></div>
<article class="bm-invoice" aria-label="${e(title)}">
<h2>${e(doc.title || 'Invoice')}</h2>
<div class="bm-meta"><span>No. ${e(invoice.invoiceNumber)}</span><span>Date ${date(invoice.issuedAt)}</span><span>Order ${e(doc.orderNo || doc.orderId)}</span>${doc.deliveredAt ? `<span>Delivered ${date(doc.deliveredAt)}</span>` : ''}</div>
<div class="bm-parties">
<div><strong>Sold by</strong>${sellerName}<br>${e(doc.seller?.address)}${gst ? `<br>GSTIN ${e(doc.seller.gstin)}` : ''}</div>
<div><strong>Billed to</strong>${e(doc.customer?.name || 'Customer')}<br>${e(doc.customer?.address)}${doc.placeOfSupply ? `<br>Place of supply: ${e(doc.placeOfSupply)}` : ''}</div>
</div>
<div class="bm-table"><table>
<thead><tr><th>Item</th><th>Qty</th><th>Price</th>${gst ? '<th>Taxable value</th><th>GST %</th>' : ''}${taxColumns.map(([label]) => `<th>${label}</th>`).join('')}<th>Amount</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">Total</td>${gst ? `<td>${money(doc.totals?.taxableValuePaise)}</td><td></td>` : ''}${taxColumns.map(([, key]) => `<td>${money(doc.totals?.[key])}</td>`).join('')}<td>${money(doc.totals?.grossPaise)}</td></tr></tfoot>
</table></div>
${doc.totals?.discountPaise > 0 ? `<p>Bulkimart discount: −${money(doc.totals.discountPaise)} · Customer paid ${money(doc.totals.customerPaidPaise)} for these items.</p>` : ''}
${(doc.notes || []).length ? `<ul>${doc.notes.map((note) => `<li>${e(note)}</li>`).join('')}</ul>` : ''}
</article>
<script>document.getElementById('print').addEventListener('click',function(){window.print()});setTimeout(function(){window.print()},600);</script>
</body></html>`;
};

// Locks the page down: no network access, nothing embeddable, nothing cached.
export const INVOICE_PRINT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
