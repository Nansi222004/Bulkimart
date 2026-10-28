import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminGet, adminGetBlob, qs } from '../../../utils/adminApi';
import { rupeesFromPaise as money } from './financeText';
import { DashboardBars } from './DashboardCharts';
import './ReportsTab.css';

// Reports are generated from live records by /api/admin/reports/* (read-only,
// manage_finance). Amounts arrive as integer paise; a null amount means the
// figure is incomplete (an invalid stored record), never zero.
export const REPORT_TABS = [
  { id: 'overview', label: 'Platform Overview', icon: '📊' },
  { id: 'customers', label: 'Consumer Users', icon: '👤' },
  { id: 'vendors', label: 'General Vendors', icon: '🏬' },
  { id: 'delivery', label: 'Delivery Fleet', icon: '🛵' },
  { id: 'orders', label: 'Order Payments', icon: '🧾' },
];
const PRESETS = [{ id: 'today', label: 'Today' }, { id: 'last7', label: 'Last 7 days' }, { id: 'last30', label: 'Last 30 days' }, { id: 'month', label: 'This month' }, { id: 'custom', label: 'Custom range' }];
const TABLE_DEFAULTS = { customers: { sort: 'spend', status: 'all' }, vendors: { sort: 'sales', status: 'all' }, delivery: { sort: 'delivered', status: 'all' }, orders: { sort: 'placed', status: 'all' } };
const STATUS_OPTIONS = {
  customers: [['all', 'All customers'], ['completed', 'With completed orders'], ['repeat', 'Repeat customers'], ['new', 'Registered in period']],
  vendors: [['all', 'All vendors'], ['approved', 'Approved'], ['pending', 'Pending'], ['under_review', 'Under review'], ['incomplete', 'Incomplete'], ['rejected', 'Rejected'], ['suspended', 'Suspended']],
  orders: [['all', 'All orders'], ['completed', 'Delivered'], ['open', 'In progress'], ['cancelled', 'Cancelled']],
  delivery: [['all', 'All partners'], ['approved', 'Approved'], ['pending', 'Pending'], ['under_review', 'Under review'], ['incomplete', 'Incomplete'], ['rejected', 'Rejected'], ['suspended', 'Suspended']],
};
export const istToday = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const count = value => typeof value === 'number' ? value.toLocaleString('en-IN') : '—';
const percent = value => typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '—';
const minutes = value => typeof value === 'number' ? `${value} min` : '—';
const dayLabel = day => new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—';

// Validates a custom range before any request; mirrors the server's own rules.
export function customRangeError(from, to, today = istToday()) {
  if (!from || !to) return 'Choose both a start and an end date.';
  if (to < from) return 'The end date must be on or after the start date.';
  if (to > today) return 'The end date cannot be in the future.';
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 + 1 > 366) return 'Choose a range of at most 366 days.';
  return '';
}

