import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';
import { openRazorpayCheckout } from '../../../utils/razorpayCheckout';
import { FbbChargeSummary } from './DeliveryMethodField';

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
