import React, { useRef, useState } from 'react';
import ModalPortal from '../ModalPortal';

// Server-built invoices only: this component formats stored amounts and never calculates tax.
const money = paise => Number.isSafeInteger(paise) ? `₹${(paise / 100).toFixed(2)}` : '—';
const date = value => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const STYLES = `
.bm-invoice{font:13px/1.45 system-ui,sans-serif;color:#111;background:#fff;padding:16px;border:1px solid #d6dde3;border-radius:8px;margin-bottom:16px;overflow-wrap:anywhere}
.bm-invoice h2{margin:0 0 4px;font-size:18px}.bm-invoice .bm-meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:#444;font-size:12px}
.bm-invoice .bm-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0}
.bm-invoice .bm-parties strong{display:block;font-size:11px;text-transform:uppercase;color:#555;letter-spacing:.4px}
.bm-invoice .bm-table{width:100%;overflow-x:auto}.bm-invoice table{width:100%;border-collapse:collapse;font-size:12px}
.bm-invoice th,.bm-invoice td{border-bottom:1px solid #e3e8ec;padding:6px 4px;text-align:right;vertical-align:top}
.bm-invoice th:first-child,.bm-invoice td:first-child{text-align:left}.bm-invoice tfoot td{font-weight:700}
.bm-invoice ul{margin:10px 0 0;padding-left:18px;color:#444;font-size:12px}
@media print{.bm-invoice{border:0;page-break-after:always}}`;

export function InvoiceSheet({ invoice }) {
  const doc = invoice.document, gst = Boolean(doc.seller?.gstin), split = doc.gstSplit;
  const taxColumns = !gst ? [] : split === 'cgst_sgst' ? [['CGST', 'cgstPaise'], ['SGST', 'sgstPaise']] : split === 'igst' ? [['IGST', 'igstPaise']] : [['GST', 'gstPaise']];
  return <article className="bm-invoice" aria-label={`${doc.title} ${invoice.invoiceNumber}`}>
    <h2>{doc.title}</h2>
    <div className="bm-meta"><span>No. {invoice.invoiceNumber}</span><span>Date {date(invoice.issuedAt)}</span><span>Order {doc.orderNo || doc.orderId}</span>{doc.deliveredAt && <span>Delivered {date(doc.deliveredAt)}</span>}</div>
    <div className="bm-parties">
      <div><strong>Sold by</strong>{doc.seller.name}{doc.seller.storeName && doc.seller.storeName !== doc.seller.name ? ` (${doc.seller.storeName})` : ''}<br />{doc.seller.address}{gst && <><br />GSTIN {doc.seller.gstin}</>}</div>
      <div><strong>Billed to</strong>{doc.customer.name || 'Customer'}<br />{doc.customer.address}{doc.placeOfSupply && <><br />Place of supply: {doc.placeOfSupply}</>}</div>
    </div>
    <div className="bm-table"><table>
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th>{gst && <><th>Taxable value</th><th>GST %</th></>}{taxColumns.map(([label]) => <th key={label}>{label}</th>)}<th>Amount</th></tr></thead>
      <tbody>{doc.lines.map((line, index) => <tr key={index}><td>{line.description}</td><td>{line.qty}</td><td>{money(line.unitPricePaise)}</td>
        {gst && <><td>{money(line.taxableValuePaise)}</td><td>{line.gstRate}%</td></>}{taxColumns.map(([label, key]) => <td key={label}>{money(line[key])}</td>)}<td>{money(line.grossPaise)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={3}>Total</td>{gst && <><td>{money(doc.totals.taxableValuePaise)}</td><td /></>}{taxColumns.map(([label, key]) => <td key={label}>{money(doc.totals[key])}</td>)}<td>{money(doc.totals.grossPaise)}</td></tr></tfoot>
    </table></div>
    {doc.totals.discountPaise > 0 && <p>Bulkimart discount: −{money(doc.totals.discountPaise)} · You paid {money(doc.totals.customerPaidPaise)} for these items.</p>}
    <ul>{doc.notes.map(note => <li key={note}>{note}</li>)}</ul>
  </article>;
}

/**
 * "Invoice" button for a delivered order. `load` returns the server's invoices (one per seller).
 * Printing copies the rendered invoices into a clean window, so "Save as PDF" works on every device.
 */
export default function OrderInvoices({ load, label = 'View invoice', buttonStyle, buttonClassName }) {
  const [open, setOpen] = useState(false), [invoices, setInvoices] = useState(null), [error, setError] = useState('');
  const sheets = useRef(null);
  const show = async () => {
    setOpen(true); setError('');
    if (invoices) return;
    try { setInvoices(await load()); } catch (e) { setError(e.message || 'Could not load the invoice'); }
  };
  const print = () => {
    const win = window.open('', '_blank');
    if (!win) { setError('Allow pop-ups to print or save the invoice.'); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>${STYLES}</style></head><body>${sheets.current?.innerHTML || ''}</body></html>`);
    win.document.close(); win.focus(); win.print();
  };
  return <>
    <button type="button" className={buttonClassName} style={buttonStyle} onClick={show}>{label}</button>
    {open && <ModalPortal className="bm-invoice-modal" aria-label="Invoice" style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#f8fafc', borderRadius: 12, width: 'min(760px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
        <style>{STYLES}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16 }}>{invoices?.length > 1 ? `Invoices (${invoices.length} sellers)` : 'Invoice'}</strong>
          <span style={{ display: 'flex', gap: 8 }}>
            {invoices?.length > 0 && <button type="button" onClick={print}>Print / Save PDF</button>}
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </span>
        </div>
        {error ? <p role="alert">{error}</p> : !invoices ? <p role="status">Loading invoice…</p>
          : <div ref={sheets}>{invoices.map(invoice => <InvoiceSheet key={invoice._id || invoice.invoiceNumber} invoice={invoice} />)}</div>}
      </div>
    </ModalPortal>}
  </>;
}