export function MoneyCard({ label, metric, note }) {
  const incomplete = metric?.status === 'incomplete' || metric?.amountPaise === null;
  return <div className={`sa-report-kpi${incomplete ? ' is-incomplete' : ''}`}>
    <span>{label}</span>
    <strong>{incomplete ? 'Incomplete' : money(metric?.amountPaise)}</strong>
    {incomplete && typeof metric?.verifiedSubtotalPaise === 'number' && <small>Valid records: {money(metric.verifiedSubtotalPaise)} · {metric.invalidRecords || 0} need review in Finance Center</small>}
    {!incomplete && note && <small>{note}</small>}
  </div>;
}
export function CountCard({ label, value, note }) {
  return <div className="sa-report-kpi"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

// Daily columns on a shared zero baseline; exact values are in the visually hidden table.
export function ColumnChart({ title, series, field, format = count }) {
  const max = Math.max(0, ...series.map(point => point[field] || 0));
  return <figure className="sa-report-columns">
    <figcaption>{title}</figcaption>
    <div className="sa-report-columns-plot" aria-hidden="true">
      {series.map(point => <span key={point.day} title={`${dayLabel(point.day)}: ${format(point[field] || 0)}`} style={{ height: `${max ? (point[field] || 0) / max * 100 : 0}%` }} />)}
    </div>
    <div className="sa-report-columns-axis" aria-hidden="true"><span>{series.length ? dayLabel(series[0].day) : ''}</span><span>Peak {format(max)}</span><span>{series.length ? dayLabel(series.at(-1).day) : ''}</span></div>
    {/* Wrapped: a <table> ignores the 1px box and would keep its full height,
        stretching the scroll area below the report with blank space. */}
    <div className="sa-report-sr-only"><table><caption>{title}</caption><thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
      <tbody>{series.map(point => <tr key={point.day}><th scope="row">{dayLabel(point.day)}</th><td>{format(point[field] || 0)}</td></tr>)}</tbody></table></div>
  </figure>;
}

export function DataTable({ columns, rows, meta, params, onChange, loading, emptyText }) {
  const sortBy = key => onChange({ sort: key, dir: params.sort === key && params.dir === 'desc' ? 'asc' : 'desc', page: 1 });
  return <div className="sa-report-table-wrap">
    <table className="sa-report-table">
      <thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.numeric ? 'is-number' : ''}
        aria-sort={column.sort && params.sort === column.sort ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        {column.sort ? <button type="button" onClick={() => sortBy(column.sort)}>{column.label}{params.sort === column.sort ? (params.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button> : column.label}
      </th>)}</tr></thead>
      <tbody>
        {loading && !rows.length ? Array.from({ length: 5 }, (_, i) => <tr key={i} className="sa-report-skeleton-row">{columns.map(column => <td key={column.key}><span /></td>)}</tr>)
          : !rows.length ? <tr><td colSpan={columns.length} className="sa-report-empty">{emptyText}</td></tr>
          : rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key} className={column.numeric ? 'is-number' : ''}>{column.render(row)}</td>)}</tr>)}
      </tbody>
    </table>
    {Pagination({ meta, loading, onChange })}
  </div>;
}
export function Pagination({ meta, loading, onChange }) {
  if (!meta || meta.total <= 0) return null;
  return <nav className="sa-report-pagination" aria-label="Table pages">
    <span>{((meta.page - 1) * meta.limit + 1).toLocaleString('en-IN')}–{Math.min(meta.page * meta.limit, meta.total).toLocaleString('en-IN')} of {meta.total.toLocaleString('en-IN')}</span>
    <button type="button" disabled={loading || meta.page <= 1} onClick={() => onChange({ page: meta.page - 1 })}>Previous</button>
    <span aria-current="page">Page {meta.page} of {Math.max(1, meta.pages)}</span>
    <button type="button" disabled={loading || meta.page >= meta.pages} onClick={() => onChange({ page: meta.page + 1 })}>Next</button>
  </nav>;
}

