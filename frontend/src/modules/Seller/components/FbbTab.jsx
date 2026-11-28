import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';
import { openRazorpayCheckout } from '../../../utils/razorpayCheckout';
import { FbbChargeSummary } from './DeliveryMethodField';
import './SellerFbb.css';

/**
 * Fulfilled by Bulkimart — the seller's read-only view: stock held in the Bulkimart warehouse,
 * receipts (with any damaged, rejected or missing units), service charges, and what is owed.
 * Only Bulkimart staff change warehouse stock or fulfil FBB orders; the seller can pay what is owed
 * in advance (otherwise it is deducted from earnings before payout).
 */
const headers = () => {
  const token = getPortalToken('seller');
  if (!token) throw new Error('Sign in to your seller account again.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CHARGE_LABEL = { storage: 'Storage', packaging: 'Packaging', fulfillment: 'Fulfilment' };
const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

const loadFbb = async () => {
  const response = await boundedFetch(apiUrl('/api/sellers/fbb'), { headers: headers() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Could not load Fulfilled by Bulkimart');
  return body.data;
};

/** Show the FBB nav item only when FBB is open, or the seller already has FBB stock, receipts or charges. */
export function useFbbNavigation() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    loadFbb().then((data) => { if (alive) setVisible(Boolean(data?.active)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return visible;
}

const STAGES = {
  waiting_for_stock: ['Waiting for stock', 'is-warn', 'Not received yet. Send it to the warehouse, then tap “I’ve sent stock”.'],
  on_the_way: ['On the way', 'is-info', ''],
  being_checked: ['Being checked', 'is-info', 'The warehouse received it and is counting it.'],
  on_sale: ['On sale', 'is-good', ''],
  out_of_stock: ['Out of stock', 'is-bad', 'Everything sold. Send more stock.'],
};
const SHIPMENT_STATUS = { in_transit: ['On the way', 'is-info'], received: ['Received', 'is-good'], cancelled: ['Cancelled', 'is-bad'] };
const STEPS = [
  ['Choose FBB', 'Add a product with “Fulfilled by Bulkimart” (or switch an existing product to it).'],
  ['Pack and send', 'Send the stock to the warehouse below with an invoice or challan listing each product and quantity.'],
  ['Tell Bulkimart', 'Tap “I’ve sent stock” and enter what you sent, the courier and the tracking number.'],
  ['Warehouse checks', 'Bulkimart counts what arrived. You get a notification and see it under Receipts.'],
  ['On sale', 'Accepted units go on sale. Bulkimart packs and ships every order for you.'],
];
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `shp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const postJson = async (path, payload) => {
  const response = await boundedFetch(apiUrl(path), { method: 'POST', headers: headers(), body: JSON.stringify(payload || {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'That did not work. Try again.');
  return body;
};

/** "I've sent stock": the seller tells Bulkimart what is on its way. Information only; stock comes from the warehouse count. */
function SentStockForm({ products, warehouses, onDone, onClose }) {
  const blank = () => ({ productId: '', variantId: '', qty: '' });
  const [form, setForm] = useState(() => ({ key: newKey(), warehouseId: warehouses[0]?._id || '', courier: '', trackingNo: '', invoiceNo: '', expectedBy: '', note: '', lines: [blank()] }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setLine = (i, k, v) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'productId' ? { variantId: (products.find((p) => p._id === v)?.variantOptions || []).length === 1 ? products.find((p) => p._id === v).variantOptions[0]._id : '' } : {}) } : l)) }));
  const ready = form.warehouseId && form.lines.every((l) => l.productId && l.variantId && Number.isInteger(Number(l.qty)) && Number(l.qty) > 0);
  // Variant ids come from the server (variantOptions); an older server does not send them.
  const serverOutdated = products.some((p) => !Array.isArray(p.variantOptions));
  const missing = !form.warehouseId ? 'Choose the warehouse you sent it to.' : form.lines.some((l) => !l.productId) ? 'Choose the product.'
    : form.lines.some((l) => !l.variantId) ? 'Choose the variant.' : form.lines.some((l) => !(Number.isInteger(Number(l.qty)) && Number(l.qty) > 0)) ? 'Enter the quantity you sent (1 or more).' : null;
  const submit = async () => {
    setBusy(true); setError('');
    try {
      await postJson('/api/sellers/fbb/shipments', { idempotencyKey: form.key, warehouseId: form.warehouseId, courier: form.courier, trackingNo: form.trackingNo, invoiceNo: form.invoiceNo,
        expectedBy: form.expectedBy || undefined, note: form.note, lines: form.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: Number(l.qty) })) });
      await onDone('Bulkimart has been told your stock is on the way.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="sfbb-form">
      <h4>What did you send?</h4>
      {warehouses.length > 1 && (
        <label className="sfbb-field">Sent to<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} disabled={busy}>
          {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</select></label>
      )}
      {form.lines.map((l, i) => {
        const product = products.find((p) => p._id === l.productId);
        return (
          <div key={i} className="sfbb-line">
            <label className="sfbb-field">Product<select value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)} disabled={busy}>
              <option value="">Choose…</option>{products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
            {(product?.variantOptions?.length || 0) > 1 && (
              <label className="sfbb-field">Variant<select value={l.variantId} onChange={(e) => setLine(i, 'variantId', e.target.value)} disabled={busy}>
                <option value="">Choose…</option>{product.variantOptions.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}</select></label>
            )}
            <label className="sfbb-field sfbb-qty">Quantity<input type="number" min="1" step="1" inputMode="numeric" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} disabled={busy} placeholder="50" /></label>
            {form.lines.length > 1 && <button type="button" className="sfbb-link" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })} disabled={busy}>Remove</button>}
          </div>
        );
      })}
      {form.lines.length < products.length && <button type="button" className="sfbb-link" onClick={() => setForm({ ...form, lines: [...form.lines, blank()] })} disabled={busy}>+ Add another product</button>}
      <h4>Delivery details <span className="sfbb-optional">(optional, but helps the warehouse)</span></h4>
      <div className="sfbb-grid">
        <label className="sfbb-field">Courier<input value={form.courier} maxLength={80} onChange={(e) => setForm({ ...form, courier: e.target.value })} disabled={busy} placeholder="e.g. DTDC, own vehicle" /></label>
        <label className="sfbb-field">Tracking / LR number<input value={form.trackingNo} maxLength={80} onChange={(e) => setForm({ ...form, trackingNo: e.target.value })} disabled={busy} /></label>
        <label className="sfbb-field">Invoice / challan number<input value={form.invoiceNo} maxLength={80} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} disabled={busy} /></label>
        <label className="sfbb-field">Expected arrival<input type="date" value={form.expectedBy} onChange={(e) => setForm({ ...form, expectedBy: e.target.value })} disabled={busy} /></label>
      </div>
      <label className="sfbb-field">Note<input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} disabled={busy} placeholder="e.g. 3 boxes" /></label>
      {serverOutdated ? <p role="status" className="sfbb-error">Bulkimart is updating this feature. Please try again later or tell Bulkimart support what you sent.</p>
        : missing && <p className="sfbb-optional" style={{ margin: 0 }}>To continue: {missing}</p>}
      {error && <p role="alert" className="sfbb-error">{error}</p>}
      <div className="sfbb-actions">
        <button type="button" className="primary-onboarding-btn" onClick={submit} disabled={busy || !ready || serverOutdated}>{busy ? 'Sending…' : 'Tell Bulkimart'}</button>
        <button type="button" className="order-action-btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

/** How to send stock: steps, where to send it, the "I've sent stock" notice and where each FBB product stands. */
function SendStockGuide({ data, onChanged }) {
  const products = data.products || [];
  const warehouses = data.warehouses || [];
  const shipments = data.shipments || [];
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const waiting = products.filter((p) => p.stage === 'waiting_for_stock' || p.stage === 'out_of_stock');
  const canSend = data.available && products.length > 0 && warehouses.length > 0;
  const cancel = async (s) => {
    if (!window.confirm(`Cancel shipment ${s.shipmentNo}? Only do this if you did not send it.`)) return;
    setBusyId(s._id); setNotice('');
    try { await postJson(`/api/sellers/fbb/shipments/${s._id}/cancel`); setNotice('Shipment cancelled.'); await onChanged(); }
    catch (e) { setNotice(e.message); } finally { setBusyId(''); }
  };
  return (
    <>
      <h3>How to send stock</h3>
      <ol className="sfbb-steps">
        {STEPS.map(([title, text], i) => <li key={title}><span className="sfbb-num">{i + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}
      </ol>

      <h3>Send your stock to</h3>
      {warehouses.length === 0 ? <p>No Bulkimart warehouse is open right now. Contact Bulkimart support before sending stock.</p> : (
        <div className="sfbb-warehouses">
          {warehouses.map((w) => (
            <div key={w._id} className="sfbb-warehouse">
              <strong>{w.name}</strong>
              <span>{[w.address?.line1, w.address?.line2, w.address?.city, w.address?.state, w.address?.pincode].filter(Boolean).join(', ')}</span>
              {w.phone && <span>Phone: <a href={`tel:${w.phone}`}>{w.phone}</a></span>}
              <span className="sfbb-hint">Write <b>{data.sellerName || 'your store name'}</b> and warehouse code <b>{w.code}</b> on every box, and put the invoice or challan inside.</span>
            </div>
          ))}
        </div>
      )}

      {canSend && (open
        ? <SentStockForm products={products} warehouses={warehouses} onClose={() => setOpen(false)} onDone={async (msg) => { setOpen(false); setNotice(msg); await onChanged(); }} />
        : <button type="button" className="primary-onboarding-btn sfbb-send-btn" onClick={() => { setOpen(true); setNotice(''); }}>📦 I’ve sent stock</button>)}
      {notice && <p role="status" className="sfbb-notice">{notice}</p>}

      {shipments.length > 0 && (
        <>
          <h3>Your shipments</h3>
          <div className="sfbb-products">
            {shipments.map((s) => {
              const [label, tone] = SHIPMENT_STATUS[s.status] || [s.status, ''];
              return (
                <div key={s._id} className="sfbb-product">
                  <div className="sfbb-product-body">
                    <strong>{s.shipmentNo}</strong>
                    <span>{s.lines.map((l) => `${l.qty} × ${l.productName}${l.variantName && l.variantName !== 'Default' ? ` (${l.variantName})` : ''}`).join(', ')}</span>
                    <span>Sent {date(s.createdAt)}{s.courier ? ` · ${s.courier}` : ''}{s.trackingNo ? ` ${s.trackingNo}` : ''}{s.status === 'received' && s.receivedAt ? ` · received ${date(s.receivedAt)}` : ''}</span>
                  </div>
                  <span className={`sfbb-badge ${tone}`}>{label}</span>
                  {s.status === 'in_transit' && <button type="button" className="sfbb-link" disabled={busyId === s._id} onClick={() => cancel(s)}>Cancel</button>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3>Your FBB products {waiting.length > 0 && <span className="sfbb-badge is-warn">{waiting.length} need stock</span>}</h3>
      {products.length === 0 ? <p>You have no FBB products yet. Add a product and choose “Fulfilled by Bulkimart” as the delivery method.</p> : (
        <div className="sfbb-products">
          {products.map((p) => {
            const [label, tone, help] = STAGES[p.stage] || [p.stage, '', ''];
            return (
              <div key={p._id} className="sfbb-product">
                {p.image ? <img src={p.image} alt="" /> : <span className="sfbb-ph" aria-hidden="true">📦</span>}
                <div className="sfbb-product-body">
                  <strong>{p.name}</strong>
                  <span>{p.variants.join(', ') || 'Single variant'} · added {date(p.addedAt)}{p.listing === 'pending' ? ' · waiting for listing approval' : p.listing === 'draft' ? ' · draft' : ''}</span>
                  {p.stage === 'on_sale' ? <span>{p.forSale} for sale{p.reserved ? ` · ${p.reserved} in orders` : ''}{p.onTheWay ? ` · ${p.onTheWay} on the way` : ''}</span>
                    : p.stage === 'on_the_way' ? <span>{p.onTheWay} units on the way to the warehouse</span> : help && <span>{help}</span>}
                </div>
                <span className={`sfbb-badge ${tone}`}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function FbbTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try { setData(await loadFbb()); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const pay = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await boundedFetch(apiUrl('/api/sellers/fbb/payments'), { method: 'POST', headers: headers(), body: JSON.stringify({ amount: Number(amount) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not start the payment');
      if (body.data.status !== 'paid') {
        const result = await openRazorpayCheckout(body.data.checkout, headers());
        setMessage(result.ok ? 'Payment verified.' : result.message || 'Payment pending. Check again before retrying.');
      }
      setAmount('');
      await refresh();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };

  if (error) return <section className="seller-tab-panel"><h2>Fulfilled by Bulkimart</h2><p role="alert">{error}</p><button type="button" className="order-action-btn-sm" onClick={refresh}>Try again</button></section>;
  if (!data) return <section className="seller-tab-panel"><h2>Fulfilled by Bulkimart</h2><p>Loading…</p></section>;
  const { obligation, stock, receipts, charges, rates } = data;
  const outstanding = Number(obligation.outstanding || 0);

  return (
    <section className="seller-tab-panel" aria-label="Fulfilled by Bulkimart">
      <h2>Fulfilled by Bulkimart</h2>
      <p>Bulkimart stores, packs and ships these products from its warehouse. Stock here changes only when the warehouse receives, sells or inspects returned units; ask Bulkimart support for any correction.</p>
      {!data.available && <p role="status">Fulfilled by Bulkimart is closed to new listings and orders right now. Existing stock, orders and charges continue as usual.</p>}

      <SendStockGuide data={data} onChanged={refresh} />

      <h3>What you owe</h3>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        {[['Charged', obligation.charged], ['Reversed', obligation.reversed], ['Paid in advance', obligation.paidInAdvance], ['Deducted from earnings', obligation.settledFromEarnings], ['Outstanding', obligation.outstanding], ['Advance credit', obligation.advanceCredit]]
          .map(([label, value]) => <div key={label}><dt style={{ fontSize: 12 }}>{label}</dt><dd style={{ fontWeight: 700 }}>{money(value)}</dd></div>)}
      </dl>
      <p style={{ fontSize: 12 }}>Anything outstanding is deducted from your eligible earnings before your next payout. You can also pay it now.</p>
      {outstanding > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>Amount (₹) <input type="number" min="1" max={outstanding} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></label>
          <button type="button" className="order-action-btn-sm" onClick={() => setAmount(String(outstanding))} disabled={busy}>Full amount</button>
          <button type="button" className="primary-onboarding-btn" onClick={pay} disabled={busy || !(Number(amount) > 0) || Number(amount) > outstanding}>{busy ? 'Processing…' : 'Pay now'}</button>
        </div>
      )}
      {message && <p role="status">{message}</p>}

      <h3>Current rates</h3>
      <FbbChargeSummary preview={rates} />

      <h3>Warehouse stock</h3>
      {stock.length === 0 ? <p>No stock in the warehouse yet.</p> : (
        <table className="seller-table"><thead><tr><th>Product</th><th>Variant</th><th>Warehouse</th><th>For sale</th><th>Reserved for orders</th><th>Returned, awaiting inspection</th><th>Damaged</th></tr></thead>
          <tbody>{stock.map((row) => <tr key={`${row.productId}:${row.variantId}:${row.warehouse?._id}`}><td>{row.productName}</td><td>{row.variantName || '—'}</td><td>{row.warehouse?.name}</td><td>{row.sellable}</td><td>{row.reserved}</td><td>{row.quarantine || 0}</td><td>{row.damaged}</td></tr>)}</tbody>
        </table>
      )}

      <h3>Receipts</h3>
      {receipts.length === 0 ? <p>No receipts yet.</p> : receipts.map((receipt) => (
        <details key={receipt._id} style={{ marginBottom: 6 }}>
          <summary>{receipt.receiptNo} · {receipt.status === 'posted' ? `received ${date(receipt.postedAt)}` : 'being checked'} · {receipt.warehouseId?.name}</summary>
          <table className="seller-table"><thead><tr><th>Product</th><th>Expected</th><th>Received</th><th>Accepted</th><th>Damaged</th><th>Rejected</th><th>Missing</th><th>Note</th></tr></thead>
            <tbody>{receipt.lines.map((line) => <tr key={line._id}><td>{line.productName} {line.variantName ? `(${line.variantName})` : ''}</td><td>{line.expectedQty}</td><td>{line.receivedQty}</td><td>{line.acceptedQty}</td><td>{line.damagedQty}</td><td>{line.rejectedQty}</td><td>{line.missingQty}</td><td>{line.note || ''}</td></tr>)}</tbody>
          </table>
          <p style={{ fontSize: 12 }}>Only accepted units are for sale and charged storage.</p>
        </details>
      ))}

      <h3>Charges</h3>
      {charges.rows.length === 0 ? <p>No charges yet.</p> : (
        <table className="seller-table"><thead><tr><th>Date</th><th>Charge</th><th>For</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{charges.rows.map((row) => <tr key={row._id}><td>{date(row.createdAt)}</td><td>{CHARGE_LABEL[row.type] || row.type}</td><td>{row.orderId?.orderNo || row.receiptId?.receiptNo || '—'}</td><td>{row.qty}</td><td>{money(row.rate)}</td><td>{money(row.amount)}</td><td>{row.status === 'reversed' ? 'Reversed' : 'Charged'}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
