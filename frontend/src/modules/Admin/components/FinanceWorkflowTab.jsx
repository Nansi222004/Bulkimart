import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPost, adminPatch, adminGetBlob } from '../../../utils/adminApi';
import './FinanceWorkflow.css';
import ModalPortal from '../../../components/ModalPortal';
import { isTopModal } from '../../../utils/modalLayer';
import FinanceReview from './FinanceReview';
import CommissionSimulation from './CommissionSimulation';
import { hint, label, COD_STATUS, POSTING, BUCKET, ACCOUNT, EXCEPTION, CASH_ACTIVITY, ORDER_ISSUE, cashActor, cashNote } from './financeText';

const rupees = paise => typeof paise === 'number' && Number.isFinite(paise) ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—';
const empty = { channel: 'ecommerce', vendorType: 'general', method: 'percentage', value: '', minimum: '', maximum: '',
  categoryId: '', productId: '', taxTreatment: '', taxRate: '', isActive: true, reason: '' };
const CHANNEL_NAMES = { ecommerce: 'E-Commerce', quick: 'Quick Commerce', wholesale: 'Wholesale', all: 'All channels' };
const ALL_CHANNELS = ['ecommerce', 'quick', 'wholesale'];
const VENDOR_NAMES = { general: 'General sellers' };
const sameScope = (rule, scope) => rule.channel === scope.channel && rule.vendorType === scope.vendorType
  && String(rule.categoryId || '') === String(scope.categoryId || '') && String(rule.productId || '') === String(scope.productId || '');
const rateText = rule => rule.method === 'fixed' ? `₹${rule.value} per item` : `${rule.value}%`;
// The editable form for a scope: its current rule, or a blank rule switched on.
const draftFor = ({ channel, vendorType, categoryId, productId }, current) => {
  const scope = { channel, vendorType, categoryId: categoryId || '', productId: productId || '' };
  const rule = current.find(row => sameScope(row, scope));
  return rule ? { ...empty, ...scope, method: rule.method, value: rule.value, minimum: rule.minimum ?? '', maximum: rule.maximum ?? '',
    taxTreatment: rule.taxTreatment, taxRate: rule.taxRate, isActive: rule.isActive } : { ...empty, ...scope };
};
const titles = { commissions: 'Commission', orders: 'All orders', cod: 'COD cash', ledger: 'Ledger & checks', payouts: 'Rider payouts' };
const subtitles = {
  commissions: 'Set platform commission charged on vendor sales. Sellers receive their full price, and discounts are funded by the platform.',
  orders: 'Check each order’s payment and seller earnings. Open an order to review its history or record a cash issue.',
  cod: 'Track cash collected from customers, reported handovers, and the amount Bulkimart has confirmed receiving.',
  ledger: 'Every money entry, grouped by account, plus automatic checks that flag anything that does not add up.',
  payouts: 'Rider withdrawal requests. Send the money by bank/UPI first, then record the bank reference here.',
  riders: 'What each rider has earned. “On hold” becomes “Available to pay” once the order’s payment or COD cash is confirmed.',
};
const actionTitles = { 'cod/verify': 'Confirm cash received', 'cod/dispute': 'Report a cash problem', 'cod/writeoff': 'Write off cash shortage', allocate: 'Calculate seller earnings', release: 'Release seller earnings', 'release-rider': 'Release rider earnings', complete: 'Mark rider payout as paid', reject: 'Reject rider payout' };

