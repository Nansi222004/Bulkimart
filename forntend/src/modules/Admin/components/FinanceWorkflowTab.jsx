import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPost, adminPatch, adminGetBlob } from '../../../utils/adminApi';
import './FinanceWorkflow.css';
import FinanceReview from './FinanceReview';
import CommissionSimulation from './CommissionSimulation';
import { hint, label, COD_STATUS, POSTING, BUCKET, ACCOUNT, EXCEPTION } from './financeText';

const rupees = paise => typeof paise === 'number' && Number.isFinite(paise) ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
const empty = { channel: 'ecommerce', vendorType: 'general', method: 'percentage', value: '', minimum: '', maximum: '',
  categoryId: '', productId: '', taxTreatment: '', taxRate: '', effectiveDate: '', isActive: false, reason: '' };
const titles = { commissions: 'Commission', orders: 'All orders', cod: 'COD cash', ledger: 'Ledger & checks', payouts: 'Rider payouts' };
const subtitles = {
  commissions: 'Set platform commission charged on vendor sales. Sellers receive their full price, and discounts are funded by the platform.',
  orders: 'Every order with its financial breakdown. Earnings calculate automatically once payment or COD cash is verified.',
  cod: 'Cash on Delivery tracking: Rider collects at doorstep → Rider deposits cash → Admin confirms amount received. Delivery alone does not prove payment.',
  ledger: 'Every money entry, grouped by account, plus automatic checks that flag anything that does not add up.',
  payouts: 'Rider withdrawal requests. Send the money by bank/UPI first, then record the bank reference here.',
  riders: 'What each rider has earned. “On hold” becomes “Available to pay” once the order’s payment or COD cash is confirmed.',
};
const actionTitles = { 'cod/verify': 'Confirm cash received', 'cod/dispute': 'Record a cash dispute', 'cod/writeoff': 'Write off cash shortage', allocate: 'Add earnings now', release: 'Release seller earnings now', 'release-rider': 'Release rider earning now', complete: 'Mark rider payout as paid', reject: 'Reject rider payout' };

