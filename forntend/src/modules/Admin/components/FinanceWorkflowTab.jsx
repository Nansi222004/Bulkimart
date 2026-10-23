import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPost, adminPatch, adminGetBlob } from '../../../utils/adminApi';
import './FinanceWorkflow.css';
import FinanceReview from './FinanceReview';
import CommissionSimulation from './CommissionSimulation';

const rupees = paise => typeof paise === 'number' && Number.isFinite(paise) ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
const empty = { channel: 'ecommerce', vendorType: 'general', method: 'percentage', value: '', minimum: '', maximum: '',
  categoryId: '', productId: '', taxTreatment: '', taxRate: '', effectiveDate: '', isActive: false, reason: '' };

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
      await adminPost('/finance/commissions', { ...draft, value: Number(draft.value), taxRate: Number(draft.taxRate),
        minimum: draft.minimum === '' ? null : Number(draft.minimum), maximum: draft.maximum === '' ? null : Number(draft.maximum),
        effectiveDate: new Date(draft.effectiveDate).toISOString(), supersedes: parent?._id || null,
        base: 'eligible_item_subtotal', fixedScope: 'order_item' });
      setDraft(empty); setReview(false);
    });
  };
  const submitAction = event => {
    event.preventDefault();
    perform(async () => {
      if (tab === 'payouts') await adminPatch(`/delivery-payouts/${selection._id}/${action}`, { reason: proof.reason, verified: proof.verified, transactionRef: proof.reference });
      else await adminPost(`/finance/orders/${selection._id}/${action}`, { expectedRevision: selection.financialRevision || 0, amount: Number(proof.amount), reference: proof.reference, reason: proof.reason });
      setSelection(null);
    });
  };
  const exportCsv = () => perform(async () => {
    const { blob, filename } = await adminGetBlob(`/finance/orders?${query()}&export=csv`);
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename.endsWith('.csv') ? filename : 'financial-orders.csv'; link.click(); URL.revokeObjectURL(url);
  });
  const choose = (row, kind) => { setSelection(row); setAction(kind); setProof({ amount: '', reference: '', reason: '', verified: false }); };
  const changeTab = value => { setTab(value); setPage(1); setRows([]); setStatus(''); };
  return <section className="finance-workflow">
    <h2>{tab === 'commissions' ? 'Vendor Commission' : tab === 'payouts' ? 'Rider payouts' : tab === 'cod' ? 'COD reconciliation' : tab === 'ledger' ? (account === 'rider_payable' ? 'Delivery partner earnings' : 'Ledger & accounts') : 'Commission history'}</h2>
    <p>Review commission policy, verified cash, held earnings and settlement evidence.</p>
    <div className="finance-notice">{operational ? 'Financial operations enabled under recorded release approvals.' : 'New financial operations are disabled pending policy and end-to-end approval. Configuration saves are available.'}</div>
    {!hideNavigation && <nav aria-label="Finance views">{[['commissions','Vendor commissions'],['orders','Commission history'],['cod','COD reconciliation'],['ledger','Ledger & accounts'],['payouts','Rider payouts']].map(([value, label]) => <button type="button" aria-pressed={tab === value} key={value} onClick={() => changeTab(value)}>{label}</button>)}</nav>}
    {message && <p role="status" className="finance-notice">{message}</p>}
    {tab === 'commissions' ? <>
      {review ? <FinanceReview title={draft.isActive ? "Review enabled commission version" : "Review disabled commission version"} values={{Channel: draft.channel, Vendor: draft.vendorType, Method: draft.method, Value: `${draft.value} ${draft.method === 'fixed' ? 'INR / order item' : '%'}`, Minimum: draft.minimum || 'None', Maximum: draft.maximum || 'None', Tax: `${draft.taxTreatment} ${draft.taxRate}%`, Effective: draft.effectiveDate, Category: draft.categoryId || 'All', Product: draft.productId || 'All', Status: draft.isActive ? 'Enabled for future snapshots; release gates still apply' : 'Disabled version; supersedes its scope at the effective date', Reason: draft.reason}} busy={busy} onConfirm={() => saveRule({preventDefault(){}})} onCancel={() => setReview(false)} /> : <form onSubmit={saveRule} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')} className="finance-panel">
        <h3>New commission version</h3><p>Saving creates an effective version, not a separate draft. A disabled successor supersedes the same scope at its effective date and can stop that rule applying to future snapshots. Live postings remain separately gated.</p><p>Affects seller earnings and platform commission revenue. Bulkimart retains commission from eligible merchandise sales under the approved rule.</p><p>Calculation base: eligible item subtotal after allocated discounts. Delivery charges, tips and donations are excluded. A fixed value applies once per order item.</p>
        <div className="finance-grid">
          <label>Channel<select value={draft.channel} onChange={e => setDraft({ ...draft, channel: e.target.value })}><option value="ecommerce">E-Commerce</option><option value="quick">Quick Commerce</option><option value="wholesale">Wholesale</option></select></label>
          <label>Vendor type<select value={draft.vendorType} onChange={e => setDraft({ ...draft, vendorType: e.target.value })}><option value="general">General</option><option value="shg">SHG</option></select></label>
          <label>Commission method<select value={draft.method} onChange={e => setDraft({ ...draft, method: e.target.value })}><option value="percentage">Percentage</option><option value="fixed">Fixed INR</option></select></label>
          {['value'].map(key => <label key={key}>{({ value: 'Approved value', minimum: 'Minimum INR (optional)', maximum: 'Maximum INR (optional)', taxRate: 'Approved tax rate (%)' })[key]}<input type="number" min="0" step="0.01" max={draft.method === 'percentage' ? 100 : undefined} required={key === 'value' || key === 'taxRate'} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /><small>{draft.method === 'fixed' ? 'INR retained once per order item, regardless of quantity.' : 'Percentage of the eligible item subtotal retained as commission.'}</small></label>)}
          <details className="finance-advanced" open={undefined}><summary>Advanced options — limits, tax and scope</summary><div className="finance-grid">{['minimum','maximum','taxRate'].map(key => <label key={key}>{({minimum:'Minimum INR (optional)',maximum:'Maximum INR (optional)',taxRate:'Approved tax rate (%)'})[key]}<input type="number" min="0" max={key === 'taxRate' ? 100 : undefined} step="0.01" required={key === 'taxRate'} value={draft[key]} onChange={e => setDraft({...draft,[key]:e.target.value})} /></label>)}<label>Tax treatment<select required value={draft.taxTreatment} onChange={e => setDraft({ ...draft, taxTreatment: e.target.value })}><option value="">Choose approved treatment</option>{['exclusive','inclusive','exempt'].map(value => <option key={value}>{value}</option>)}</select></label>
          {['categoryId','productId'].map(key => <label key={key}>{key === 'categoryId' ? 'Category ID override (optional)' : 'Product ID override (optional)'}<input value={draft[key]} pattern="[a-fA-F0-9]{24}" onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
        </div></details><label>Effective date and time<input required type="datetime-local" value={draft.effectiveDate} onChange={e => setDraft({...draft,effectiveDate:e.target.value})} /><small>Local time; saved as UTC. Applies to future order snapshots.</small></label>
          <label>Change reason<input required minLength={5} maxLength={500} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
        </div>
        <label className="finance-check"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Enable this rule for future snapshots when snapshotting is enabled</label>
        <button disabled={busy} type="submit">Review new version</button>
      </form>}
      <CommissionSimulation rule={draft} />
      <div className="finance-panel"><h3>Configuration history</h3><p>Product overrides take precedence over category overrides, then the channel rule. Disabled versions supersede the same scope. Historical snapshots stay frozen. Legacy commission rates are excluded; they are not approved finance rules. Discount funding policy must be approved separately.</p>
        {rules.length ? rules.map(rule => <details key={rule._id}><summary>{rule.channel} · {rule.method} {rule.value} · {!rule.isActive ? 'Disabled' : new Date(rule.effectiveDate) > new Date() ? 'Scheduled' : !flags.snapshots ? 'Blocked by release prerequisites' : 'Active for new snapshots'} · {new Date(rule.effectiveDate).toLocaleString()}</summary><p>Version: {rule.version}<br />Tax: {rule.taxTreatment} {rule.taxRate}%<br />Actor: {rule.createdBy}<br />Reason: {rule.reason}<br />Product: {rule.productId || 'All'} · Category: {rule.categoryId || 'All'}</p><button type="button" onClick={() => setDraft({ ...empty, ...rule, categoryId: rule.categoryId || '', productId: rule.productId || '', minimum: rule.minimum ?? '', maximum: rule.maximum ?? '', effectiveDate: '', reason: '' })}>Prepare next version</button></details>) : <p>Not configured. No versioned rules. No commission rate is assumed.</p>}
      </div>
    </> : <>
      {['cod','orders'].includes(tab) && <form className="finance-panel finance-grid" onSubmit={event => { event.preventDefault(); setPage(1); perform(load); }}>
        <label>Order reference<input value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label>COD state<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{['expected','collected','remittance_reported','verified','allocated','discrepancy','disputed'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button disabled={busy}>Search</button><button disabled={busy} type="button" onClick={exportCsv}>Export filtered CSV</button>
      </form>}
      {tab === 'ledger' && account === 'rider_payable' && <p>Account totals combine all delivery partners within the queried records. Each entry retains its partner, delivery and order references; held, eligible, reserved and settled buckets remain separate.</p>}
      {tab === 'ledger' && <div className="finance-grid">{balances.map(row => <div className="finance-panel" key={`${row._id.account}:${row._id.bucket}`}><strong>{row._id.account}</strong><p>{row._id.bucket}: {rupees(Math.round(row.amount * 100))}</p></div>)}</div>}
      {tab === 'ledger' && report && <div className="finance-panel"><h3>Reconciliation exceptions</h3><p>{report.coverage.ordersChecked} of {report.coverage.totalOrders} versioned orders checked on this page. Up to {report.coverage.maxRiders} riders checked; historical orders are excluded.</p>
        {report.exceptions.map((row,index) => <p key={index}>{row.orderNo || row.partnerId} · {row.code} · {row.detail}</p>)}
        {report.negativeBalances.map((row,index) => <p key={`negative-${index}`}>Negative {row._id.account} / {row._id.bucket} balance: {rupees(row.amount * 100)} · {row._id.sellerId || row._id.partnerId}</p>)}
        {report.duplicateEventKeys.map(row => <p key={row._id}>Duplicate financial event {row._id}: {row.count} records</p>)}
        {!report.exceptions.length && !report.negativeBalances.length && !report.duplicateEventKeys.length && <p>No exceptions found within the stated coverage.</p>}
      </div>}
      {tab === 'ledger' && !account && <form className="finance-panel" onSubmit={event => { event.preventDefault(); perform(async () => { if (!refundPreview) { const response = await adminGet(`/finance/returns/${refundId}/preview`); setRefundPreview(response.data); return; } await adminPost(`/finance/returns/${refundId}/reverse`, { ...refundProof, expectedRevision: refundPreview.expectedRevision }); setRefundId(''); setRefundPreview(null); }); }}><h3>Refund compensation</h3><p>Use a completed, verified refund. The server calculates the adjustment from its frozen item allocation and retains the original ledger entries.</p><label>Completed refund Return ID<input required pattern="[a-fA-F0-9]{24}" value={refundId} onChange={e => { setRefundId(e.target.value); setRefundPreview(null); }} /></label><label>Refund evidence reference<input required minLength={4} value={refundProof.reference} onChange={e => setRefundProof({ ...refundProof, reference: e.target.value })} /></label><label>Compensation reason<input required minLength={5} value={refundProof.reason} onChange={e => setRefundProof({ ...refundProof, reason: e.target.value })} /></label>{refundPreview && <p role="status">{refundPreview.orderNo} · Seller {refundPreview.sellerId} · Policy {refundPreview.policyVersion} · Compensation {rupees(refundPreview.sellerCompensationPaise)} INR. {refundPreview.consequence}</p>}<button disabled={busy || !operational}>{refundPreview ? 'Confirm reviewed refund compensation' : 'Preview refund compensation'}</button></form>}
      <div className="finance-table" role="region" tabIndex={0} aria-label="Finance records"><table><thead><tr>{(tab === 'ledger' ? ['Event','Account','Bucket','Amount','Reference'] : tab === 'payouts' ? ['Rider','Amount','Status','Evidence','Action'] : ['Order','Order state','Expected COD','Collected / reported / verified','Finance state','Details & actions']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {rows.map(row => tab === 'ledger' ? <tr key={row._id}><td>{row.description}</td><td>{row.account || 'seller_payable'}</td><td>{row.bucket}</td><td>{row.direction === 'debit' ? '−' : '+'}{rupees(row.amount * 100)}</td><td>{row.reference || row.idempotencyKey}<br />Partner: {row.partnerId || '—'}<br />Order: {row.orderId || '—'}<br />Delivery: {row.deliveryId || '—'}</td></tr> : tab === 'payouts' ? <tr key={row._id}><td>{row.partnerId?.userId?.name || row.partnerId?._id}</td><td>{rupees(row.amount * 100)}</td><td>{row.status}</td><td>{row.transactionRef || 'No verified transfer recorded'}</td><td>{row.status === 'pending' && row.financeVersion === 2 && <><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'complete')}>Reconcile paid transfer</button><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'reject')}>Reject request</button></>}</td></tr> : <tr key={row._id}>
          <td>{row.orderNo}</td><td>{row.status}</td><td>{row.paymentMethod === 'cod' ? rupees(row.cash.expectedPaise) : 'Prepaid'}</td><td>{row.paymentMethod === 'cod' ? `${rupees(row.cash.collectedPaise)} / ${rupees(row.cash.reportedPaise)} / ${rupees(row.cash.verifiedPaise)}` : '—'}</td><td>{row.cash.status} · {row.financialPosting || 'unposted'}<br />{row.exceptions.join(', ')}</td>
          <td><details><summary>Financial details</summary>{row.financialSnapshot.lines.map(line => <p key={line.itemId}>Item {line.itemId} · Seller {line.sellerId} · INR<br />Subtotal {rupees(line.grossPaise)} · Eligible {rupees(line.eligiblePaise)}<br />Commission {line.rule ? rupees(line.commissionPaise) : 'Rule missing'} · Tax {rupees(line.taxPaise)} · Net {line.rule ? rupees(line.netPaise) : 'Held'}<br />Rule {line.rule?.version || 'Missing'}{line.blocker && <><br />Held: {line.blocker}</>}</p>)}{row.codFinance?.events.map((entry,index) => <p key={index}>{entry.action} · {rupees(entry.amountPaise)} · {entry.reference} · {entry.reason} · {entry.actorId}</p>)}</details>
            {['remittance_reported','discrepancy','disputed'].includes(row.cash.status) && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/verify')}>Verify cash evidence</button>}
            {row.paymentMethod === 'cod' && row.cash.status !== 'expected' && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/dispute')}>Record cash dispute</button>}
            <button disabled={busy || !operational} onClick={() => choose(row, row.financialPosting === 'held' ? 'release' : 'allocate')}>{row.financialPosting === 'held' ? 'Release seller hold' : 'Allocate verified funds'}</button>
            <button disabled={busy || !operational} onClick={() => choose(row, 'release-rider')}>Release rider hold</button>
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={6}>{busy ? 'Loading…' : 'No persisted records match this view.'}</td></tr>}
      </tbody></table></div>
      <div className="finance-pagination"><button disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={busy || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      {selection && <form className="finance-panel" onSubmit={submitAction}><h3>{action} · {selection.orderNo || selection._id}</h3>
        <p>Confirm only after reviewing the supporting records. Cash verification requires evidence of the actual handover; a rider report alone is insufficient.</p>
        {action.startsWith('cod/') && <label>{action === 'cod/verify' ? 'Amount physically verified (INR)' : 'Expected order amount under dispute (INR)'}<input required type="number" min="0" step="0.01" value={proof.amount} onChange={e => setProof({ ...proof, amount: e.target.value })} /></label>}
        {<><label>Evidence / bank transaction reference<input required={action !== 'reject'} minLength={4} value={proof.reference} onChange={e => setProof({ ...proof, reference: e.target.value })} /></label><label>Reconciliation reason<input required minLength={5} value={proof.reason} onChange={e => setProof({ ...proof, reason: e.target.value })} /></label></>}
        {action === 'complete' && <label className="finance-check"><input required type="checkbox" checked={proof.verified} onChange={e => setProof({ ...proof, verified: e.target.checked })} />I independently verified the successful bank transfer</label>}
        <button disabled={busy}>Confirm reviewed action</button><button type="button" disabled={busy} onClick={() => setSelection(null)}>Cancel</button>
      </form>}
    </>}
  </section>;
}
