import React, { useEffect, useState } from 'react';
import { adminGet } from '../../../utils/adminApi';
import { rupeesFromPaise as money, WEEKDAYS } from './financeText';

const CHANNEL_NAMES = { ecommerce: 'E-Commerce', quick: 'Quick Commerce', wholesale: 'Wholesale' };

const todoRows = [
  ['snapshotFailed', 'Orders placed without a money breakdown', 'Checkout went through, but the commission breakdown could not be recorded (for example a decimal quantity). Settle them under Reports → Old orders.', 'historical'],
  ['cashOverdue', 'Riders holding COD cash over 24 hours', 'Collected but not handed over within a day. Contact the rider.', 'cod'],
  ['cashToVerify', 'COD handovers to check', 'Riders say they handed over cash. Confirm the amount you received.', 'cod'],
  ['cashMismatch', 'COD amount mismatches', 'Received cash differs from the order amount. Recheck, or write off a shortage.', 'cod'],
  ['needsReview', 'Orders that need your review', 'Automatic processing stopped on these orders. The reason is shown on each order.', 'orders'],
  ['missingRule', 'Orders with no commission rule', 'No commission rule applied when these were ordered, so earnings cannot be added.', 'orders'],
  ['sellerPayouts', 'Seller payout requests', 'Send the bank transfer, then record the bank reference (UTR).', 'seller-payouts'],
  ['riderPayouts', 'Rider payout requests', 'Send the bank/UPI transfer, then record the bank reference (UTR).', 'payouts'],
];