export default function FinanceWorkflowTab({ initialTab = 'commissions', hideNavigation = false, account = '' } = {}) {
  const generation = useRef(0);
  const mutationLock = useRef(false);
  const [refundPreview, setRefundPreview] = useState(null), [refundProof, setRefundProof] = useState({ reason: '', reference: '' });
  const [review, setReview] = useState(false);
  const [tab, setTab] = useState(initialTab), [rules, setRules] = useState([]), [flags, setFlags] = useState({});
  const [draft, setDraft] = useState(empty), [rows, setRows] = useState([]), [balances, setBalances] = useState([]);
  const [report, setReport] = useState(null);
  const [refundId, setRefundId] = useState('');
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [search, setSearch] = useState('');
  const [status, setStatus] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [selection, setSelection] = useState(null);
  const [action, setAction] = useState(''), [proof, setProof] = useState({ amount: '', reference: '', reason: '', verified: false });
  const operational = flags.operations && flags.policyApproved && flags.testsApproved;
  const payoutsEnabled = flags.payouts && flags.policyApproved && flags.testsApproved;
  const riderView = tab === 'ledger' && account === 'rider_payable';
  const query = () => new URLSearchParams({ page, q: search, ...(tab === 'cod' ? { cod: 'true' } : {}), ...(status ? { status } : {}), ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}) });
  const load = async () => {
    const currentGeneration = ++generation.current;
    const config = await adminGet('/finance/commissions');
    if (currentGeneration !== generation.current) return;
    setFlags(config.data.flags); setRules(config.data.rules);
    if (tab === 'ledger') {
      const [result, reconciliation] = await Promise.all([adminGet(`/finance/ledger?page=${page}&account=${encodeURIComponent(account)}`), adminGet(`/finance/reconciliation?page=${page}`)]);
      if (currentGeneration !== generation.current) return;
      setReport(reconciliation.data);
      setRows(result.data.rows); setBalances(result.data.balances); setPages(Math.max(1, Math.ceil(result.data.total / result.data.limit)));
    } else if (tab === 'payouts') {
      const result = await adminGet(`/delivery-payouts?page=${page}`);
      if (currentGeneration !== generation.current) return;
      setRows(result.data); setPages(Math.max(1, result.meta.pages));
    } else if (tab !== 'commissions') {
      const result = await adminGet(`/finance/orders?${query()}`);
      if (currentGeneration !== generation.current) return;
      setRows(result.data); setPages(Math.max(1, result.meta.pages));
    }
  };
  useEffect(() => {
    let active = true;
    setBusy(true); setMessage(''); setSelection(null);
    load().catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; generation.current++; };
  }, [tab, page]);
  const perform = async work => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setMessage('');
    try { await work(); await load(); setMessage('Saved and reloaded from the server.'); }
    catch (error) { setMessage(error.message); setReview(false); setRefundPreview(null); }
    finally { mutationLock.current = false; setBusy(false); }
  };
  const saveRule = event => {
    event.preventDefault();
    if (draft.method === 'percentage' && Number(draft.value) > 100) return setMessage('Commission percentage cannot exceed 100.');
    if (draft.minimum !== '' && draft.maximum !== '' && Number(draft.minimum) > Number(draft.maximum)) return setMessage('Minimum cannot exceed maximum.');
    if (!review) { setReview(true); return; }
    perform(async () => {
      const parent = rules.find(rule => rule.channel === draft.channel && rule.vendorType === draft.vendorType && (rule.categoryId || '') === draft.categoryId && (rule.productId || '') === draft.productId);
      const effectiveDate = draft.effectiveDate ? new Date(draft.effectiveDate).toISOString() : new Date().toISOString();
      const reason = draft.reason?.trim()?.length >= 5 ? draft.reason.trim() : 'Platform commission update';
      const taxTreatment = draft.taxTreatment || 'inclusive';
      const taxRate = draft.taxTreatment === 'exempt' ? 0 : (draft.taxRate !== '' ? Number(draft.taxRate) : 0);
      await adminPost('/finance/commissions', { ...draft, value: Number(draft.value), taxTreatment, taxRate,
        reason, effectiveDate,
        minimum: draft.minimum === '' ? null : Number(draft.minimum), maximum: draft.maximum === '' ? null : Number(draft.maximum),
        supersedes: parent?._id || null,
        base: 'eligible_item_subtotal', fixedScope: 'order_item' });
      setDraft(empty); setReview(false);
    });
  };
  const submitAction = event => {
    event.preventDefault();
    perform(async () => {
      const defaultRef = action === 'complete' ? 'BANK-TRANSFER' : 'ADMIN-VERIFIED';
      const defaultReason = action === 'cod/writeoff' ? 'Approved COD shortage write-off' : action === 'cod/verify' ? 'Verified cash received at cash desk' : 'Admin confirmed finance action';
      const reference = (proof.reference && proof.reference.trim()) ? proof.reference.trim() : defaultRef;
      const reason = (proof.reason && proof.reason.trim().length >= 5) ? proof.reason.trim() : defaultReason;
      if (tab === 'payouts') await adminPatch(`/delivery-payouts/${selection._id}/${action}`, { reason, verified: proof.verified, transactionRef: reference });
      else await adminPost(`/finance/orders/${selection._id}/${action}`, { expectedRevision: selection.financialRevision || 0, ...(action === 'cod/verify' ? { amount: Number(proof.amount) } : {}), reference, reason });
      setSelection(null);
    });
  };
  const exportCsv = () => perform(async () => {
    const { blob, filename } = await adminGetBlob(`/finance/orders?${query()}&export=csv`);
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename.endsWith('.csv') ? filename : 'financial-orders.csv'; link.click(); URL.revokeObjectURL(url);
  });
  const choose = (row, kind) => {
    setSelection(row);
    setAction(kind);
    const suggestedAmount = kind === 'cod/verify' && row.cash
      ? String(((row.cash.reportedPaise || row.cash.expectedPaise || 0) / 100).toFixed(2)).replace(/\.00$/, '')
      : '';
    setProof({ amount: suggestedAmount, reference: '', reason: '', verified: false });
  };
  const changeTab = value => { setTab(value); setPage(1); setRows([]); setStatus(''); };
  return <section className="finance-workflow">
    <h2>{riderView ? 'Rider balances' : titles[tab]}</h2>
    <p>{riderView ? subtitles.riders : subtitles[tab]}</p>
    <div className="finance-notice">{operational ? 'Live: earnings and payments settle automatically. You only need to act on orders flagged “Needs your review”.' : 'Money actions are switched off on the server, so buttons that move money are disabled. You can still change settings.'}</div>
    {!hideNavigation && <nav aria-label="Finance views">{[['commissions','Commission'],['orders','All orders'],['cod','COD cash'],['ledger','Ledger & checks'],['payouts','Rider payouts']].map(([value, text]) => <button type="button" aria-pressed={tab === value} key={value} onClick={() => changeTab(value)}>{text}</button>)}</nav>}
    {message && <p role="status" className="finance-notice">{message}</p>}
    {tab === 'commissions' ? <>
      {review ? <FinanceReview title={draft.isActive ? 'Review commission rule (switched on)' : 'Review commission rule (switched off)'} values={{Channel: draft.channel, Vendor: draft.vendorType, Method: draft.method, Value: `${draft.value} ${draft.method === 'fixed' ? '₹ per item' : '%'}`, Minimum: draft.minimum || 'None', Maximum: draft.maximum || 'None', GST: `${draft.taxTreatment || 'inclusive'} ${draft.taxRate || 0}%`, 'Starts from': draft.effectiveDate || 'Immediately', Category: draft.categoryId || 'All', Product: draft.productId || 'All', Status: draft.isActive ? 'On — applies to new orders from the start time' : 'Off — stops this rule for new orders from the start time', Reason: draft.reason || 'Platform commission update'}} busy={busy} onConfirm={() => saveRule({preventDefault(){}})} onCancel={() => setReview(false)} /> : <form onSubmit={saveRule} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')} className="finance-panel">
        <h3>Set Commission Rate</h3><p className="finance-muted">Set vendor commission for new orders. Past orders retain their original rate.</p>
        <div className="finance-grid">
          <label>Channel<select value={draft.channel} onChange={e => setDraft({ ...draft, channel: e.target.value })}><option value="ecommerce">E-Commerce</option><option value="quick">Quick Commerce</option><option value="wholesale">Wholesale</option></select>{hint('Store channel this commission applies to.')}</label>
          <label>Commission method<select value={draft.method} onChange={e => setDraft({ ...draft, method: e.target.value })}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed (₹ per item)</option></select>{hint(draft.method === 'fixed' ? 'Fixed fee per item line.' : 'Percentage of item sale price.')}</label>
          <label>Commission value<input type="number" min="0" step="0.01" max={draft.method === 'percentage' ? 100 : undefined} required value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} placeholder="e.g. 10" />{hint(draft.method === 'fixed' ? '₹ kept per item line.' : 'Percentage kept from each sale.', draft.method === 'fixed' ? '15 → ₹15 per item' : '10 → 10% commission')}</label>
        </div>
        <details className="finance-advanced" style={{ margin: '14px 0', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0369a1' }}>⚙️ More options (Tax, schedule & category/product overrides)</summary><div className="finance-grid" style={{ marginTop: 12 }}>
          <label>GST treatment<select value={draft.taxTreatment} onChange={e => setDraft({ ...draft, taxTreatment: e.target.value })}><option value="">Default (Inclusive)</option><option value="inclusive">Commission already includes GST</option><option value="exclusive">Add GST on top of commission</option><option value="exempt">No GST (Exempt)</option></select>{hint('GST charged on Bulkimart’s commission.')}</label>
          <label>GST rate on commission (%)<input type="number" min="0" max="100" step="0.01" value={draft.taxRate} onChange={e => setDraft({...draft,taxRate:e.target.value})} placeholder="0" />{hint('Standard GST rate (usually 18%, or 0 for exempt).', '18')}</label>
          <label>Vendor type<select value={draft.vendorType} onChange={e => setDraft({ ...draft, vendorType: e.target.value })}><option value="general">General</option><option value="shg">SHG</option></select>{hint('General sellers or self-help groups.')}</label>
          <label>Starts from<input type="datetime-local" value={draft.effectiveDate} onChange={e => setDraft({...draft,effectiveDate:e.target.value})} />{hint('Leave blank to start immediately.')}</label>
          <label>Change reason<input minLength={5} maxLength={500} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} placeholder="Optional note for change history" />{hint('Shown in the change history.', 'Standard rate update')}</label>
          <label>Minimum commission (₹, optional)<input type="number" min="0" step="0.01" value={draft.minimum} onChange={e => setDraft({...draft,minimum:e.target.value})} />{hint('Never charge less than this per item line.', '5')}</label>
          <label>Maximum commission (₹, optional)<input type="number" min="0" step="0.01" value={draft.maximum} onChange={e => setDraft({...draft,maximum:e.target.value})} />{hint('Never charge more than this per item line.', '200')}</label>
          {['categoryId','productId'].map(key => <label key={key}>{key === 'categoryId' ? 'Only for category ID (optional)' : 'Only for product ID (optional)'}<input value={draft[key]} pattern="[a-fA-F0-9]{24}" onChange={e => setDraft({ ...draft, [key]: e.target.value })} placeholder="24-character ID" />{hint(key === 'categoryId' ? 'Paste a category ID to give that category its own rate.' : 'Paste a product ID to give one product its own rate.')}</label>)}
        </div></details>
        <label className="finance-check"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Switch this rule on</label>
        {hint('Enable this rate for new orders immediately.')}
        <button disabled={busy} type="submit" style={{ marginTop: 10 }}>Review rule</button>
      </form>}
      <CommissionSimulation rule={draft} />
      <div className="finance-panel"><h3>Rule history</h3><p className="finance-muted">Newest first. Product rules win over category rules, which win over the channel rule.</p>
        {rules.length ? rules.map(rule => <details key={rule._id}><summary>{rule.channel} · {rule.method === 'fixed' ? `₹${rule.value} per item` : `${rule.value}%`} · {!rule.isActive ? 'Off' : new Date(rule.effectiveDate) > new Date() ? 'Starts later' : !flags.snapshots ? 'On (order recording is switched off on the server)' : 'On'} · {new Date(rule.effectiveDate).toLocaleString()}</summary><p>Version: {rule.version}<br />GST: {rule.taxTreatment} {rule.taxRate}%<br />Changed by: {rule.createdBy}<br />Reason: {rule.reason}<br />Product: {rule.productId || 'All'} · Category: {rule.categoryId || 'All'}</p><button type="button" onClick={() => setDraft({ ...empty, ...rule, categoryId: rule.categoryId || '', productId: rule.productId || '', minimum: rule.minimum ?? '', maximum: rule.maximum ?? '', effectiveDate: '', reason: '' })}>Copy into a new version</button></details>) : <p>No commission rules yet. Until one is switched on, delivered orders cannot add seller earnings.</p>}
      </div>
    </> : <>
      {['cod','orders'].includes(tab) && <form className="finance-panel finance-grid" onSubmit={event => { event.preventDefault(); setPage(1); perform(load); }}>
        <label>Order number<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order #" />{hint('Search by full or partial order ID.', 'ORD-20261023')}</label>
        <label>Cash status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['expected','collected','remittance_reported','verified','allocated','discrepancy','disputed'].map(value => <option key={value} value={value}>{label(COD_STATUS, value)}{value === 'allocated' ? ' (earnings added)' : ''}</option>)}</select>{hint(tab === 'cod' ? 'Filter by rider cash handover stage.' : 'Filter by cash-on-delivery stage (if COD).')}</label>
        <details className="finance-advanced" style={{ gridColumn: '1 / -1', margin: '4px 0', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', background: '#f8fafc' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0369a1', fontSize: '13px' }}>📅 Filter by date range (optional)</summary>
          <div className="finance-grid" style={{ marginTop: 10 }}>
            <label>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />{hint('Order placed on or after.')}</label>
            <label>To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />{hint('Order placed on or before.')}</label>
          </div>
        </details>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
          <button disabled={busy} type="submit">Search</button>
          {(search || status || from || to) && <button disabled={busy} type="button" onClick={() => { setSearch(''); setStatus(''); setFrom(''); setTo(''); setPage(1); perform(load); }} style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}>Clear filters</button>}
          <button disabled={busy} type="button" onClick={exportCsv} style={{ marginLeft: 'auto' }}>Download CSV</button>
        </div>
      </form>}
      {riderView && <p className="finance-muted">Totals cover all riders. Each entry below names its rider, delivery and order.</p>}
      {tab === 'ledger' && <div className="finance-grid">{balances.map(row => <div className="finance-panel" key={`${row._id.account}:${row._id.bucket}`}><strong>{label(ACCOUNT, row._id.account)}</strong><p>{label(BUCKET, row._id.bucket)}: {rupees(Math.round(row.amount * 100))}</p></div>)}</div>}
      {tab === 'ledger' && report && <div className="finance-panel"><h3>Automatic checks</h3><p className="finance-muted">{report.coverage.ordersChecked} of {report.coverage.totalOrders} recorded orders checked on this page; up to {report.coverage.maxRiders} riders checked. Old orders are excluded.</p>
        {report.exceptions.map((row,index) => <p key={index}>{row.orderNo || row.partnerId} · {row.code.replaceAll('_', ' ')} · {row.detail}</p>)}
        {report.negativeBalances.map((row,index) => <p key={`negative-${index}`}>Negative balance: {label(ACCOUNT, row._id.account)} / {label(BUCKET, row._id.bucket)} {rupees(row.amount * 100)} · {row._id.sellerId || row._id.partnerId}</p>)}
        {report.duplicateEventKeys.map(row => <p key={row._id}>Duplicate money entry {row._id}: {row.count} records</p>)}
        {!report.exceptions.length && !report.negativeBalances.length && !report.duplicateEventKeys.length && <p>Everything on this page adds up.</p>}
      </div>}
      {tab === 'ledger' && !account && <form className="finance-panel" onSubmit={event => { event.preventDefault(); perform(async () => { if (!refundPreview) { const response = await adminGet(`/finance/returns/${refundId}/preview`); setRefundPreview(response.data); return; } await adminPost(`/finance/returns/${refundId}/reverse`, { ...refundProof, expectedRevision: refundPreview.expectedRevision }); setRefundId(''); setRefundPreview(null); }); }}><h3>Take back seller earnings for a refund</h3><p className="finance-muted">Refunds are handled automatically. Use this only for a refund the automatic process flagged.</p><label>Return ID<input required pattern="[a-fA-F0-9]{24}" value={refundId} onChange={e => { setRefundId(e.target.value); setRefundPreview(null); }} />{hint('From the Returns & Refunds page. The refund must already be completed.')}</label><label>Refund reference<input required minLength={4} value={refundProof.reference} onChange={e => setRefundProof({ ...refundProof, reference: e.target.value })} />{hint('Gateway refund ID or bank reference.', 'rfnd_N3x8…')}</label><label>Reason<input required minLength={5} value={refundProof.reason} onChange={e => setRefundProof({ ...refundProof, reason: e.target.value })} />{hint('Why this is being done by hand.')}</label>{refundPreview && <p role="status">{refundPreview.orderNo} · Seller {refundPreview.sellerId} · Rule {refundPreview.policyVersion} · Seller gives back {rupees(refundPreview.sellerCompensationPaise)}. {refundPreview.consequence}</p>}<button disabled={busy || !operational}>{refundPreview ? 'Confirm' : 'Preview'}</button></form>}
      <div className="finance-table" role="region" tabIndex={0} aria-label="Finance records"><table><thead><tr>{(tab === 'ledger' ? ['Entry','Account','Status','Amount','Reference'] : tab === 'payouts' ? ['Rider','Amount','Status','Bank reference','Action'] : ['Order','Order status','Customer pays','Cash collected / handed over / received','Money status','Details & actions']).map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>
        {rows.map(row => tab === 'ledger' ? <tr key={row._id}><td>{row.description}</td><td>{label(ACCOUNT, row.account || 'seller_payable')}</td><td>{label(BUCKET, row.bucket)}</td><td>{row.direction === 'debit' ? '−' : '+'}{rupees(row.amount * 100)}</td><td>{row.reference || row.idempotencyKey}<br />Rider: {row.partnerId || '—'}<br />Order: {row.orderId || '—'}<br />Delivery: {row.deliveryId || '—'}</td></tr> : tab === 'payouts' ? <tr key={row._id}><td>{row.partnerId?.userId?.name || row.partnerId?._id}</td><td>{rupees(row.amount * 100)}</td><td>{row.status}</td><td>{row.transactionRef || 'Not paid yet'}</td><td>{row.status === 'pending' && row.financeVersion === 2 && <><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'complete')}>Mark as paid</button><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'reject')}>Reject request</button></>}</td></tr> : <tr key={row._id}>
          <td>
            <strong>{row.orderNo}</strong>
            {row.channel && <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'capitalize' }}>{row.channel}</div>}
          </td>
          <td>
            <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: '#f1f5f9', fontWeight: 500, textTransform: 'capitalize' }}>{row.status}</span>
          </td>
          <td>
            {row.paymentMethod === 'cod' ? (
              <div><strong>{rupees(row.cash.expectedPaise)}</strong> <small style={{ color: '#0369a1', fontWeight: 600 }}>cash</small></div>
            ) : (
              <div><strong>{rupees(row.cash.expectedPaise)}</strong> <small style={{ color: '#475569' }}>prepaid</small></div>
            )}
          </td>
          <td>
            {row.paymentMethod === 'cod' ? (
              <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                <div>Collected: <strong>{rupees(row.cash.collectedPaise)}</strong></div>
                <div>Handed over: <strong>{rupees(row.cash.reportedPaise)}</strong></div>
                <div>Received: <strong>{rupees(row.cash.verifiedPaise)}</strong></div>
                {row.cash.writtenOffPaise ? <div style={{ color: '#047857', fontWeight: 600 }}>+{rupees(row.cash.writtenOffPaise)} written off</div> : null}
              </div>
            ) : <span style={{ color: '#94a3b8' }}>—</span>}
          </td>
          <td>
            {row.paymentMethod === 'cod' && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, background: row.cash.status === 'discrepancy' ? '#fee2e2' : row.cash.status === 'verified' || row.cash.status === 'allocated' ? '#dcfce7' : '#e0f2fe', color: row.cash.status === 'discrepancy' ? '#991b1b' : row.cash.status === 'verified' || row.cash.status === 'allocated' ? '#166534' : '#0369a1', fontSize: '12px', fontWeight: 600 }}>
                  {label(COD_STATUS, row.cash.status)}
                </span>
              </div>
            )}
            <div style={{ fontSize: '12px' }}>{row.financialPosting ? label(POSTING, row.financialPosting) : 'Earnings not added yet'}</div>
            {row.exceptions.length > 0 && <div style={{ color: '#b91c1c', marginTop: 4 }}><strong>{row.exceptions.map(code => label(EXCEPTION, code)).join(', ')}</strong></div>}
            {row.financeAutomation?.lastError && <div style={{ color: '#475569', fontSize: '12px', marginTop: 2 }}><small>{`Why: ${row.financeAutomation.lastError}`}</small></div>}
          </td>
          <td>
            <details style={{ marginBottom: 8 }}><summary style={{ cursor: 'pointer', color: '#0369a1', fontWeight: 600, fontSize: '12px' }}>Money breakdown</summary>
              <div style={{ fontSize: '12px', marginTop: 6, padding: '6px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                {row.financialSnapshot?.lines?.map(line => <div key={line.itemId} style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid #e2e8f0' }}>
                  <strong>Item {line.itemId}</strong> · Seller {line.sellerId}<br />
                  Item price {rupees(line.grossPaise)} · Customer paid {rupees(line.eligiblePaise)}{line.platformDiscountPaise ? ` · Discount paid by Bulkimart ${rupees(line.platformDiscountPaise)}` : ''}<br />
                  Commission {line.rule ? rupees(line.commissionPaise) : 'No rule'} · GST {rupees(line.taxPaise)}{line.tcsPaise ? ` · TCS ${rupees(line.tcsPaise)}` : ''}{line.tdsPaise ? ` · TDS ${rupees(line.tdsPaise)}` : ''}<br />
                  Seller gets {line.rule ? rupees(line.netPaise) : 'On hold'} · Rule {line.rule?.version || 'none'}{line.blocker && <><br /><span style={{ color: '#dc2626' }}>On hold: {line.blocker}</span></>}
                </div>)}
                {row.codFinance?.events?.map((entry,index) => <div key={index} style={{ fontSize: '11px', color: '#475569' }}>
                  {entry.action} · {rupees(entry.amountPaise)} · {entry.reference} · {entry.reason} · {entry.actorId}
                </div>)}
              </div>
            </details>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['remittance_reported','discrepancy','disputed'].includes(row.cash.status) && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/verify')}>Confirm cash received</button>}
              {row.cash.status === 'discrepancy' && row.cash.shortagePaise > 0 && !row.cash.writtenOffPaise && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/writeoff')}>Write off shortage</button>}
              {row.paymentMethod === 'cod' && row.cash.status !== 'expected' && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/dispute')}>Record cash dispute</button>}
              {row.exceptions.includes('needs_admin_review') && !row.financialPosting && <button disabled={busy || !operational} onClick={() => choose(row, 'allocate')}>Add earnings now</button>}
              {row.exceptions.includes('needs_admin_review') && row.financialPosting === 'held' && <button disabled={busy || !operational} onClick={() => choose(row, 'release')}>Release seller earnings now</button>}
              {row.financeAutomation?.step === 'rider_release' && <button disabled={busy || !operational} onClick={() => choose(row, 'release-rider')}>Release rider earning now</button>}
            </div>
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={6}>{busy ? 'Loading…' : 'Nothing to show here.'}</td></tr>}
      </tbody></table></div>
      <div className="finance-pagination"><button disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={busy || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      {selection && <form className="finance-panel finance-review" onSubmit={submitAction}><h3>{actionTitles[action] || action} · {selection.orderNo || selection._id}</h3>
        {action === 'cod/writeoff' && <p>{`Bulkimart absorbs the ${rupees(selection.cash.shortagePaise)} shortage so the seller and rider can be paid in full. This is recorded as a COD shortage expense.`}</p>}
        {action === 'cod/dispute' && <p>Blocks payouts linked to this order until you confirm the cash again.</p>}
        {['allocate', 'release', 'release-rider'].includes(action) && <p>The automatic process stopped on this order. Check the reason shown on the order before continuing; the same server checks still apply.</p>}
        {action === 'cod/verify' && <label>Cash received (₹)<input required type="number" min="0" step="0.01" value={proof.amount} onChange={e => setProof({ ...proof, amount: e.target.value })} />{hint('What actually reached Bulkimart’s bank or cash desk, not what the rider reported. A different amount marks the order “Amount mismatch”.', String((selection.cash?.expectedPaise || 0) / 100))}</label>}
        <label>{action === 'complete' ? 'Bank reference (UTR)' : 'Evidence reference'}<input required={action !== 'reject'} minLength={4} value={proof.reference} onChange={e => setProof({ ...proof, reference: e.target.value })} placeholder={action === 'complete' ? 'e.g. UTR 412345678901' : 'e.g. Deposit slip 0098'} />{hint(action === 'complete' ? 'From your bank statement, after the transfer succeeded.' : 'Deposit slip, bank UTR or cash-desk receipt number.', action === 'complete' ? 'UTR 412345678901' : 'Deposit slip 0098')}</label>
        <label>Reason<input required minLength={5} value={proof.reason} onChange={e => setProof({ ...proof, reason: e.target.value })} placeholder={action === 'cod/writeoff' ? 'e.g. Customer paid ₹20 less' : 'e.g. Counted at cash desk'} />{hint('Kept with the order’s history.', action === 'cod/writeoff' ? 'Customer paid ₹20 less at the door' : 'Counted at the cash desk on 23 Oct')}</label>
        {action === 'complete' && <label className="finance-check"><input required type="checkbox" checked={proof.verified} onChange={e => setProof({ ...proof, verified: e.target.checked })} />I checked the bank statement: the transfer succeeded</label>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button disabled={busy} type="submit">Confirm</button>
          <button type="button" disabled={busy} onClick={() => setSelection(null)} style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}>Cancel</button>
        </div>
      </form>}
    </>}
  </section>;
}