export default function FinanceWorkflowTab({ initialTab = 'commissions', hideNavigation = false, account = '' } = {}) {
  const generation = useRef(0);
  const mutationLock = useRef(false);
  const actionFormRef = useRef(null);
  const [detailId, setDetailId] = useState(null), [detailSection, setDetailSection] = useState('summary');
  const detailBodyRef = useRef(null);
  const [filtersApplied, setFiltersApplied] = useState({ search: '', status: '', from: '', to: '' });
  const [refundPreview, setRefundPreview] = useState(null), [refundProof, setRefundProof] = useState({ reason: '', reference: '' });
  const [review, setReview] = useState(false);
  const [tab, setTab] = useState(initialTab), [rules, setRules] = useState([]), [flags, setFlags] = useState({});
  const [current, setCurrent] = useState([]), [coverage, setCoverage] = useState([]);
  const [draft, setDraft] = useState(empty), [rows, setRows] = useState([]), [balances, setBalances] = useState([]);
  const [report, setReport] = useState(null);
  const [refundId, setRefundId] = useState('');
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [search, setSearch] = useState('');
  const [status, setStatus] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [selection, setSelection] = useState(null);
  const [readError, setReadError] = useState(false);
  const [action, setAction] = useState(''), [proof, setProof] = useState({ amount: '', reference: '', reason: '', verified: false });
  const operational = flags.operations && flags.policyApproved && flags.testsApproved;
  const payoutsEnabled = flags.payouts && flags.policyApproved && flags.testsApproved;
  const detailRow = ['orders', 'cod'].includes(tab) ? rows.find(row => row._id === detailId) : null;
  const closeDetail = () => { if (!busy) { setDetailId(null); setSelection(null); } };
  useEffect(() => {
    if (!detailRow || typeof document === 'undefined') return;
    // A refresh can disable the focused button and move focus to the body.
    // Keep Escape available there, while respecting any dialog above this one.
    const closeOnEscape = event => {
      const layer = document.querySelector('.finance-order-overlay');
      if (event.key === 'Escape' && !busy && layer && isTopModal(layer)) {
        event.preventDefault(); setDetailId(null); setSelection(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [detailRow?._id, busy]);
  useEffect(() => {
    if (selection && detailId) { actionFormRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); actionFormRef.current?.querySelector('input')?.focus({ preventScroll: true }); }
  }, [selection, action, detailId]);
  const riderView = tab === 'ledger' && account === 'rider_payable';
  const query = () => new URLSearchParams({ page, q: filtersApplied.search, ...(tab === 'cod' ? { cod: 'true' } : {}), ...(filtersApplied.status ? { status: filtersApplied.status } : {}), ...(filtersApplied.from ? { from: new Date(filtersApplied.from).toISOString() } : {}), ...(filtersApplied.to ? { to: new Date(filtersApplied.to).toISOString() } : {}) });
  const applyFilters = (clear = false) => {
    if (!clear && from && to && new Date(from) > new Date(to)) { setMessage('Choose an end date that is on or after the start date.'); return; }
    const next = clear ? { search: '', status: '', from: '', to: '' } : { search: search.trim(), status, from, to };
    if (clear) { setSearch(''); setStatus(''); setFrom(''); setTo(''); }
    setPage(1); setFiltersApplied(next);
  };
  useEffect(() => { if (detailBodyRef.current) detailBodyRef.current.scrollTop = 0; }, [detailId, detailSection, selection]);
  const load = async () => {
    const currentGeneration = ++generation.current;
    const config = await adminGet('/finance/commissions');
    if (currentGeneration !== generation.current) return;
    setFlags(config.data.flags); setRules(config.data.rules);
    setCurrent(config.data.current || []); setCoverage(config.data.coverage || []);
    if (tab === 'commissions') setDraft(draft => draftFor(draft, config.data.current || []));
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
      if (!Array.isArray(result.data) || result.data.some(row => !row?._id || !row.cash || !Array.isArray(row.exceptions))) throw new Error('The order information is incomplete. Refresh the list to try again.');
      setRows(result.data); setPages(Math.max(1, result.meta.pages || 1));
    }
    if (currentGeneration === generation.current) setReadError(false);
  };
  useEffect(() => {
    let active = true;
    setBusy(true); setMessage(''); setSelection(null); setDetailId(null);
    load().catch(error => { if (active) { setReadError(true); setMessage(error.message); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; generation.current++; };
  }, [tab, page, filtersApplied]);
  const perform = async work => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setMessage('');
    try { await work(); await load(); setMessage('Saved and reloaded from the server.'); }
    catch (error) {
      setReview(false); setRefundPreview(null);
      if (/Financial record changed/i.test(error.message)) {
        setSelection(null);
        try { await load(); setMessage('This order was updated. Review its latest details before trying again.'); }
        catch (refreshError) { setMessage(refreshError.message); }
      } else setMessage(error.message);
    }
    finally { mutationLock.current = false; setBusy(false); }
  };
  const saveRule = event => {
    event.preventDefault();
    if (draft.method === 'percentage' && Number(draft.value) > 100) return setMessage('Commission percentage cannot exceed 100.');
    if (draft.minimum !== '' && draft.maximum !== '' && Number(draft.minimum) > Number(draft.maximum)) return setMessage('Minimum cannot exceed maximum.');
    if (String(draft.reason || '').trim().length < 5) return setMessage('Give a reason of at least five characters; it is kept in the change history.');
    if (!review) { setReview(true); return; }
    perform(async () => {
      const taxTreatment = draft.taxTreatment || 'inclusive';
      const taxRate = draft.taxTreatment === 'exempt' ? 0 : (draft.taxRate !== '' ? Number(draft.taxRate) : 0);
      await adminPost('/finance/commissions', { ...draft, value: Number(draft.value), taxTreatment, taxRate, reason: draft.reason.trim(),
        minimum: draft.minimum === '' ? null : Number(draft.minimum), maximum: draft.maximum === '' ? null : Number(draft.maximum),
        // The rule being replaced; the server refuses the save if someone changed it meanwhile.
        supersedes: currentRule?._id || null,
        // "All channels" saves one channel-wide rule per channel in a single transaction.
        ...(draft.channel === 'all' ? { categoryId: '', productId: '', supersedesByChannel: Object.fromEntries(ALL_CHANNELS.map((channel, i) => [channel, allChannelRules[i]?._id || null])) } : {}),
        base: 'eligible_item_subtotal', fixedScope: 'order_item' });
      setReview(false);
    });
  };
  const currentRule = current.find(rule => sameScope(rule, draft));
  const allChannelRules = ALL_CHANNELS.map(channel => current.find(rule => sameScope(rule, { ...draft, channel, categoryId: '', productId: '' })));
  const allChannelSummary = ALL_CHANNELS.map((channel, i) => `${CHANNEL_NAMES[channel]}: ${allChannelRules[i] ? `${rateText(allChannelRules[i])}${allChannelRules[i].isActive ? '' : ' (off)'}` : 'no rule'}`).join(' · ');
  // A scope change loads that scope's current rule; a half-typed ID just updates the field.
  const changeScope = changes => {
    setReview(false);
    const next = { ...draft, ...changes, ...(changes.channel === 'all' ? { categoryId: '', productId: '' } : {}) };
    if ([next.categoryId, next.productId].every(value => !value || /^[a-f\d]{24}$/i.test(value))) setDraft(draftFor(next, current));
    else setDraft(next);
  };
  const submitAction = event => {
    event.preventDefault();
    if (!selection || (tab === 'payouts' ? !payoutsEnabled : !operational)) return;
    if ((action !== 'reject' && proof.reference.trim().length < 4) || proof.reason.trim().length < 5) { setMessage('Enter a real receipt or bank reference and a reason with at least 5 characters.'); return; }
    if (action === 'cod/verify' && (!/^\d+(?:\.\d{1,2})?$/.test(proof.amount) || !Number.isFinite(Number(proof.amount)))) { setMessage('Enter the amount actually received, using up to two decimal places.'); return; }
    if (action === 'complete' && !proof.verified) { setMessage('Confirm that you checked the successful bank transfer first.'); return; }
    perform(async () => {
      const reference = proof.reference.trim();
      const reason = proof.reason.trim();
      if (tab === 'payouts') await adminPatch(`/delivery-payouts/${selection._id}/${action}`, { reason, verified: proof.verified, transactionRef: reference });
      else await adminPost(`/finance/orders/${selection._id}/${action}`, { expectedRevision: selection.financialRevision || 0, ...(action === 'cod/verify' ? { amount: Number(proof.amount) } : {}), reference, reason });
      setSelection(null);
    });
  };
  const exportCsv = async () => {
    if (busy) return;
    setBusy(true); setMessage('Preparing your download…');
    try {
      const { blob, filename } = await adminGetBlob(`/finance/orders?${query()}&export=csv`);
      if (blob.type && !blob.type.includes('csv')) throw new Error('The export did not return a CSV file. Please try again.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename.endsWith('.csv') ? filename : 'financial-orders.csv';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage('Your CSV download has started.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const refreshOrders = async () => {
    if (busy) return;
    setBusy(true); setMessage(''); setSelection(null);
    try { await load(); setMessage('Order information updated.'); }
    catch (error) { setReadError(true); setMessage(error.message); }
    finally { setBusy(false); }
  };
  const choose = (row, kind) => {
    setMessage(''); setSelection(row);
    setAction(kind);
    const suggestedAmount = kind === 'cod/verify' && row.cash
      ? String(((row.cash.reportedPaise || (row.cash.duePaise ?? row.cash.expectedPaise) || 0) / 100).toFixed(2)).replace(/\.00$/, '')
      : '';
    setProof({ amount: suggestedAmount, reference: '', reason: '', verified: false });
  };
  const changeTab = value => { setTab(value); setPage(1); setRows([]); setStatus(''); setFiltersApplied(current => ({ ...current, status: '' })); };
  const actionForm = selection && <form ref={actionFormRef} className="finance-panel finance-review" onSubmit={submitAction}><h3>{actionTitles[action] || action} · {selection.orderNo || selection._id}</h3>
        {action === 'cod/writeoff' && <p>{`Bulkimart absorbs the ${rupees(selection.cash.shortagePaise)} shortage so the seller and rider can be paid in full. This is recorded as a COD shortage expense.`}</p>}
        {action === 'cod/dispute' && <p>Blocks payouts linked to this order until you confirm the cash again.</p>}
        {['allocate', 'release', 'release-rider'].includes(action) && <p>Review the payment and earnings information before confirming this action.</p>}
        {action === 'cod/verify' && <label>Cash received (₹)<input required type="number" min="0" step="0.01" value={proof.amount} onChange={e => setProof({ ...proof, amount: e.target.value })} />{hint('What actually reached Bulkimart’s bank or cash desk, not what the rider reported. COD cash is due rounded to the nearest rupee; a different amount marks the order “Amount mismatch”.', String(((selection.cash?.duePaise ?? selection.cash?.expectedPaise) || 0) / 100))}</label>}
        <label>{action === 'complete' ? 'Bank reference (UTR)' : 'Evidence reference'}<input required={action !== 'reject'} minLength={4} value={proof.reference} autoComplete="off" onChange={e => setProof({ ...proof, reference: e.target.value })} />{hint(action === 'complete' ? 'From your bank statement, after the transfer succeeded.' : 'Deposit slip, bank UTR or cash-desk receipt number.', action === 'complete' ? 'UTR 412345678901' : 'Deposit slip 0098')}</label>
        <label>Reason<input required minLength={5} value={proof.reason} autoComplete="off" onChange={e => setProof({ ...proof, reason: e.target.value })} />{hint('Kept with the order’s history.', action === 'cod/writeoff' ? 'Customer paid ₹20 less at the door' : 'Counted at the cash desk on 23 Oct')}</label>
        {action === 'complete' && <label className="finance-check"><input required type="checkbox" checked={proof.verified} onChange={e => setProof({ ...proof, verified: e.target.checked })} />I checked the bank statement: the transfer succeeded</label>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button disabled={busy} type="submit">{busy ? 'Saving…' : action === 'cod/dispute' ? 'Save cash issue' : action === 'cod/verify' ? 'Confirm cash receipt' : 'Confirm'}</button>
          <button type="button" disabled={busy} onClick={() => setSelection(null)} style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}>Cancel</button>
        </div>
      </form>;
  const orderActions = row => (<div className="finance-order-actions">
              {['remittance_reported','discrepancy','disputed'].includes(row.cash.status) && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/verify')}>Confirm cash received</button>}
              {row.cash.status === 'discrepancy' && row.cash.shortagePaise > 0 && !row.cash.writtenOffPaise && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/writeoff')}>Cover cash shortfall</button>}
              {row.paymentMethod === 'cod' && !['expected', 'disputed'].includes(row.cash.status) && <button disabled={busy || !operational} onClick={() => choose(row, 'cod/dispute')}>Report a cash problem</button>}
              {row.exceptions.includes('needs_admin_review') && !row.financialPosting && <button title={row.exceptions.includes('commission_rule_missing') ? 'A commission rate must be recorded for this order first.' : undefined} disabled={busy || !operational || row.exceptions.includes('commission_rule_missing') || row.exceptions.includes('discount_funding_policy_missing')} onClick={() => choose(row, 'allocate')}>Calculate seller earnings</button>}
              {row.exceptions.includes('needs_admin_review') && row.financialPosting === 'held' && <button disabled={busy || !operational} onClick={() => choose(row, 'release')}>Release seller earnings</button>}
              {row.financeAutomation?.step === 'rider_release' && <button disabled={busy || !operational} onClick={() => choose(row, 'release-rider')}>Release rider earnings</button>}
            </div>);
  return <section className="finance-workflow">
    <h2>{riderView ? 'Rider balances' : titles[tab]}</h2>
    <p>{riderView ? subtitles.riders : subtitles[tab]}</p>
    <div className="finance-notice">{operational ? 'Payments and earnings update automatically. Check orders marked “Needs review”.' : ['orders','cod'].includes(tab) ? 'Financial changes are currently disabled. You can still view orders and download reports.' : 'Money actions are switched off on the server, so buttons that move money are disabled. You can still change settings.'}</div>
    {!hideNavigation && <nav aria-label="Finance views">{[['commissions','Commission'],['orders','All orders'],['cod','COD cash'],['ledger','Ledger & checks'],['payouts','Rider payouts']].map(([value, text]) => <button type="button" aria-pressed={tab === value} key={value} onClick={() => changeTab(value)}>{text}</button>)}</nav>}
    {message && <p role="status" className="finance-notice">{message}</p>}
    {readError && ['orders','cod'].includes(tab) && <button type="button" disabled={busy} onClick={refreshOrders}>Retry loading orders</button>}
    {tab === 'commissions' ? <>
      {review ? <FinanceReview title={draft.isActive ? 'Review commission rule (switched on)' : 'Review commission rule (switched off)'} values={{Channel: CHANNEL_NAMES[draft.channel], Vendor: draft.vendorType, Method: draft.method, Value: `${draft.value} ${draft.method === 'fixed' ? '₹ per item' : '%'}`, Minimum: draft.minimum || 'None', Maximum: draft.maximum || 'None', GST: `${draft.taxTreatment || 'inclusive'} ${draft.taxRate || 0}%`, Replaces: draft.channel === 'all' ? allChannelSummary : currentRule ? `${rateText(currentRule)} (${currentRule.isActive ? 'on' : 'off'})` : 'Nothing — first rule for this scope', Category: draft.categoryId || 'All', Product: draft.productId || 'All', Status: draft.isActive ? 'On — new orders use it as soon as you save' : 'Off — new orders in this scope stop using it as soon as you save', Reason: draft.reason}} busy={busy} onConfirm={() => saveRule({preventDefault(){}})} onCancel={() => setReview(false)} /> : <form onSubmit={saveRule} onInvalid={e=>e.target.closest('details')?.setAttribute('open','')} className="finance-panel">
        <h3>{draft.channel === 'all' ? 'Set commission for all channels' : currentRule ? 'Edit current commission rule' : 'Create commission rule'}</h3>
        <p className="finance-muted">{draft.channel === 'all'
          ? `Saves the same rule for E-Commerce, Quick Commerce and Wholesale in one step — all three change together or none do. Current: ${allChannelSummary}. Past orders keep the rate they were placed with.`
          : currentRule
          ? `${CHANNEL_NAMES[draft.channel]} · ${VENDOR_NAMES[draft.vendorType]}${draft.productId ? ' · this product' : draft.categoryId ? ' · this category' : ''} currently uses ${rateText(currentRule)} (${currentRule.isActive ? 'on' : 'off'}). Saving replaces it for new orders straight away; past orders keep the rate they were placed with.`
          : `${CHANNEL_NAMES[draft.channel]} · ${VENDOR_NAMES[draft.vendorType]} has no rule for this scope yet. Saving creates it for new orders straight away.`}</p>
        <div className="finance-grid">
          <label>Channel<select value={draft.channel} onChange={e => changeScope({ channel: e.target.value })}><option value="ecommerce">E-Commerce</option><option value="quick">Quick Commerce</option><option value="wholesale">Wholesale</option><option value="all">All channels</option></select>{hint('Store channel this commission applies to. Choose All channels to set one rate everywhere.')}</label>
          <label>Commission method<select value={draft.method} onChange={e => setDraft({ ...draft, method: e.target.value })}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed (₹ per item)</option></select>{hint(draft.method === 'fixed' ? 'Fixed fee per item line.' : 'Percentage of item sale price.')}</label>
          <label>Commission value<input type="number" min="0" step="0.01" max={draft.method === 'percentage' ? 100 : undefined} required value={draft.value} onChange={e => setDraft({ ...draft, value: e.target.value })} placeholder="e.g. 10" />{hint(draft.method === 'fixed' ? '₹ kept per item line.' : 'Percentage kept from each sale.', draft.method === 'fixed' ? '15 → ₹15 per item' : '10 → 10% commission')}</label>
          <label>Change reason<input required minLength={5} maxLength={500} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} placeholder="Why the rate is changing" />{hint('Required. Kept in the change history.', 'Annual rate review')}</label>
        </div>
        <details className="finance-advanced" style={{ margin: '14px 0', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0369a1' }}>⚙️ More options (Tax & category/product overrides)</summary><div className="finance-grid" style={{ marginTop: 12 }}>
          <label>GST treatment<select value={draft.taxTreatment} onChange={e => setDraft({ ...draft, taxTreatment: e.target.value })}><option value="">Default (Inclusive)</option><option value="inclusive">Commission already includes GST</option><option value="exclusive">Add GST on top of commission</option><option value="exempt">No GST (Exempt)</option></select>{hint('GST charged on Bulkimart’s commission.')}</label>
          <label>GST rate on commission (%)<input type="number" min="0" max="100" step="0.01" value={draft.taxRate} onChange={e => setDraft({...draft,taxRate:e.target.value})} placeholder="0" />{hint('Standard GST rate (usually 18%, or 0 for exempt).', '18')}</label>
          <label>Minimum commission (₹, optional)<input type="number" min="0" step="0.01" value={draft.minimum} onChange={e => setDraft({...draft,minimum:e.target.value})} />{hint('Never charge less than this per item line.', '5')}</label>
          <label>Maximum commission (₹, optional)<input type="number" min="0" step="0.01" value={draft.maximum} onChange={e => setDraft({...draft,maximum:e.target.value})} />{hint('Never charge more than this per item line.', '200')}</label>
          {['categoryId','productId'].map(key => <label key={key}>{key === 'categoryId' ? 'Only for category ID (optional)' : 'Only for product ID (optional)'}<input value={draft[key]} disabled={draft.channel === 'all'} pattern="[a-fA-F0-9]{24}" onChange={e => changeScope({ [key]: e.target.value.trim() })} placeholder="24-character ID" />{hint(key === 'categoryId' ? 'Paste a category ID to give that category its own rate.' : 'Paste a product ID to give one product its own rate.')}</label>)}
        </div></details>
        <label className="finance-check"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Switch this rule on</label>
        {hint(draft.isActive ? 'New orders in this scope use this rate as soon as you save.' : 'Switched off: new orders fall back to the broader rule, or are held if there is none.')}
        <button disabled={busy} type="submit" style={{ marginTop: 10 }}>{currentRule ? 'Review change' : 'Review rule'}</button>
      </form>}
      <CommissionSimulation rule={draft} />
      <div className="finance-panel"><h3>Which rule applies</h3><p className="finance-muted">The rule each channel uses for new orders. A product rule beats a category rule, which beats the channel rule.</p>
        <div className="finance-table" role="region" tabIndex={0} aria-label="Commission coverage"><table><thead><tr>{['Channel', 'Current rule', 'Overrides', ''].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
          {coverage.map(row => { const rule = current.find(item => String(item._id) === String(row.ruleId)); return <tr key={`${row.channel}:${row.vendorType}`}>
            <td>{CHANNEL_NAMES[row.channel]}</td>
            <td>{!rule ? 'No rule — new orders are held' : row.active ? rateText(rule) : `${rateText(rule)} (switched off — new orders are held)`}</td>
            <td>{row.overrides || '—'}</td>
            <td><button type="button" onClick={() => changeScope({ channel: row.channel, vendorType: row.vendorType, categoryId: '', productId: '' })}>Edit</button></td>
          </tr>; })}
        </tbody></table></div>
        {current.filter(rule => rule.categoryId || rule.productId).map(rule => <p key={rule._id}>{`${CHANNEL_NAMES[rule.channel]} · ${VENDOR_NAMES[rule.vendorType]} · ${rule.productId ? `product ${rule.productId}` : `category ${rule.categoryId}`}: ${rateText(rule)} (${rule.isActive ? 'on' : 'off'})`}
          <button type="button" onClick={() => changeScope({ channel: rule.channel, vendorType: rule.vendorType, categoryId: rule.categoryId || '', productId: rule.productId || '' })}>Edit</button></p>)}
      </div>
      <div className="finance-panel"><h3>Change history</h3><p className="finance-muted">Every saved version, newest first. Older versions are kept for audit and for the orders placed under them.</p>
        {rules.length ? rules.map(rule => <details key={rule._id}><summary>{CHANNEL_NAMES[rule.channel] || rule.channel} · {rateText(rule)} · {current.some(item => String(item._id) === String(rule._id)) ? (rule.isActive ? 'Current' : 'Current (off)') : 'Replaced'} · {new Date(rule.createdAt || rule.effectiveDate).toLocaleString()}</summary><p>Version: {rule.version}<br />GST: {rule.taxTreatment} {rule.taxRate}%<br />Changed by: {rule.createdBy}<br />Reason: {rule.reason}<br />Product: {rule.productId || 'All'} · Category: {rule.categoryId || 'All'}</p></details>) : <p>No commission rules yet. Until one is switched on, delivered orders cannot add seller earnings.</p>}
      </div>
    </> : <>
      {['cod','orders'].includes(tab) && <form className="finance-panel finance-grid" onSubmit={event => { event.preventDefault(); applyFilters(); }}>
        <label>Order number<input value={search} onChange={e => setSearch(e.target.value)} />{hint('Search by full or partial order ID.', 'ORD-20261023')}</label>
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
          {(search || status || from || to) && <button disabled={busy} type="button" onClick={() => applyFilters(true)} style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}>Clear filters</button>}
          <button disabled={busy} type="button" onClick={refreshOrders}>Refresh orders</button>
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
      <div className="finance-table finance-records-table" role="region" tabIndex={0} aria-label="Finance records"><table><thead><tr>{(tab === 'ledger' ? ['Entry','Account','Status','Amount','Reference'] : tab === 'payouts' ? ['Rider','Amount','Status','Bank reference','Action'] : ['Order','Order status','Customer pays','Cash status','Earnings status','Details']).map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>
        {rows.map(row => tab === 'ledger' ? <tr key={row._id}><td>{row.description}</td><td>{label(ACCOUNT, row.account || 'seller_payable')}</td><td>{label(BUCKET, row.bucket)}</td><td>{row.direction === 'debit' ? '−' : '+'}{rupees(row.amount * 100)}</td><td>{row.reference || row.idempotencyKey}<br />Rider: {row.partnerId || '—'}<br />Order: {row.orderId || '—'}<br />Delivery: {row.deliveryId || '—'}</td></tr> : tab === 'payouts' ? <tr key={row._id}><td>{row.partnerId?.userId?.name || row.partnerId?._id}</td><td>{rupees(row.amount * 100)}</td><td>{row.status}</td><td>{row.transactionRef || 'Not paid yet'}</td><td>{row.status === 'pending' && row.financeVersion === 2 && <><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'complete')}>Mark as paid</button><button disabled={busy || !payoutsEnabled} onClick={() => choose(row, 'reject')}>Reject request</button></>}</td></tr> : <tr key={row._id}>
          <td><strong>{row.orderNo}</strong>{(row.display?.channel || row.channel) && <small className="finance-row-secondary">{CHANNEL_NAMES[row.display?.channel || row.channel] || row.channel}</small>}</td>
          <td><span className="finance-status-badge">{row.status}</span></td>
          <td><strong>{rupees(row.cash.expectedPaise)}</strong><small className="finance-row-secondary">{row.paymentMethod === 'cod' ? 'Cash on delivery' : 'Prepaid'}</small></td>
          <td>{row.paymentMethod === 'cod' ? <span className={'finance-status-badge finance-cash-' + row.cash.status}>{label(COD_STATUS, row.cash.status)}</span> : 'Prepaid'}</td>
          <td><span>{row.financialPosting ? label(POSTING, row.financialPosting) : 'Earnings not added yet'}</span>{(row.exceptions?.length > 0 || row.financeAutomation?.lastError) && <small className="finance-row-review">Needs review</small>}</td>
          <td><button type="button" className="finance-view-details" disabled={busy} onClick={() => { setSelection(null); setMessage(''); setDetailSection('summary'); setDetailId(row._id); }}>View details</button></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={tab === 'ledger' || tab === 'payouts' ? 5 : 6}>{busy ? 'Loading…' : readError ? 'Orders could not be loaded. Please try again.' : ['orders','cod'].includes(tab) ? 'No orders match these filters.' : 'Nothing to show here.'}</td></tr>}
      </tbody></table></div>
      <div className="finance-pagination"><button disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={busy || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      {tab === 'payouts' && actionForm}
    </>}

    {detailRow && <ModalPortal className="finance-order-overlay" onClick={event => { if (event.target === event.currentTarget) closeDetail(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetail(); } }}>
      <section className="finance-workflow finance-order-dialog" role="dialog" aria-modal="true" aria-labelledby="finance-order-detail-title">
        <header className="finance-order-dialog-header">
          <div><span className="finance-order-eyebrow">Payment &amp; earnings</span><h2 id="finance-order-detail-title">{detailRow.orderNo}</h2><p>{CHANNEL_NAMES[detailRow.display?.channel || detailRow.channel] || 'Order'} · {detailRow.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online payment'}</p></div>
          <div className="finance-order-header-actions"><button type="button" disabled={busy} onClick={refreshOrders}>Refresh order</button><button type="button" className="finance-order-close" aria-label="Close order details" disabled={busy} onClick={closeDetail}>✕</button></div>
        </header>
        <nav className="finance-order-tabs" aria-label="Order detail sections">{[['summary','Summary'],['history','Payment history'],['items','Item earnings']].map(([key,title])=><button key={key} type="button" disabled={busy} aria-pressed={detailSection===key && !selection} onClick={()=>{setSelection(null);setDetailSection(key);}}>{title}</button>)}</nav>
        <div ref={detailBodyRef} className="finance-order-dialog-body">
          {message && <p role="status" className="finance-notice">{message}</p>}
          {selection ? actionForm : <>
          {detailSection === 'summary' && <section aria-label="Order payment summary">
            <div className="finance-order-summary">
              <div><span>Order status</span><strong className="finance-capitalize">{detailRow.status}</strong></div>
              <div><span>Order total</span><strong>{rupees(detailRow.cash.expectedPaise)}</strong></div>
              <div><span>Payment status</span><strong>{detailRow.paymentMethod === 'cod' ? label(COD_STATUS, detailRow.cash.status) : 'Online payment'}</strong></div>
              <div><span>Seller earnings</span><strong>{detailRow.financialPosting ? label(POSTING, detailRow.financialPosting) : 'Not calculated yet'}</strong></div>
            </div>
            {(detailRow.exceptions?.length > 0 || detailRow.financeAutomation?.lastError) && <section className="finance-order-issues" aria-label="Items needing review"><h3>What needs attention</h3>
              {detailRow.exceptions?.length > 0 && <ul>{detailRow.exceptions.map(code => <li key={code}>{label(ORDER_ISSUE, code)}</li>)}</ul>}
              {detailRow.financeAutomation?.lastError && <details><summary>Processing details</summary><p>{detailRow.financeAutomation.lastError}</p></details>}
            </section>}
            {detailRow.paymentMethod === 'cod' && <section className="finance-order-section"><h3>Where the cash stands</h3><p className="finance-muted">The delivery partner reports the collection and handover. Bulkimart confirms the amount it actually receives.</p>
              <dl className="finance-order-cash-totals">
                <div><dt>Cash due (rounded)</dt><dd>{rupees(detailRow.cash.duePaise ?? detailRow.cash.expectedPaise)}</dd></div>
                <div><dt>Collected from customer</dt><dd>{rupees(detailRow.cash.collectedPaise)}</dd></div>
                <div><dt>Handover reported</dt><dd>{rupees(detailRow.cash.reportedPaise)}</dd></div>
                <div><dt>Confirmed by Bulkimart</dt><dd>{rupees(detailRow.cash.verifiedPaise)}</dd></div>
                {!!detailRow.cash.writtenOffPaise && <div><dt>Shortfall covered by Bulkimart</dt><dd>{rupees(detailRow.cash.writtenOffPaise)}</dd></div>}
              </dl>
            </section>}
          </section>}
          {detailSection === 'history' && <section aria-label="Payment history"><h3>Payment history</h3><p className="finance-muted">Who reported each cash payment and when it was checked.</p>
            {detailRow.codFinance?.events?.length ? <ol className="finance-payment-timeline">{detailRow.codFinance.events.map((entry,index)=><li key={index}>
              <div className="finance-payment-event-header"><strong>{label(CASH_ACTIVITY,entry.action)}</strong><strong>{rupees(entry.amountPaise)}</strong></div>
              <div className="finance-payment-event-person">{cashActor(entry,detailRow.display?.actors)}<span>{entry.at ? new Date(entry.at).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}) : 'Date not recorded'}</span></div>
              <p>{cashNote(entry)}</p>
              {entry.reference?.startsWith('OTP-') ? <details><summary>View delivery confirmation reference</summary><code>{entry.reference}</code></details> : <p className="finance-payment-reference"><span>Receipt / bank reference</span><strong>{entry.reference || 'No reference was recorded.'}</strong></p>}
            </li>)}</ol> : <div className="finance-empty-state"><h4>No cash activity recorded</h4><p>{detailRow.paymentMethod === 'cod' ? 'Collection and handover reports will appear here when they are recorded.' : 'This order uses online payment. There are no cash handover reports.'}</p></div>}
          </section>}
          {detailSection === 'items' && <section aria-label="Item earnings"><h3>Item earnings</h3><p className="finance-muted">The sale price, platform-funded discounts, commission and taxes saved for this order.</p>
            {detailRow.financialSnapshot?.lines?.length ? <div className="finance-table" role="region" tabIndex={0} aria-label="Order money breakdown"><table><thead><tr>{['Item / store','Item price','Customer paid','Discount paid by Bulkimart','Commission & tax','Tax withheld','Seller earns'].map(title=><th key={title}>{title}</th>)}</tr></thead><tbody>
              {detailRow.financialSnapshot.lines.map((line,index)=>{const info=detailRow.display?.items?.find(item=>item.itemId===String(line.itemId));return <tr key={line.itemId}>
                <td><strong>{info?.name || line.itemName || 'Item ' + (index+1) + ' (name unavailable)'}</strong><small className="finance-row-secondary">{info?.sellerName || 'Store name unavailable'}</small>{line.rule && <small className="finance-row-secondary">{line.rule.method==='percentage' && Number.isFinite(line.rule.value) ? line.rule.value+'% commission' : line.rule.method==='fixed' && Number.isFinite(line.rule.value) ? '₹'+line.rule.value+' commission per item' : 'Commission recorded'}</small>}{line.blocker && <small className="finance-row-review">{label(ORDER_ISSUE,line.blocker)}</small>}</td>
                <td>{rupees(line.grossPaise)}</td><td>{rupees(line.eligiblePaise)}</td><td>{rupees(line.platformDiscountPaise || 0)}</td>
                <td>{line.rule ? rupees(line.commissionPaise) : 'Rate not recorded'}<small className="finance-row-secondary">GST: {rupees(line.taxPaise)}</small></td><td>TCS: {rupees(line.tcsPaise || 0)}<small className="finance-row-secondary">TDS: {rupees(line.tdsPaise || 0)}</small></td><td>{line.rule ? rupees(line.netPaise) : 'Waiting for review'}</td>
              </tr>;})}
            </tbody></table></div> : <div className="finance-empty-state"><h4>Item earnings are unavailable</h4><p>No item earnings record is available for this order. Amounts are shown only after they have been recorded.</p></div>}
          </section>}
          </>}
        </div>
        {!selection && <footer className="finance-order-footer"><div><h3>Available actions</h3>{!operational && <p>Financial changes are currently disabled. You can still view the order.</p>}{orderActions(detailRow)}
          {detailRow.exceptions?.some(code => ['commission_rule_missing','discount_funding_policy_missing'].includes(code)) ? <p>Earnings are waiting for this order’s commission or discount information to be reviewed.</p> : !(detailRow.exceptions?.includes('needs_admin_review') || detailRow.financeAutomation?.step === 'rider_release' || detailRow.paymentMethod === 'cod' && detailRow.cash.status !== 'expected') && <p>No action is required from you right now.</p>}
        </div></footer>}
      </section>
    </ModalPortal>}
  </section>;
}