// Order Payments as cards: identity on top, admin earning on the right, the money split as a wrapping row of figures.
const ORDER_SORTS = [['placed', 'Newest first'], ['paid', 'Customer paid'], ['admin', 'Admin earning'], ['commission', 'Commission'], ['seller', 'Seller earning'], ['rider', 'Delivery earning'], ['refunds', 'Refunds']];
export function OrderList({ rows, meta, params, onChange, loading, emptyText }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = key => setOpen(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const figure = (label, value, note) => <div className="sa-order-figure"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
  return <div className="sa-order-list">
    {loading && !rows.length ? Array.from({ length: 3 }, (_, i) => <div key={i} className="sa-order-card is-skeleton"><span /><span /></div>)
      : !rows.length ? <p className="sa-report-empty">{emptyText}</p>
      : rows.map(r => <article key={r.id} className={`sa-order-card${open.has(r.id) ? ' is-open' : ''}`}>
        <header className="sa-order-card-head">
          <button type="button" className="sa-report-expand" aria-expanded={open.has(r.id)} aria-label={`${open.has(r.id) ? 'Hide' : 'Show'} breakdown for ${r.orderNo}`} onClick={() => toggle(r.id)}>{open.has(r.id) ? '▾' : '▸'}</button>
          <div className="sa-order-card-id">
            <strong className="sa-order-no">{r.orderNo}</strong>
            <span className="sa-order-meta">{dateTime(r.placedAt)} · <span className={`sa-report-status is-${r.status}`}>{r.status.replace(/_/g, ' ')}</span> · {PAYMENT_LABELS[r.paymentMethod] || r.paymentMethod}</span>
            <span className="sa-order-parties">{r.customer} → {r.sellers.join(', ') || '—'}</span>
          </div>
          <div className="sa-order-card-admin"><span>Admin earning</span><strong className={r.adminEarningPaise < 0 ? 'sa-report-negative' : ''}>{money(r.adminEarningPaise)}</strong><small className={`sa-report-basis is-${r.basis}`}>{BASIS_LABELS[r.basis]}</small></div>
        </header>
        <div className="sa-order-figures">
          {figure('Customer paid', money(r.paidPaise), r.refundsPaise > 0 ? `${money(r.refundsPaise)} refunded` : null)}
          {figure('Seller earning', money(r.sellerEarningPaise))}
          {figure('Delivery earning', money(r.riderEarningPaise), `${r.riderName || r.riderBasis}${r.riderTipPaise > 0 ? ` · +${money(r.riderTipPaise)} tip` : ''}`)}
          {figure('Commission', money(r.commissionPaise), r.commissionGstPaise > 0 ? `+ ${money(r.commissionGstPaise)} GST` : null)}
          {figure('TCS / TDS', r.tcsPaise === null ? '—' : money(r.tcsPaise + r.tdsPaise), r.tcsPaise === null ? null : `${money(r.tcsPaise)} / ${money(r.tdsPaise)}`)}
        </div>
        {open.has(r.id) && <OrderBreakdown order={r} />}
      </article>)}
    {Pagination({ meta, loading, onChange })}
  </div>;
}

function Definitions({ items }) {
  const rows = Object.entries(items || {}).filter(([, text]) => text);
  if (!rows.length) return null;
  return <details className="sa-report-definitions"><summary>How these figures are calculated</summary><dl>{rows.map(([key, text]) => <React.Fragment key={key}><dt>{key}</dt><dd>{text}</dd></React.Fragment>)}</dl></details>;
}

export function Overview({ data }) {
  const k = data.kpis, c = data.counts;
  return <>
    <div className="sa-report-kpis">
      <MoneyCard label="Gross order value" metric={k.grossOrderValue} note={`${count(c.totalOrders)} orders placed`} />
      <MoneyCard label="Net sales" metric={k.netSales} note="Completed sales − completed refunds" />
      <CountCard label="Completed orders" value={count(c.completedOrders)} note={`of ${count(c.totalOrders)} placed · ${count(c.cancelledOrders)} cancelled`} />
      <MoneyCard label="Average order value" metric={k.averageOrderValue} note="Completed orders" />
      <MoneyCard label="Platform commission" metric={k.platformCommission} note="Posted to ledger" />
      <MoneyCard label="Refunds completed" metric={k.refunds} note={`${count(k.refunds.count)} refunds`} />
      <CountCard label="Active customers" value={count(c.activeCustomers)} note="Placed an order in the period" />
      <CountCard label="Active sellers" value={count(c.activeSellers)} note="Received an order in the period" />
      <CountCard label="Deliveries completed" value={count(c.deliveriesCompleted)} note={`Success rate ${percent(c.deliverySuccessRate)} · ${count(c.deliveriesFailed)} failed`} />
    </div>
    <h3 className="sa-report-subheading">Money flow — separate measures, never added together</h3>
    <div className="sa-report-kpis is-compact">
      <MoneyCard label="Completed sales" metric={k.completedSales} />
      <MoneyCard label="Cancelled order value" metric={k.cancelledOrderValue} />
      <MoneyCard label="Seller earnings" metric={k.sellerEarnings} />
      <MoneyCard label="Online payments captured" metric={k.paymentsCaptured} />
      <MoneyCard label="COD cash verified" metric={k.codVerified} />
      <MoneyCard label="Refunds awaiting payout" metric={k.pendingRefunds} note={`${count(k.pendingRefunds.count)} returns (current)`} />
    </div>
    {data.disclosures?.unattributedCompletedOrders > 0 && <p className="sa-report-note" role="note">{data.disclosures.unattributedCompletedOrders} delivered order(s) have no recorded delivery time and cannot be placed in any period.</p>}
    <div className="sa-report-charts">
      <section className="sa-report-card"><ColumnChart title="Completed sales per day" series={data.series} field="completedSalesPaise" format={money} /></section>
      <section className="sa-report-card"><ColumnChart title="Orders placed per day" series={data.series} field="ordersPlaced" /></section>
      <section className="sa-report-card">{data.statuses.length ? <DashboardBars title="Orders placed by current status" rows={data.statuses.map(row => ({ key: row.key, label: row.key.replace(/_/g, ' '), value: row.count }))} /> : <p className="sa-report-empty">No orders in this period.</p>}</section>
      <section className="sa-report-card">{data.vendors.length ? <DashboardBars title="Completed merchandise by vendor (top 10)" rows={data.vendors.filter(row => row.merchandisePaise !== null).map(row => ({ key: row.sellerId, label: row.name, value: row.merchandisePaise }))} formatValue={money} /> : <p className="sa-report-empty">No completed sales in this period.</p>}</section>
      <section className="sa-report-card"><ColumnChart title="Refunds completed per day" series={data.series} field="refundsPaise" format={money} /></section>
    </div>
    <Definitions items={Object.fromEntries(Object.entries(k).map(([key, metric]) => [key.replace(/([A-Z])/g, ' $1').toLowerCase(), metric.basis]))} />
  </>;
}

const tableColumns = {
  customers: [
    { key: 'name', label: 'Customer', sort: 'name', render: r => <><strong>{r.name}</strong>{r.isNew && <span className="sa-report-badge">New</span>}<small>{r.phone || 'No phone'}</small></> },
    { key: 'ordersPlaced', label: 'Orders placed', sort: 'orders', numeric: true, render: r => count(r.ordersPlaced) },
    { key: 'completedOrders', label: 'Completed', sort: 'completed', numeric: true, render: r => count(r.completedOrders) },
    { key: 'spend', label: 'Completed spend', sort: 'spend', numeric: true, render: r => r.spendPaise === null ? 'Incomplete' : money(r.spendPaise) },
    { key: 'lastOrderAt', label: 'Last order', sort: 'lastOrder', render: r => dateTime(r.lastOrderAt) },
    { key: 'registeredAt', label: 'Registered', render: r => dateTime(r.registeredAt) },
  ],
  vendors: [
    { key: 'name', label: 'Vendor', sort: 'name', render: r => <><strong>{r.name}</strong><small className={`sa-report-status is-${r.status}`}>{r.status.replace(/_/g, ' ')}</small>{r.incomplete && <small className="sa-report-warning">Some records need review</small>}</> },
    { key: 'ordersPlaced', label: 'Orders', sort: 'orders', numeric: true, render: r => `${count(r.ordersPlaced)} / ${count(r.completedOrders)} done` },
    { key: 'sales', label: 'Completed sales', sort: 'sales', numeric: true, render: r => money(r.salesPaise) },
    { key: 'refunds', label: 'Refunds', sort: 'refunds', numeric: true, render: r => money(r.refundsPaise) },
    { key: 'commission', label: 'Commission', sort: 'commission', numeric: true, render: r => money(r.commissionPaise) },
    { key: 'earnings', label: 'Seller earnings', sort: 'earnings', numeric: true, render: r => money(r.earningsPaise) },
    { key: 'settlements', label: 'Settled / pending', numeric: true, render: r => <>{money(r.settlementsPaidPaise)}<small>{money(r.settlementsPendingPaise)} pending</small></> },
  ],
  delivery: [
    { key: 'name', label: 'Delivery partner', sort: 'name', render: r => <><strong>{r.name}</strong><small>{[r.vehicle, r.phone].filter(Boolean).join(' · ') || '—'}</small><small className={`sa-report-status is-${r.status}`}>{r.status.replace(/_/g, ' ')}</small></> },
    { key: 'assigned', label: 'Assigned', sort: 'assigned', numeric: true, render: r => count(r.assigned) },
    { key: 'delivered', label: 'Delivered / failed / rejected', sort: 'delivered', numeric: true, render: r => `${count(r.delivered)} / ${count(r.failed)} / ${count(r.rejected)}` },
    { key: 'successRate', label: 'Success', sort: 'successRate', numeric: true, render: r => percent(r.successRate) },
    { key: 'avgDurationMinutes', label: 'Avg time', numeric: true, render: r => minutes(r.avgDurationMinutes) },
    { key: 'earnings', label: 'Recorded earnings', numeric: true, render: r => money(r.earningsPaise) },
    { key: 'cod', label: 'COD collected', sort: 'cod', numeric: true, render: r => money(r.codCollectedPaise) },
    { key: 'outstanding', label: 'Cash held now', sort: 'outstanding', numeric: true, render: r => money(r.cashOutstandingPaise) },
  ],
};
const PAYMENT_LABELS = { online: 'Online', cod: 'Cash on delivery', wallet: 'Wallet', unknown: 'Unknown payment' };
const BASIS_LABELS = { posted: 'Posted', expected: 'Expected', cancelled: 'Cancelled', unavailable: 'Not available' };

// The full money trail of one order: where the customer's payment went, and each item's split.
export function OrderBreakdown({ order: r }) {
  const item = (label, value, note) => <div className="sa-order-split-row"><dt>{label}{note && <small>{note}</small>}</dt><dd>{value}</dd></div>;
  return <div className="sa-order-breakdown">
    <div className="sa-order-split">
      <section><h4>Customer paid</h4><dl>
        {item('Items', money(r.merchandisePaise))}{item('Discounts', r.discountPaise === null ? '—' : `− ${money(r.discountPaise)}`)}
        {item('Delivery fee', money(r.deliveryFeePaise))}{r.tipPaise > 0 && item('Tip for rider', money(r.tipPaise))}{r.donationPaise > 0 && item('Donation', money(r.donationPaise))}
        {item(<strong>Total paid</strong>, <strong>{money(r.paidPaise)}</strong>)}{r.refundsPaise > 0 && item('Refunded', `− ${money(r.refundsPaise)}`)}
      </dl></section>
      <section><h4>Where it goes</h4><dl>
        {item('Seller earning', money(r.sellerEarningPaise), 'After commission, GST, TCS and TDS')}
        {item('Delivery partner', money(r.riderEarningPaise), r.riderName ? `${r.riderName}${r.riderTipPaise > 0 ? ` · plus ${money(r.riderTipPaise)} tip` : ''}` : r.riderBasis)}
        {item('Platform commission', money(r.commissionPaise))}{item('GST on commission', money(r.commissionGstPaise), 'Owed to government')}
        {item('TCS + TDS withheld', r.tcsPaise === null ? '—' : money(r.tcsPaise + r.tdsPaise), 'Deposited with government')}
        {item('Product GST in prices', money(r.productGstPaise), 'Seller’s tax')}
      </dl></section>
      <section><h4>Admin earning</h4><dl>
        {item('Commission', money(r.commissionPaise))}{item('Delivery fee income', money(r.deliveryIncomePaise))}
        {item('Delivery partner pay', r.riderEarningPaise === null ? '—' : `− ${money(r.riderEarningPaise)}`)}{item('Discounts funded by Bulkimart', r.platformDiscountPaise === null ? '—' : `− ${money(r.platformDiscountPaise)}`)}
        {item(<strong>Admin earning</strong>, <strong>{money(r.adminEarningPaise)}</strong>, BASIS_LABELS[r.basis])}
      </dl></section>
    </div>
    {r.lines.length > 0 ? <div className="sa-report-table-wrap"><table className="sa-report-table sa-order-lines">
      <caption>Item breakdown</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Seller</th><th scope="col" className="is-number">Price</th><th scope="col" className="is-number">Discount</th><th scope="col" className="is-number">Product GST</th><th scope="col" className="is-number">Commission</th><th scope="col" className="is-number">GST on comm.</th><th scope="col" className="is-number">TCS / TDS</th><th scope="col" className="is-number">Seller net</th></tr></thead>
      <tbody>{r.lines.map(line => <tr key={line.itemId}><td><strong>{line.name}</strong><small>Qty {line.qty}{line.ruleMissing ? ' · no commission rule' : ''}</small></td><td>{line.seller}</td>
        <td className="is-number">{money(line.grossPaise)}</td><td className="is-number">{money(line.discountPaise)}</td>
        <td className="is-number">{money(line.productGstPaise)}{line.gstRatePercent !== null && <small>{line.gstRatePercent}%</small>}</td><td className="is-number">{money(line.commissionPaise)}</td>
        <td className="is-number">{money(line.commissionGstPaise)}</td><td className="is-number">{money(line.tcsPaise)} / {money(line.tdsPaise)}</td><td className="is-number">{money(line.sellerNetPaise)}</td></tr>)}</tbody>
    </table></div> : <p className="sa-report-note">This order has no checkout finance snapshot, so an item-level split is not available.</p>}
  </div>;
}

export function OrderPayments({ data, ...table }) {
  const t = data.totals;
  return <>
    <div className="sa-report-kpis">
      <MoneyCard label="Customer payments" metric={{ amountPaise: t.paidPaise }} note={`${count(t.orders)} orders · ${count(t.cancelledOrders)} cancelled`} />
      <MoneyCard label="Admin earning" metric={{ amountPaise: t.adminEarningPaise }} note={`${count(t.completedOrders)} delivered orders`} />
      <MoneyCard label="Seller earnings" metric={{ amountPaise: t.sellerEarningPaise }} note="Delivered orders" />
      <MoneyCard label="Delivery partner earnings" metric={{ amountPaise: t.riderEarningPaise }} note="Excluding tips" />
      <MoneyCard label="Platform commission" metric={{ amountPaise: t.commissionPaise }} note={t.commissionGstPaise !== null ? `+ ${money(t.commissionGstPaise)} GST on commission` : undefined} />
      <MoneyCard label="TCS + TDS withheld" metric={{ amountPaise: t.tcsPaise === null || t.tdsPaise === null ? null : t.tcsPaise + t.tdsPaise }} note={t.tcsPaise !== null ? `TCS ${money(t.tcsPaise)} · TDS ${money(t.tdsPaise)}` : undefined} />
      <MoneyCard label="Product GST in prices" metric={{ amountPaise: t.productGstPaise }} note="Sellers’ tax" />
      <MoneyCard label="Refunds" metric={{ amountPaise: t.refundsPaise }} note="On these orders" />
    </div>
    {t.incompleteOrders > 0 && <p className="sa-report-note" role="note">{t.incompleteOrders} order(s) have no checkout finance snapshot or delivery pay, so part of their split shows “—” and is left out of the totals.</p>}
    <TableReport tab="orders" data={data} {...table} />
    <Definitions items={data.definitions} />
  </>;
}

export function TableReport({ tab, data, params, onChange, loading }) {
  const [search, setSearch] = useState(params.search);
  useEffect(() => setSearch(params.search), [params.search, tab]);
  // Debounce typing; one request per pause, never per keystroke.
  useEffect(() => { if (search === params.search) return; const timer = setTimeout(() => onChange({ search, page: 1 }), 350); return () => clearTimeout(timer); }, [search]);
  const noun = { customers: 'customers', vendors: 'vendors', delivery: 'delivery partners', orders: 'orders' }[tab];
  return <section className="sa-report-card">
    <div className="sa-report-filters">
      <label className="sa-report-search"><span className="sa-report-sr-only">Search {noun}</span>
        <input type="search" value={search} maxLength={80} placeholder={tab === 'orders' ? 'Search by order number, customer or seller…' : `Search ${noun} by name${tab === 'vendors' ? '' : ' or phone'}…`} onChange={event => setSearch(event.target.value)} />
      </label>
      <label><span className="sa-report-sr-only">Filter {noun}</span>
        <select value={params.status} onChange={event => onChange({ status: event.target.value, page: 1 })}>{STATUS_OPTIONS[tab].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </label>
      {tab === 'orders' && <label className="sa-report-sort"><span>Sort by</span>
        <select value={params.sort} onChange={event => onChange({ sort: event.target.value, dir: 'desc', page: 1 })}>{ORDER_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </label>}
    </div>
    {tab === 'orders' ? <OrderList rows={data?.rows || []} meta={data?.meta} params={params} onChange={onChange} loading={loading}
      emptyText={params.search || params.status !== 'all' ? 'No orders match these filters.' : 'No orders were placed in this period.'} />
    : <DataTable columns={tableColumns[tab]} rows={data?.rows || []} meta={data?.meta} params={params} onChange={onChange} loading={loading}
      emptyText={params.search || params.status !== 'all' ? `No ${noun} match these filters.` : tab === 'customers' ? 'No customer placed or completed an order in this period.' : `No ${noun} yet.`} />}
  </section>;
}

export function Customers({ data, ...table }) {
  const t = data.totals;
  return <>
    <div className="sa-report-kpis">
      <CountCard label="Registered customers" value={count(t.registeredCustomers)} note="All time, as of now" />
      <CountCard label="New registrations" value={count(t.newRegistrations)} note="In the period" />
      <CountCard label="Active customers" value={count(t.activeCustomers)} note="Placed an order in the period" />
      <CountCard label="With completed orders" value={count(t.customersWithCompletedOrders)} />
      <CountCard label="Repeat customers" value={count(t.repeatCustomers)} note="2+ orders in the period" />
    </div>
    <div className="sa-report-charts">
      <section className="sa-report-card"><ColumnChart title="New registrations per day" series={data.series} field="registrations" /></section>
      <section className="sa-report-card"><ColumnChart title="Active customers per day" series={data.series} field="activeCustomers" /></section>
    </div>
    <TableReport tab="customers" data={data} {...table} />
    <Definitions items={data.definitions} />
  </>;
}

export function Vendors({ data, ...table }) {
  const t = data.totals, scope = t.scope === 'filtered vendors' ? 'Filtered vendors' : 'All vendors';
  return <>
    <div className="sa-report-kpis">
      <CountCard label="Vendors" value={count(t.totalVendors)} note={`${count(t.activeVendors)} approved · ${count(t.vendorsWithSales)} with sales`} />
      <MoneyCard label="Completed sales" metric={{ amountPaise: t.salesPaise }} note={scope} />
      <MoneyCard label="Refunds" metric={{ amountPaise: t.refundsPaise }} note={scope} />
      <MoneyCard label="Platform commission" metric={{ amountPaise: t.commissionPaise }} note={scope} />
      <MoneyCard label="Seller earnings" metric={{ amountPaise: t.earningsPaise }} note={scope} />
      <MoneyCard label="Settlements paid" metric={{ amountPaise: t.settlementsPaidPaise }} note="Processed in the period" />
      <MoneyCard label="Settlements pending" metric={{ amountPaise: t.settlementsPendingPaise }} note="Awaiting processing now" />
    </div>
    <section className="sa-report-card">{data.topProducts.length ? <DashboardBars title="Top products by completed sales" rows={data.topProducts.filter(row => row.salesPaise !== null).map(row => ({ key: row.productId, label: `${row.name} · ${row.seller} · ${row.units} ${row.units === 1 ? 'unit' : 'units'}`, value: row.salesPaise }))} formatValue={money} /> : <p className="sa-report-empty">No completed product sales in this period.</p>}</section>
    <TableReport tab="vendors" data={data} {...table} />
    <Definitions items={data.definitions} />
  </>;
}

export function Delivery({ data, ...table }) {
  const t = data.totals, cash = data.cash;
  return <>
    <div className="sa-report-kpis">
      <CountCard label="Trips assigned" value={count(t.assigned)} note={`${count(t.forward)} deliveries · ${count(t.returnPickups)} return pickups`} />
      <CountCard label="Delivered" value={count(t.delivered)} note={`${count(t.inProgress)} still in progress`} />
      <CountCard label="Failed / rejected" value={`${count(t.failed)} / ${count(t.rejected)}`} note="Rejected trips are reassigned" />
      <CountCard label="Success rate" value={percent(t.successRate)} note="Delivered ÷ (delivered + failed)" />
      <CountCard label="Average delivery time" value={minutes(t.avgDurationMinutes)} note="Start to completion" />
      <CountCard label="Delivery partners" value={count(t.totalPartners)} note={`${count(t.activePartners)} approved`} />
    </div>
    <h3 className="sa-report-subheading">COD cash</h3>
    <div className="sa-report-kpis is-compact">
      <MoneyCard label="Collected by riders" metric={cash.collected} note="In the period" />
      <MoneyCard label="Verified by finance" metric={cash.verified} note="In the period" />
      <MoneyCard label="Handover awaiting verification" metric={cash.reportedAwaitingVerification} note="Current" />
      <MoneyCard label="Cash held by riders now" metric={{ amountPaise: cash.outstandingPaise }} note={cash.discrepancies ? `${cash.discrepancies} disputed or mismatched` : 'No open discrepancies'} />
    </div>
    <TableReport tab="delivery" data={data} {...table} />
    <Definitions items={{ ...data.definitions, cashHeld: cash.outstandingBasis }} />
  </>;
}

const download = async path => {
  const { blob, filename } = await adminGetBlob(path);
  if (!blob.size) throw new Error('The export was empty. Please retry.');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
};

export default function ReportsTab() {
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('last30');
  const [draft, setDraft] = useState(() => ({ from: '', to: istToday() })), [custom, setCustom] = useState(null), [rangeError, setRangeError] = useState('');
  const [tables, setTables] = useState(() => Object.fromEntries(Object.entries(TABLE_DEFAULTS).map(([key, value]) => [key, { search: '', dir: 'desc', page: 1, limit: 20, ...value }])));
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const params = tables[tab];
  const rangeQuery = preset === 'custom' ? (custom ? { range: 'custom', from: custom.from, to: custom.to } : null) : { range: preset };
  const tableQuery = params ? { search: params.search, status: params.status, sort: params.sort, dir: params.dir, page: params.page, limit: params.limit } : {};
  // Paging/sorting/filtering may keep the visible figures while loading; a new
  // report, period or Refresh clears them so stale numbers never pass as current.
  const scopeKey = JSON.stringify([tab, rangeQuery, reload]);
  const queryKey = JSON.stringify([scopeKey, tableQuery]);

  useEffect(() => {
    if (!rangeQuery) { setLoading(false); return undefined; }
    const request = ++generation.current, controller = new AbortController();
    setLoading(true); setError('');
    // Clear numbers from another report or period rather than show them as current.
    setData(previous => previous?.scopeKey === scopeKey ? previous : null);
    adminGet(`/reports/${tab}${qs({ ...rangeQuery, ...tableQuery })}`, { signal: controller.signal })
      .then(body => { if (request === generation.current) setData({ ...body.data, scopeKey }); })
      .catch(err => { if (request === generation.current && err.name !== 'AbortError') { setError(err.message || 'Could not load the report.'); setData(null); } })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [queryKey]);

  const changeTable = useCallback(patch => setTables(current => ({ ...current, [tab]: { ...current[tab], ...patch } })), [tab]);
  const choosePreset = id => { setPreset(id); setRangeError(''); setExportMessage(null); if (id !== 'custom') setCustom(null); setTables(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, page: 1 }]))); };
  const applyCustom = event => {
    event.preventDefault();
    const message = customRangeError(draft.from, draft.to);
    setRangeError(message);
    if (!message) { setCustom({ ...draft }); setTables(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, page: 1 }]))); }
  };
  const runExport = async () => {
    if (exporting || !rangeQuery) return;
    setExporting(true); setExportMessage(null);
    try {
      const filename = await download(`/reports/export${qs({ report: tab, ...rangeQuery, ...(params ? { search: params.search, status: params.status, sort: params.sort, dir: params.dir } : {}) })}`);
      setExportMessage({ ok: true, text: `Downloaded ${filename}` });
    } catch (err) { setExportMessage({ ok: false, text: err.message || 'Export failed. Please retry.' }); }
    finally { setExporting(false); }
  };
  const tableProps = { params, onChange: changeTable, loading };
  const current = data && data.report === tab ? data : null;

  return <div className="sa-reports">
    <div className="sa-report-tabs" role="tablist" aria-label="Report"><span className="sa-report-tabs-label" aria-hidden="true">Report</span>
      {REPORT_TABS.map(item => <button key={item.id} type="button" role="tab" id={`report-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="report-panel"
        className={tab === item.id ? 'is-active' : ''} onClick={() => { setTab(item.id); setExportMessage(null); }}><span aria-hidden="true">{item.icon}</span> {item.label}</button>)}
    </div>

    <div className="sa-report-toolbar">
      <div className="sa-report-presets" role="group" aria-label="Date range">
        {PRESETS.map(item => <button key={item.id} type="button" aria-pressed={preset === item.id} className={preset === item.id ? 'is-active' : ''} onClick={() => choosePreset(item.id)}>{item.label}</button>)}
      </div>
      <div className="sa-report-actions">
        <button type="button" className="sa-report-secondary" disabled={loading || !rangeQuery} onClick={() => setReload(n => n + 1)}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button type="button" className="sa-report-primary" disabled={exporting || !rangeQuery || loading} aria-busy={exporting} onClick={runExport}>{exporting ? 'Preparing CSV…' : 'Export CSV'}</button>
      </div>
    </div>
    {preset === 'custom' && <form className="sa-report-custom" onSubmit={applyCustom} noValidate>
      <label>From<input type="date" value={draft.from} max={istToday()} onChange={event => setDraft(d => ({ ...d, from: event.target.value }))} /></label>
      <label>To<input type="date" value={draft.to} max={istToday()} onChange={event => setDraft(d => ({ ...d, to: event.target.value }))} /></label>
      <button type="submit" className="sa-report-primary">Apply range</button>
      {rangeError && <p className="sa-report-error" role="alert">{rangeError}</p>}
      {!custom && !rangeError && <p className="sa-report-hint">Choose dates and apply. Ranges use India time and can span up to 366 days.</p>}
    </form>}
    {exportMessage && <p className={exportMessage.ok ? 'sa-report-success' : 'sa-report-error'} role={exportMessage.ok ? 'status' : 'alert'}>{exportMessage.text}</p>}

    <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${tab}`} aria-busy={loading}>
      {current && <p className="sa-report-period">{dayLabel(current.range.from)} – {dayLabel(current.range.to)} · {current.range.days} day{current.range.days === 1 ? '' : 's'} · India time · generated {dateTime(current.asOf)}</p>}
      {error ? <div className="sa-report-card sa-report-error-card" role="alert"><strong>The report could not be loaded.</strong><p>{error}</p><button type="button" className="sa-report-secondary" onClick={() => setReload(n => n + 1)}>Try again</button></div>
        : !rangeQuery ? null
        : !current ? <div className="sa-report-kpis" aria-label="Loading report">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sa-report-kpi is-skeleton"><span /><strong /></div>)}</div>
        : tab === 'overview' ? <Overview data={current} />
        : tab === 'customers' ? <Customers data={current} {...tableProps} />
        : tab === 'vendors' ? <Vendors data={current} {...tableProps} />
        : tab === 'orders' ? <OrderPayments data={current} {...tableProps} />
        : <Delivery data={current} {...tableProps} />}
    </div>
  </div>;
}
