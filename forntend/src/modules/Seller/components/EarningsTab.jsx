import React from 'react';
import { useSeller } from '../context/SellerContext';
import { sellerMoney as money } from '../utils/sellerFinanceRead';
import SellerTaxStatement from './SellerTaxStatement';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BUCKETS = { pending: 'Pending', held: 'On hold', eligible: 'Available', reserved: 'Payout requested', settled: 'Paid' };
const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const settlementStatus = (order) => {
  if (order.financialPosting === 'held') return 'Earned — on hold until the return window ends';
  if (order.financialPosting === 'eligible') return 'Available to withdraw';
  if (order.financialPosting === 'reversed') return 'Refunded to customer';
  if (order.snapshotVersion !== 2) return 'Awaiting finance review: original commission details missing for this older order';
  if (order.snapshotState === 'held_discount_policy') return 'On hold: Bulkimart finance is reviewing the discount on this order';
  if (order.snapshotState !== 'configured') return 'On hold: no commission rate was set when ordered';
  return order.paymentMethod === 'cod' ? 'Waiting for the cash to reach Bulkimart' : 'Waiting for payment confirmation';
};

export const EarningsTab = () => {
  const { financeSummary, ledgerEntries, financeLoading, financeError, fetchSellerFinances, setActiveTab } = useSeller();
  const balances = financeSummary?.balances || {};
  const sales = financeSummary?.deliveredSales;
  const policy = financeSummary?.payoutPolicy;
  const metrics = financeSummary?.salesMetrics;
  const pendingNetOrders = metrics?.netEarningsPendingOrders ?? sales?.orders?.filter(order => !Number.isFinite(order.sellerAmounts?.netEarnings)).length ?? 0;
  const unpostedOrders = financeSummary?.coverage?.unpostedOrders ?? sales?.orders?.filter(order => !['held', 'eligible', 'reversed'].includes(order.financialPosting)).length ?? 0;
  const main = [
    ['On hold', balances.held, '#d97706', 'Earned, waiting for the return window to end.'],
    ['Available to withdraw', balances.eligible, '#16a34a', 'You can request this now.'],
    ['Paid to you', balances.settled, '#334155', 'Sent to your bank so far.'],
  ];
  const other = [
    ['Posted earnings', balances.earnedEarnings], ['Same-day incentives', balances.sameDayIncentives], ['Payout requested', balances.reserved], ['Pending', balances.pending],
  ];
  // Prepaid Shiprocket charges are separate from earnings and never reduce what you can withdraw.
  const courier = balances.courierObligations;
  if (financeLoading) return <div role="status" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading authoritative seller ledger…</div>;
  if (financeError || !financeSummary) return <section style={{ padding: 20 }}>
    <h1>Earnings & settlements</h1><div role={financeError ? 'alert' : 'status'}>{financeError || 'Seller finances have not loaded yet.'}</div>
    <p>Balances, ledger history and payout requests are unavailable. This does not mean your balances are zero.</p>
    <button onClick={fetchSellerFinances}>Refresh</button>
  </section>;

  return <div style={{ padding: '0 4px 40px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
      <div><h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>Earnings & settlements</h1>
        <p style={{ color: '#64748b', fontSize: 13 }}>For each item you get the full item price minus Bulkimart’s commission, GST on that commission, and any TCS/TDS. Coupons and coins are paid by Bulkimart, not by you.</p></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={fetchSellerFinances} style={{ padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 9, background: '#fff' }}>Refresh</button>
        <button disabled={!financeSummary?.payoutActionsEnabled} onClick={() => setActiveTab('moneyrequest')}
          title={!financeSummary?.payoutActionsEnabled ? 'Nothing available to withdraw yet' : 'Request payout'}
          style={{ padding: '9px 16px', border: 0, borderRadius: 9, color: '#fff', background: financeSummary?.payoutActionsEnabled ? '#0f9f91' : '#94a3b8', cursor: financeSummary?.payoutActionsEnabled ? 'pointer' : 'not-allowed' }}>Request payout</button>
      </div>
    </div>
    {financeError && <div style={{ padding: 14, background: '#fef2f2', color: '#991b1b', borderRadius: 10, marginBottom: 14 }}>{financeError}</div>}
    <section aria-label="Sales and net earnings" className="seller-earnings-summary">
      <div><h2>Completed product sales</h2><strong>{money(metrics ? metrics.totalRevenue : sales?.grossAmount)}</strong>
        <p>{metrics?.completedOrders ?? sales?.orderCount ?? 0} delivered orders across all storefronts · {metrics ? 'after customer discounts' : 'before deductions'}</p>
        {financeSummary?.salesByChannel && <p>Shop All: {money(financeSummary.salesByChannel.ecommerce?.revenue)} · Quick Commerce: {money(financeSummary.salesByChannel.grocery?.revenue)}</p>}
      </div>
      <div><h2>Net earnings</h2><strong>{pendingNetOrders > 0 ? 'Awaiting calculation' : money(metrics?.netEarnings)}</strong>
        {pendingNetOrders > 0 ? <p>{pendingNetOrders} delivered {pendingNetOrders === 1 ? 'order needs' : 'orders need'} original commission details or financial adjustments reviewed. This is not a zero earning.</p> : <p>After the commission and deductions recorded for each completed order. Settlement balances appear below.</p>}
        {pendingNetOrders > 0 && metrics?.netEarningsCalculatedOrders > 0 && <p>Calculated subtotal: {money(metrics.knownNetEarnings)} from {metrics.netEarningsCalculatedOrders} orders.</p>}
      </div>
    </section>
    {unpostedOrders > 0 && <div role="status" className="seller-earnings-coverage">{unpostedOrders} delivered {unpostedOrders === 1 ? 'order has' : 'orders have'} not been posted to your settlement balance. The amounts below show posted funds only; they do not include these orders. Bulkimart finance must verify the original commission and payment or COD records before posting them.</div>}
    <h2 style={{ fontSize: 17 }}>Posted settlement balances</h2>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
      {main.map(([title, value, color, help]) => <div key={title} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>{title}</div><div style={{ marginTop: 6, fontSize: 23, fontWeight: 800, color }}>{money(value)}</div><div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{help}</div>
      </div>)}
    </div>
    {courier?.charged > 0 && <p style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
      {`Shiprocket charges you prepaid: ${money(courier.charged)} charged · ${money(courier.paid)} paid · ${money(courier.outstanding)} still to pay`}
      <br />{`Includes courier ${money(balances.quickFreightObligations)} and Bulkimart service fees ${money(balances.bulkimartServiceFees)}. These are paid separately and are not taken from your earnings.`}</p>}
    <p style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>{other.map(([title, value]) => `${title}: ${money(value)}`).join(' · ')}{policy &&<><br />Payouts: {policy.schedule === 'weekly' ? `sent automatically every ${WEEKDAYS[policy.weekday]}` : 'request them any time'}{policy.minimum > 0 ? ` · minimum ${money(policy.minimum)}` : ''}</>}</p>
    {financeSummary?.coverage && <div style={{ padding: 14, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 10, marginBottom: 16, fontSize: 12 }}>
      How it works: an order is delivered → once payment (or COD cash) reaches Bulkimart, your earning appears as “On hold” → after the return window it becomes “Available” → you withdraw it. Older orders from before this system need a finance review; contact support with the order number.
    </div>}
    {sales && <section style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, marginBottom: 20 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Delivered orders</h2>
      <strong>{sales.orderCount} delivered orders · {money(sales.grossAmount)} item sales</strong>
      <p style={{ color: '#64748b', fontSize: 13 }}>Full item prices, before commission and refunds.</p>
      <p style={{ color: '#64748b', fontSize: 13 }}>Net earning includes the commission and tax deductions saved for each order. Refunds and settlement changes appear in your statement.</p>
      {sales.orders?.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 13, textAlign: 'left' }}>
        <thead><tr>{['Order', 'Item sales', 'Customer discount', 'Admin commission', 'GST on commission', 'TCS', 'TDS', 'Net earning', 'Where your money is'].map(title => <th key={title} style={{ padding: 8 }}>{title}</th>)}</tr></thead>
        <tbody>{sales.orders.map(order => <tr key={order._id}>
          <td style={{ padding: 8 }}>{order.orderNo}</td><td style={{ padding: 8 }}>{money(order.grossAmount)}</td>
          {['totalDiscount', 'commission', 'commissionTax', 'tcs', 'tds', 'netEarnings'].map(key => <td key={key} style={{ padding: 8 }}>{money(order.sellerAmounts?.[key])}</td>)}
          <td style={{ padding: 8 }}>{settlementStatus(order)}</td>
        </tr>)}</tbody>
      </table>{sales.orderCount > sales.orders.length && <p>Showing the latest {sales.orders.length} delivered orders. See Orders for the full list.</p>}</div> : <p>No delivered orders yet.</p>}
    </section>}
    <SellerTaxStatement />
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: 16, fontWeight: 800 }}>Statement <small style={{ fontWeight: 400 }}>(latest 50 entries)</small></div><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}>
        {['Date', 'Reference', 'Description', 'Status', 'Money in', 'Money out'].map((h) => <th key={h} style={{ padding: 12 }}>{h}</th>)}
      </tr></thead><tbody>{ledgerEntries.length ? ledgerEntries.map((entry) => <tr key={entry._id} style={{ borderTop: '1px solid #f1f5f9' }}>
        <td style={{ padding: 12 }}>{new Date(entry.createdAt).toLocaleString('en-IN')}</td><td style={{ padding: 12 }}>{entry.reference || entry.entryNo}</td>
        <td style={{ padding: 12 }}>{entry.description}</td><td style={{ padding: 12 }}>{BUCKETS[entry.bucket] || label(entry.bucket)}</td>
        <td style={{ padding: 12, color: '#15803d' }}>{entry.direction === 'credit' ? money(entry.amount) : '—'}</td>
        <td style={{ padding: 12, color: '#b91c1c' }}>{entry.direction === 'debit' ? money(entry.amount) : '—'}</td>
      </tr>) : <tr><td colSpan="6" style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>{financeError ? 'Ledger could not be loaded. Please retry.' : 'No earnings have been posted to the ledger yet. Check the delivered-order settlement status above.'}</td></tr>}</tbody></table></div>
    </div>
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: 16, fontWeight: 800 }}>Payout requests</div>
      {(financeSummary?.payouts || []).length ? financeSummary.payouts.map((payout) => <div key={payout._id} style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}>
        <span>{payout.payoutNo} · {payout.status === 'APPROVED' ? 'Paid' : payout.status === 'PENDING' ? 'Being processed' : 'Rejected'}</span><strong>{money(payout.amount)}</strong>
      </div>) : <div style={{ padding: 24, color: '#64748b' }}>No payout requests.</div>}
    </div>
  </div>;
};

export default EarningsTab;
