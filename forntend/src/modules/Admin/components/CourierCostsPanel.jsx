import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPost } from '../../../utils/adminApi';
import { hint, rupeesFromPaise as money } from './financeText';

const STATUS = { estimated: 'Estimate only', actual: 'Provider bill recorded', disputed: 'Disputed', unknown: 'No estimate' };
const SOURCES = [['provider_invoice', 'Shiprocket invoice'], ['provider_statement', 'Shiprocket billing statement'], ['provider_dashboard', 'Shiprocket dashboard billing line']];
const emptyForm = { action: 'actual', amount: '', reference: '', source: 'provider_invoice', reason: '' };

// Courier costs for platform-paid Shiprocket shipments. A quote is only an
// estimate; a cost is booked only when an admin records the provider's bill.
export default function CourierCostsPanel() {
  const generation = useRef(0);
  const [direction, setDirection] = useState('forward'), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [form, setForm] = useState(emptyForm), [message, setMessage] = useState('');
  const load = async () => {
    const current = ++generation.current;
    const result = await adminGet(`/finance/courier-costs?direction=${direction}&page=${page}`);
    if (current === generation.current) setData(result.data);
  };
  useEffect(() => { setError(''); load().catch(e => setError(e.message)); }, [direction, page]);
  const choose = (row, action) => { setSelected(row); setMessage(''); setForm({ ...emptyForm, action, amount: row.actualPaise != null ? String(row.actualPaise / 100) : '' }); };
  const submit = async event => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const target = direction === 'reverse' ? { returnId: selected.returnId } : { orderId: selected.orderId };
      if (form.action === 'actual') await adminPost('/finance/courier-costs/actual', { direction, ...target, amount: Number(form.amount), reference: form.reference.trim(), source: form.source, reason: form.reason.trim() });
      else await adminPost('/finance/courier-costs/dispute', { direction, ...target, reference: form.reference.trim(), reason: form.reason.trim() });
      setSelected(null); setMessage('Saved and reloaded from the server.'); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return <section className="finance-workflow"><h2>Courier costs</h2>
    <p>What Shiprocket actually charged for shipments Bulkimart pays for. The quote at booking is only an estimate and is never counted as a cost. Record the amount from the provider's bill; a corrected bill books only the difference. Quick Commerce freight is not listed: sellers prepay it.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" className="finance-notice">{message}</p>}
    <nav aria-label="Shipment direction">{[['forward', 'Deliveries'], ['reverse', 'Return pickups']].map(([value, text]) =>
      <button key={value} type="button" aria-pressed={direction === value} onClick={() => { setDirection(value); setPage(1); setSelected(null); }}>{text}</button>)}</nav>
    {!data ? <p role="status">Loading courier costs…</p> : <div className="finance-panel">
      <div className="finance-table" role="region" tabIndex={0} aria-label="Courier costs"><table><thead><tr>{[direction === 'reverse' ? 'Return' : 'Order', 'Shipment / AWB', 'Estimate', 'Actual', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {data.rows.map(row => <tr key={row.key}>
          <td>{row.returnNumber || row.orderNo}</td><td>{row.shipmentId}{row.awb ? ` / ${row.awb}` : ''}</td>
          <td>{row.estimatePaise == null ? '—' : money(row.estimatePaise)}</td><td>{row.actualPaise == null ? '—' : money(row.actualPaise)}</td>
          <td>{STATUS[row.status] || row.status}{row.dispute?.reason ? ` · ${row.dispute.reason}` : ''}</td>
          <td><button type="button" onClick={() => choose(row, 'actual')}>Record bill</button><button type="button" onClick={() => choose(row, 'dispute')}>Dispute</button></td>
        </tr>)}
        {!data.rows.length && <tr><td colSpan={6}>No Shiprocket shipments here yet.</td></tr>}
      </tbody></table></div>
      <div><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button> {`Page ${page} of ${pages}`} <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </div>}
    {selected && <form className="finance-panel finance-grid" onSubmit={submit}>
      <h3>{form.action === 'actual' ? `Record provider bill · ${selected.shipmentId}` : `Dispute charge · ${selected.shipmentId}`}</h3>
      {form.action === 'actual' && <>
        <label>Amount charged (₹)<input type="number" min="0" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />{hint('Exactly what the provider billed for this shipment.')}</label>
        <label>Where you confirmed it<select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>{SOURCES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      </>}
      <label>{form.action === 'actual' ? 'Bill or invoice number' : 'Dispute or ticket reference'}<input required minLength={4} maxLength={200} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></label>
      <label>Reason<input required minLength={5} maxLength={1000} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={form.action === 'actual' ? 'Matched to the June invoice' : 'Weight discrepancy raised with Shiprocket'} /></label>
      <div><button disabled={busy}>{form.action === 'actual' ? 'Save provider bill' : 'Mark disputed'}</button><button type="button" onClick={() => setSelected(null)}>Cancel</button></div>
    </form>}
  </section>;
}
