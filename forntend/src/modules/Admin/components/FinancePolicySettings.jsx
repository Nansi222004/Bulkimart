import React, { useEffect, useState } from 'react';
import { authGet, authPut } from '../../../utils/adminApi';
import FinanceReview from './FinanceReview';
import { hint, WEEKDAYS } from './financeText';

const empty = { tcsRatePercent: '', tdsRatePercent: '', sellerMinPayout: '', riderMinPayout: '', payoutSchedule: 'on_request', payoutWeekday: 1, requireIndependentPayoutReviewer: true, bankVerificationMethod: '', note: '' };
const fromPolicy = policy => Object.fromEntries(Object.keys(empty).map(key => [key, key === 'note' ? '' : policy[key] ?? empty[key]]));

export default function FinancePolicySettings() {
  const [policy, setPolicy] = useState(null), [draft, setDraft] = useState(empty), [review, setReview] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = async () => { setLoading(true); setError(''); try { const { data } = await authGet('/api/admin/finance/policy'); setPolicy(data.policy); setDraft(fromPolicy(data.policy)); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const edit = (key, value) => setDraft(old => ({ ...old, [key]: value }));
  const submit = async event => {
    event.preventDefault(); setError(''); setMessage('');
    for (const [key, name] of [['tcsRatePercent', 'TCS rate'], ['tdsRatePercent', 'TDS rate']]) if (draft[key] === '' || Number(draft[key]) < 0 || Number(draft[key]) > 5) return setError(`${name} must be between 0 and 5.`);
    for (const [key, name] of [['sellerMinPayout', 'Seller minimum payout'], ['riderMinPayout', 'Rider minimum payout']]) if (draft[key] === '' || Number(draft[key]) < 0) return setError(`${name} must be zero or more.`);
    if (draft.note.trim().length < 5) return setError('Write a change reason of at least 5 characters.');
    if (!review) { setReview(true); return; }
    setBusy(true);
    try {
      const { data } = await authPut('/api/admin/finance/policy', { ...draft, tcsRatePercent: Number(draft.tcsRatePercent), tdsRatePercent: Number(draft.tdsRatePercent), sellerMinPayout: Number(draft.sellerMinPayout), riderMinPayout: Number(draft.riderMinPayout), payoutWeekday: Number(draft.payoutWeekday), revision: policy?.revision || 0 });
      setPolicy(data.policy); setDraft(fromPolicy(data.policy)); setReview(false); setMessage('Saved. New orders use these rates; existing orders keep theirs.');
    } catch (e) { setError(e.message); setReview(false); } finally { setBusy(false); }
  };
  if (loading) return <p role="status">Loading payout and tax policy…</p>;
  return <section className="finance-workflow"><h2>Payouts & tax</h2>
    <p>How and when sellers and riders get paid, and the tax Bulkimart withholds from seller sales.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {policy && !policy.configured && <p className="finance-notice">Not saved yet. Until you save, no TCS/TDS is withheld, sellers have no minimum payout and riders need ₹{policy.riderMinPayout}.</p>}
    {review ? <FinanceReview title="Review payout and tax policy" values={{ 'TCS rate': `${draft.tcsRatePercent}%`, 'TDS rate': `${draft.tdsRatePercent}%`, 'Seller minimum payout': `₹${draft.sellerMinPayout}`, 'Rider minimum payout': `₹${draft.riderMinPayout}`,
      Schedule: draft.payoutSchedule === 'weekly' ? `Weekly, every ${WEEKDAYS[draft.payoutWeekday]}` : 'When the seller or rider requests', 'Second admin confirms payouts': draft.requireIndependentPayoutReviewer ? 'Yes' : 'No', 'Bank account check': draft.bankVerificationMethod || 'Not set', Reason: draft.note }}
      busy={busy} onConfirm={() => submit({ preventDefault() {} })} onCancel={() => setReview(false)} /> : <form onSubmit={submit} className="finance-panel">
      <h3>Payout schedule</h3>
      <div className="finance-grid">
        <label>Payout schedule<select value={draft.payoutSchedule} onChange={e => edit('payoutSchedule', e.target.value)}><option value="on_request">When requested</option><option value="weekly">Weekly (automatic)</option></select>{hint('“When requested”: sellers and riders tap Request payout. “Weekly”: Bulkimart creates a request for each full available balance on the chosen day, and manual requests are turned off.')}</label>
        {draft.payoutSchedule === 'weekly' && <label>Payout day<select value={draft.payoutWeekday} onChange={e => edit('payoutWeekday', e.target.value)}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>{hint('Day (India time) on which weekly payout requests are created.')}</label>}
        <label>Seller minimum payout (₹)<input type="number" min="0" step="0.01" value={draft.sellerMinPayout} onChange={e => edit('sellerMinPayout', e.target.value)} />{hint('Smallest amount a seller can withdraw. Smaller balances wait until they reach it.', '500')}</label>
        <label>Rider minimum payout (₹)<input type="number" min="0" step="0.01" value={draft.riderMinPayout} onChange={e => edit('riderMinPayout', e.target.value)} />{hint('Smallest amount a rider can withdraw.', '100')}</label>
      </div>
      <h3>Tax withheld from seller sales</h3>
      <p className="finance-muted">TCS is worked out on each item’s price excluding its GST (from the product’s GST rate, frozen when the order is placed); TDS on the full price. Both appear on the seller’s monthly tax statement and in Reports → Tax reports. Confirm the current rates with your CA.</p>
      <div className="finance-grid">
        <label>TCS rate (%)<input type="number" min="0" max="5" step="0.01" value={draft.tcsRatePercent} onChange={e => edit('tcsRatePercent', e.target.value)} />{hint('GST Tax Collected at Source (section 52) that Bulkimart, as the marketplace, deposits for the seller. Make sure each product has its GST rate set; a product with 0% is treated as exempt. Use 0 to switch off.', '0.5 → ₹0.42 on a ₹100 item with 18% GST')}</label>
        <label>TDS rate (%)<input type="number" min="0" max="5" step="0.01" value={draft.tdsRatePercent} onChange={e => edit('tdsRatePercent', e.target.value)} />{hint('Income-tax TDS under section 194-O. Use 0 to switch off.', '0.1 → ₹0.10 on a ₹100 item')}</label>
      </div>
      <h3>Payout safety</h3>
      <label>How you check a bank account belongs to the seller<input value={draft.bankVerificationMethod} maxLength={500} onChange={e => edit('bankVerificationMethod', e.target.value)} />{hint('Required before any seller payout can be marked paid. Changing it asks admins to re-check pending payouts.', 'Penny-drop test – account holder name must match the GST certificate')}</label>
      <label className="finance-check"><input type="checkbox" checked={draft.requireIndependentPayoutReviewer} onChange={e => edit('requireIndependentPayoutReviewer', e.target.checked)} />A second admin must confirm each seller payout</label>
      {hint('Recommended. The admin who checked the bank account cannot also mark the transfer as paid. Turn off only if one person runs finance.')}
      <label>Change reason<input required minLength={5} maxLength={500} value={draft.note} onChange={e => edit('note', e.target.value)} />{hint('Shown in the change history.', 'TCS rate per CA advice dated 20 Oct')}</label>
      <button disabled={busy} type="submit">Review changes</button>
    </form>}
    {policy?.history?.length > 0 && <section className="finance-panel"><h3>Change history</h3>{[...policy.history].reverse().map(row => <details key={row.revision}><summary>Version {row.revision} · {row.changedAt ? new Date(row.changedAt).toLocaleString() : ''} · {row.note}</summary>
      <p>TCS {row.values?.tcsRatePercent}% · TDS {row.values?.tdsRatePercent}% · Seller minimum ₹{row.values?.sellerMinPayout} · Rider minimum ₹{row.values?.riderMinPayout} · {row.values?.payoutSchedule === 'weekly' ? `Weekly (${WEEKDAYS[row.values.payoutWeekday]})` : 'On request'}</p></details>)}</section>}
  </section>;
}