export default function FinanceOverview({ onNavigate }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); setError(''); adminGet('/finance/overview').then(response => setData(response.data)).catch(e => setError(e.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  if (loading) return <p role="status">Loading finance overview…</p>;
  if (error || !data) return <section className="finance-panel"><p role="alert">{error || 'Overview unavailable.'}</p><button type="button" onClick={load}>Retry</button></section>;
  const { flags, policy, todo, totalsPaise: t } = data;
  const live = flags.operations && flags.policyApproved && flags.testsApproved;
  const payouts = flags.payouts && flags.policyApproved && flags.testsApproved;
  const uncovered = (data.commissionCoverage || []).filter(row => row.vendorType === 'general' && !row.active).map(row => CHANNEL_NAMES[row.channel] || row.channel);
  const courier = data.courierCosts || {};
  const setup = [
    [flags.snapshots, 'Order breakdowns are being recorded', 'New orders always record a financial breakdown. Historical orders require a reviewed backfill.'],
    [live, 'Earnings move automatically', 'Earnings move automatically after the order return window ends.'],
    [payouts, 'Payouts are switched on', 'Payout requests and settlements are active.'],
    [data.commissionRulesConfigured, 'A commission rule is switched on', uncovered.length ? `No switched-on rule for: ${uncovered.join(', ')}. Orders there are held until one is set.` : 'Settings → Commission.', 'commissions'],
    [policy.configured, 'Payout and tax policy saved', 'Settings → Payouts & tax.', 'policies'],
    [policy.bankVerificationConfigured, 'Bank account check method saved', 'Needed before any seller payout can be marked paid. Settings → Payouts & tax.', 'policies'],
  ];
  return <section>
    <div className="finance-panel"><h2>Setup checklist</h2>
      <ul className="finance-checklist">{setup.map(([done, title, help, target]) => <li key={title} data-done={done ? 'yes' : 'no'}><strong>{`${done ? '✓' : '✗'} ${title}`}</strong><small>{help}</small>{!done && target && <button type="button" onClick={() => onNavigate(target)}>Open</button>}</li>)}</ul>
    </div>
    <div className="finance-panel"><h2>To do</h2>
      {todoRows.every(([key]) => !todo[key]) ? <p>Nothing needs your attention right now.</p> : <ul className="finance-todo">{todoRows.filter(([key]) => todo[key]).map(([key, title, help, target]) =>
        <li key={key}><strong>{`${todo[key]} · ${title}`}</strong><small>{help}</small><button type="button" onClick={() => onNavigate(target)}>Open</button></li>)}</ul>}
      <p className="finance-muted">{todo.waitingPayment} delivered orders are waiting for payment or COD cash before earnings are added. {todo.onHold} orders are in their return window. {todo.cashWithRiders} COD orders still have cash with the rider.</p>
    </div>
    <div className="finance-grid">
      <div className="finance-panel"><h3>Owed to sellers</h3><dl>
        <div><dt>On hold (return window)</dt><dd>{money(t.sellersOnHold)}</dd></div><div><dt>Available to pay</dt><dd>{money(t.sellersAvailable)}</dd></div>
        <div><dt>Payout requested</dt><dd>{money(t.sellersRequested)}</dd></div><div><dt>Paid so far</dt><dd>{money(t.sellersPaid)}</dd></div>
        <div><dt>Same-day incentives credited</dt><dd>{money(t.sellerSameDayIncentives)}</dd></div></dl>
        {data.unpostedSellerSales?.length > 0 && <div role="status"><p><strong>{money(data.unpostedSellerSales.reduce((sum, row) => sum + row.grossPaise, 0))} delivered item sales await calculation.</strong> These sales have no posted seller earning yet. The net payout amount needs the original terms and payment checks.</p><button type="button" onClick={() => onNavigate('earnings')}>See missing seller earnings</button></div>}
      </div>
      <div className="finance-panel"><h3>Seller Shiprocket charges (prepaid)</h3><dl>
        <div><dt>Charged</dt><dd>{money(t.sellerCourierCharged)}</dd></div><div><dt>Paid by sellers</dt><dd>{money(t.sellerCourierPaid)}</dd></div>
        <div><dt>Still owed</dt><dd>{money(t.sellerCourierOutstanding)}</dd></div></dl>
        <p className="finance-muted">Kept apart from seller earnings, so an unpaid charge never blocks a payout.</p></div>
      <div className="finance-panel"><h3>Owed to riders</h3><dl>
        <div><dt>On hold</dt><dd>{money(t.ridersOnHold)}</dd></div><div><dt>Available to pay</dt><dd>{money(t.ridersAvailable)}</dd></div>
        <div><dt>Payout requested</dt><dd>{money(t.ridersRequested)}</dd></div><div><dt>Paid so far</dt><dd>{money(t.ridersPaid)}</dd></div></dl></div>
      <div className="finance-panel"><h3>Bulkimart</h3><dl>
        <div><dt>Commission earned</dt><dd>{money(t.commission)}</dd></div><div><dt>GST on commission</dt><dd>{money(t.commissionGst)}</dd></div>
        <div><dt>Coupons & coins paid by Bulkimart</dt><dd>{money(t.platformDiscounts)}</dd></div><div><dt>COD shortages absorbed</dt><dd>{money(t.codShortages)}</dd></div>
        <div><dt>TCS withheld ({policy.tcsRatePercent}%)</dt><dd>{money(t.tcs)}</dd></div><div><dt>TDS withheld ({policy.tdsRatePercent}%)</dt><dd>{money(t.tds)}</dd></div>
        <div><dt>COD cash still with riders</dt><dd>{money(t.codCashWithRiders)}</dd></div>
        <div><dt>Customer delivery charges</dt><dd>{money(t.customerDelivery)}</dd></div>
        <div><dt>Courier costs (from provider bills)</dt><dd>{money(t.courierCostActual)}</dd></div></dl></div>
    </div>
    {courier.estimatedOnly > 0 && <div className="finance-panel"><p>{`${courier.estimatedOnly} Shiprocket shipment(s) have only a quote estimate (${money(t.courierCostEstimatedUnverified)} in total), not a provider bill. Estimates are not booked as costs.`}</p>
      <button type="button" onClick={() => onNavigate('courier-costs')}>Record courier bills</button></div>}
    <p className="finance-muted">{`Payouts: ${policy.payoutSchedule === 'weekly' ? `created automatically every ${WEEKDAYS[policy.payoutWeekday]}` : 'sellers and riders request them'} · minimum ₹${policy.sellerMinPayout} for sellers, ₹${policy.riderMinPayout} for riders.`}</p>
    <button type="button" onClick={load}>Refresh</button>
  </section>;
}
