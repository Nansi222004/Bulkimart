import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPut, qs } from '../../../utils/adminApi';
import './FbbTab.css';

/**
 * Fulfilled by Bulkimart — admin workspace (/api/admin/fbb).
 * Warehouse work (warehouses, products, receiving, stock, adjustments, orders, returns) needs `manage_warehouse`;
 * FBB charges and billing need `manage_finance`. The server enforces both; a section a person may not use
 * shows the server's refusal instead of data.
 * Notifications open a section through `/admin/fbb?section=<id>` (see utils/serviceNotifications.js).
 */
const SECTIONS = [
  ['overview', 'Overview'], ['products', 'Products'], ['receiving', 'Receiving'], ['stock', 'Stock'], ['adjustments', 'Adjustments'],
  ['orders', 'Orders'], ['returns', 'Returns'], ['warehouses', 'Warehouses'], ['pilot', 'Pilot sellers'], ['charges', 'Charges & billing'],
];
const SECTION_IDS = SECTIONS.map(([id]) => id);
const sectionFromUrl = () => {
  const s = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('section') : null;
  return SECTION_IDS.includes(s) ? s : null;
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const key = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rcpt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const sellerName = (s) => s?.businessName || s?.storeName || '—';

/* ------------------------------------------------------------------ shared UI ------------------------------------ */
const GOOD = ['posted', 'approved', 'active', 'delivered', 'handed_over', 'completed', 'refunded', 'settled', 'yes', 'in_stock'];
const BAD = ['cancelled', 'rejected', 'failed', 'reversed', 'no'];
const WARN = ['draft', 'pending', 'awaiting_acceptance', 'return_requested', 'under_review', 'awaiting_return', 'placed', 'waiting'];
function Badge({ value, label }) {
  const v = String(value ?? '').toLowerCase();
  const tone = GOOD.includes(v) ? 'is-good' : BAD.includes(v) ? 'is-bad' : WARN.includes(v) ? 'is-warn' : 'is-info';
  return <span className={`fbb-badge ${tone}`}>{label ?? String(value ?? '—').replace(/_/g, ' ')}</span>;
}

const Btn = ({ primary, ghost, className = '', ...props }) => (
  <button type="button" className={`fbb-btn${primary ? ' is-primary' : ''}${ghost ? ' is-ghost' : ''} ${className}`.trim()} {...props} />
);

/** A stacked form field: label on top, control below, optional hint. */
const Field = ({ label, hint, span, children }) => (
  <label className={`fbb-field${span ? ` span-${span}` : ''}`}>
    <span className="fbb-field-label">{label}</span>
    {children}
    {hint && <span className="fbb-field-hint">{hint}</span>}
  </label>
);

/** Card header: title + short description on the left, an optional action on the right. */
const CardHead = ({ title, children, action }) => (
  <div className="fbb-card-head">
    <div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
    {action && <div className="fbb-card-action">{action}</div>}
  </div>
);

/** `expand(row)` renders a full-width panel under that row (used for delivery choice, inspection, pickup). */
function Table({ columns, rows, empty = 'Nothing here.', expand }) {
  if (!rows?.length) return <p className="fbb-empty">{empty}</p>;
  return (
    <div className="fbb-table-wrap">
      <table className="fbb-table">
        <thead><tr>{columns.map(([label], i) => <th key={label || `c${i}`}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => {
          const extra = expand?.(row);
          return (
            <React.Fragment key={row._id || row.id || i}>
              <tr>{columns.map(([label, render], c) => <td key={label || `c${c}`} className={label ? undefined : 'fbb-actions-cell'}>{render(row)}</td>)}</tr>
              {extra && <tr className="fbb-expand-row"><td colSpan={columns.length}>{extra}</td></tr>}
            </React.Fragment>
          );
        })}</tbody>
      </table>
    </div>
  );
}

const Segmented = ({ options, value, onChange }) => (
  <div className="fbb-seg" role="tablist">
    {options.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'is-active' : ''} onClick={() => onChange(v)}>{l}</button>)}
  </div>
);

/** Load once per section; `error` holds the server's refusal (e.g. missing permission). */
function useLoad(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try { setData((await adminGet(path)).data); } catch (e) { setError(e.message || 'Could not load'); }
  }, [path]);
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, error, reload };
}

function useAct() {
  const { triggerToast } = useAdmin();
  const [busy, setBusy] = useState(false);
  const act = useCallback(async (fn, after) => {
    setBusy(true);
    try { const res = await fn(); triggerToast?.(res?.message || 'Done'); await after?.(res); return res; }
    catch (e) { triggerToast?.(e.message || 'That did not work', { type: 'error' }); return null; }
    finally { setBusy(false); }
  }, [triggerToast]);
  return { busy, act };
}

const Refused = ({ error }) => error ? <p role="alert" className="fbb-error">{error}</p> : null;
const Loading = () => <p className="fbb-loading">Loading…</p>;

/* ------------------------------------------------------------------ overview ------------------------------------- */
const FLOW = [
  ['Seller', 'Lists a product with “Fulfilled by Bulkimart” (or moves an existing one) and sends the stock to the warehouse.', 'products'],
  ['Warehouse team', 'Counts the delivery under Receiving, then verifies and posts it. Accepted units go on sale.', 'receiving'],
  ['Customer', 'Orders the product. The order appears under Orders → To fulfil (you also get a notification).', 'orders'],
  ['Warehouse team', 'Accepts, picks and packs the order, then sends it with a Bulkimart rider or Shiprocket.', 'orders'],
  ['Finance', 'Storage, packaging and fulfilment charges are booked and deducted from the seller’s earnings.', 'charges'],
];
const ROLES = [
  ['Seller', 'Seller app → Fulfilled by Bulkimart', 'Chooses FBB for a product, ships stock to the warehouse, sees stock, receipts and charges, can pay charges in advance. Cannot change warehouse stock.'],
  ['Warehouse team', 'Admin with “manage_warehouse” (or Super Admin)', 'Products, Receiving, Stock, Adjustments, Orders, Returns, Warehouses and Pilot sellers.'],
  ['Finance team', 'Admin with “manage_finance” (or Super Admin)', 'Charges & billing: rate versions, outstanding by seller, deductions, reversals.'],
  ['Rider / Shiprocket', 'Delivery app or courier', 'Picks the packed parcel up from the warehouse (not the seller’s shop) and delivers it.'],
];

function Overview({ go }) {
  const { data, error } = useLoad('/fbb/overview');
  if (error) return <Refused error={error} />;
  if (!data) return <Loading />;
  // Server switches are internal and not shown here; the admin sees only what is left to set up.
  const { ready, blockers = [] } = data.readiness || {};
  const stats = [
    ['Active warehouses', data.counts.warehouses, false, 'warehouses'], ['Pilot sellers', data.counts.pilotSellers ?? 0, false, 'pilot'],
    ['FBB products', data.counts.fbbProducts, false, 'products'], ['Orders to fulfil', data.counts.openOrders, true, 'orders'],
    ['Stock on the way', data.counts.shipmentsOnTheWay ?? 0, true, 'receiving'], ['Receipts to post', data.counts.draftReceipts, true, 'receiving'], ['Adjustments to approve', data.counts.pendingAdjustments, true, 'adjustments'],
  ];
  return (
    <>
      <section>
        <div className={`fbb-setup${ready ? ' is-ready' : ''}`}>
          <span className="fbb-setup-icon" aria-hidden="true">{ready ? '✅' : '🛠️'}</span>
          <div style={{ flex: 1 }}>
            <h3>{ready ? 'FBB is ready' : 'Finish setting up FBB'}</h3>
            {ready
              ? <p style={{ marginBottom: 0 }}>Sellers added under Pilot sellers can choose Fulfilled by Bulkimart, send stock and sell from the warehouse.</p>
              : <ul className="fbb-setup-list">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
          </div>
        </div>
      </section>
      <section>
        <CardHead title="Today">Click a card to open that section.</CardHead>
        <div className="fbb-stats">
          {stats.map(([label, value, attention, target]) => (
            <button type="button" key={label} className={`fbb-stat${attention && value > 0 ? ' is-attention' : ''}`} onClick={() => go(target)}>
              <span className="fbb-stat-label">{label}</span>
              <span className="fbb-stat-value">{value ?? 0}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <CardHead title="How FBB works">From the seller’s product to the customer’s door.</CardHead>
        <ol className="fbb-flow">
          {FLOW.map(([who, what, target], i) => (
            <li key={i}>
              <span className="fbb-flow-num">{i + 1}</span>
              <div><strong>{who}</strong><p>{what}</p></div>
              <Btn ghost onClick={() => go(target)}>Open</Btn>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <CardHead title="Who does what">Each admin sees only the sections their permissions allow.</CardHead>
        <div className="fbb-roles">
          {ROLES.map(([role, where, does]) => (
            <div key={role} className="fbb-role">
              <strong>{role}</strong>
              <span className="fbb-role-where">{where}</span>
              <p>{does}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ products ------------------------------------- */
function Products({ onReceive }) {
  const { data, error } = useLoad('/fbb/products');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data || []).filter((p) => {
      const inStock = (p.warehouse?.sellable || 0) + (p.warehouse?.reserved || 0) > 0;
      if (filter === 'waiting' && inStock) return false;
      if (filter === 'stocked' && !inStock) return false;
      return !term || p.name?.toLowerCase().includes(term) || (p.sellerId?.businessName || p.sellerName || '').toLowerCase().includes(term);
    });
  }, [data, q, filter]);
  const waiting = (data || []).filter((p) => !((p.warehouse?.sellable || 0) + (p.warehouse?.reserved || 0))).length;
  return (
    <section>
      <CardHead title="FBB products">
        Every product a seller has listed for Fulfilled by Bulkimart. A new product shows “Waiting for stock” until you count its delivery under Receiving.
      </CardHead>
      <Refused error={error} />
      {!data && !error ? <Loading /> : (
        <>
          <div className="fbb-toolbar">
            <input className="fbb-search" placeholder="Search product or seller" value={q} onChange={(e) => setQ(e.target.value)} />
            <Segmented value={filter} onChange={setFilter} options={[['all', `All (${data?.length || 0})`], ['waiting', `Waiting for stock (${waiting})`], ['stocked', 'In warehouse']]} />
          </div>
          <Table rows={rows} empty={data?.length ? 'No product matches.' : 'No seller has listed an FBB product yet.'} columns={[
            ['Product', (p) => (
              <div className="fbb-product">
                {p.images?.[0] ? <img src={p.images[0]} alt="" /> : <span className="fbb-product-ph" aria-hidden="true">📦</span>}
                <div><strong>{p.name}</strong><span>{(p.variants || []).map((v) => v.name).filter(Boolean).join(', ') || 'Single variant'}</span></div>
              </div>
            )],
            ['Seller', (p) => p.sellerId?.businessName || p.sellerName || '—'],
            ['Listing', (p) => (p.isDraft ? <Badge value="draft" label="Draft" /> : <Badge value={p.status} label={p.status === 'approved' ? (p.isActive ? 'Live' : 'Approved · hidden') : undefined} />)],
            ['Added to FBB', (p) => <>{when(p.fbb?.convertedAt || p.createdAt)}<div className="fbb-sub">{p.fbb?.fromMethod && p.fbb.fromMethod !== 'new_listing' ? `Moved from ${String(p.fbb.fromMethod).replace(/_/g, ' ')}` : 'New listing'}</div></>],
            ['In warehouse', (p) => (p.warehouse && (p.warehouse.sellable + p.warehouse.reserved + p.warehouse.quarantine + p.warehouse.damaged) > 0
              ? <div className="fbb-sub-stack"><span><strong>{p.warehouse.sellable}</strong> for sale</span>{p.warehouse.reserved > 0 && <span>{p.warehouse.reserved} reserved</span>}{p.warehouse.quarantine > 0 && <span>{p.warehouse.quarantine} to inspect</span>}{p.warehouse.damaged > 0 && <span>{p.warehouse.damaged} damaged</span>}</div>
              : p.onTheWay > 0 ? <Badge value="info" label={`On the way · ${p.onTheWay}`} /> : <Badge value="waiting" label="Waiting for stock" />)],
            ['', (p) => <Btn primary onClick={() => onReceive(p)}>Count delivery</Btn>],
          ]} />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ warehouses ----------------------------------- */
const EMPTY_WAREHOUSE = { code: '', name: '', phone: '', shiprocketPickupLocation: '', isActive: true, address: { line1: '', line2: '', city: '', state: '', pincode: '', lat: '', lng: '' } };
function Warehouses() {
  const { data, error, reload } = useLoad('/fbb/warehouses');
  const { busy, act } = useAct();
  const [form, setForm] = useState(null);
  const set = (path, value) => setForm((f) => (path.startsWith('address.') ? { ...f, address: { ...f.address, [path.slice(8)]: value } } : { ...f, [path]: value }));
  const save = () => act(() => {
    const payload = { ...form, address: { ...form.address, lat: Number(form.address.lat), lng: Number(form.address.lng) } };
    return form._id ? adminPut(`/fbb/warehouses/${form._id}`, payload) : adminPost('/fbb/warehouses', payload);
  }, async () => { setForm(null); await reload(); });
  const field = (label, path, { type = 'text', span, hint, placeholder } = {}) => {
    const value = path.startsWith('address.') ? form.address[path.slice(8)] : form[path];
    return <Field label={label} span={span} hint={hint}><input type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => set(path, e.target.value)} disabled={busy} /></Field>;
  };
  return (
    <section>
      <CardHead title="Warehouses" action={!form && <Btn primary onClick={() => setForm(EMPTY_WAREHOUSE)}>+ Add warehouse</Btn>}>
        Where FBB stock is kept and orders ship from. FBB stays closed until at least one warehouse is active.
      </CardHead>
      <Refused error={error} />
      <Table rows={data || []} columns={[
        ['Code', (w) => <strong>{w.code}</strong>], ['Name', (w) => w.name], ['Address', (w) => [w.address?.line1, w.address?.city, w.address?.pincode].filter(Boolean).join(', ')],
        ['Shiprocket pickup', (w) => w.shiprocketPickupLocation || '—'], ['Status', (w) => <Badge value={w.isActive ? 'active' : 'cancelled'} label={w.isActive ? 'Active' : 'Inactive'} />],
        ['', (w) => <Btn onClick={() => setForm({ ...EMPTY_WAREHOUSE, ...w, address: { ...EMPTY_WAREHOUSE.address, ...w.address } })}>Edit</Btn>],
      ]} empty="No warehouse yet. FBB stays closed until one is active." />
      {form && (
        <div className="fbb-form-panel">
          <h4>{form._id ? `Edit ${form.name || 'warehouse'}` : 'New warehouse'}</h4>
          <div className="fbb-form">
            {field('Code', 'code', { placeholder: 'IDR-01' })}{field('Name', 'name', { span: 2 })}
            {field('Phone', 'phone', { type: 'tel' })}{field('Shiprocket pickup location', 'shiprocketPickupLocation', { span: 2, hint: 'Exact pickup name in your Shiprocket account' })}
            {field('Address line 1', 'address.line1', { span: 2 })}{field('Address line 2', 'address.line2')}
            {field('City', 'address.city')}{field('State', 'address.state')}{field('Pincode', 'address.pincode')}
            {field('Latitude', 'address.lat', { type: 'number' })}{field('Longitude', 'address.lng', { type: 'number' })}
            <label className="fbb-check"><input type="checkbox" checked={form.isActive !== false} onChange={(e) => set('isActive', e.target.checked)} /> Active</label>
          </div>
          <div className="fbb-actions"><Btn primary disabled={busy} onClick={save}>Save warehouse</Btn><Btn onClick={() => setForm(null)}>Cancel</Btn></div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ pilot sellers -------------------------------- */
function PilotSellers() {
  const { data, error, reload } = useLoad('/fbb/pilot-sellers');
  const { busy, act } = useAct();
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [note, setNote] = useState('');
  const search = () => act(async () => { const res = await adminGet(`/fbb/pilot-sellers${qs({ q })}`); setFound(res.data.rows); return { message: `${res.data.rows.length} found` }; });
  const change = (seller, enabled) => act(() => adminPut(`/fbb/pilot-sellers/${seller._id}`, { enabled, note }), async () => { setFound(null); await reload(); });
  const toggle = (s) => <Btn primary={!s.fbbPilot?.enabled} disabled={busy || note.trim().length < 5} title={note.trim().length < 5 ? 'Write the reason first' : undefined}
    onClick={() => change(s, !s.fbbPilot?.enabled)}>{s.fbbPilot?.enabled ? 'Remove from pilot' : 'Add to pilot'}</Btn>;
  const columns = [['Seller', (s) => <strong>{s.storeName || s.businessName}</strong>], ['Account', (s) => <Badge value={s.status} />], ['In pilot', (s) => <Badge value={s.fbbPilot?.enabled ? 'yes' : 'no'} label={s.fbbPilot?.enabled ? 'In pilot' : 'Not in pilot'} />],
    ['Last change', (s) => (s.fbbPilot?.changedAt ? <>{when(s.fbbPilot.changedAt)}<div className="fbb-sub">{s.fbbPilot.note || ''}</div></> : '—')], ['', toggle]];
  return (
    <section>
      <CardHead title="Pilot sellers">
        {data?.allSellers ? 'FBB is open to every seller, so this list is not needed right now.'
          : 'Only the sellers listed here can choose FBB, send stock and sell FBB items. Removing a seller stops new FBB activity; their placed orders, charges and returns carry on.'}
      </CardHead>
      <Refused error={error} />
      <div className="fbb-form cols-2">
        <Field label="Reason for the change" hint="Required (at least 5 characters). Kept on the seller’s record.">
          <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={300} placeholder="e.g. Agreed FBB pilot on call, 28 Nov" />
        </Field>
        <Field label="Add a seller">
          <div className="fbb-input-group">
            <input placeholder="Search seller by name" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} onKeyDown={(e) => e.key === 'Enter' && q.trim().length >= 2 && search()} />
            <Btn disabled={busy || q.trim().length < 2} onClick={search}>Search</Btn>
          </div>
        </Field>
      </div>
      {found && <><h4 className="fbb-subhead">Search results</h4><Table rows={found} columns={columns} empty="No seller matches." /></>}
      <h4 className="fbb-subhead">In the pilot</h4>
      <Table rows={data?.rows || []} columns={columns} empty="No seller is in the FBB pilot." />
    </section>
  );
}

/* ------------------------------------------------------------------ receiving ------------------------------------ */
const blankLine = (productId = '') => ({ productId, variantId: '', expectedQty: '', receivedQty: '', acceptedQty: '', damagedQty: '', rejectedQty: '', note: '' });
const QTY = [['expectedQty', 'Expected', 'As per invoice'], ['receivedQty', 'Received', 'Physically arrived'], ['acceptedQty', 'Accepted', 'Goes on sale'], ['damagedQty', 'Damaged', ''], ['rejectedQty', 'Rejected', '']];
const n = (v) => (v === '' || v == null ? null : Number(v));

/** Live check of one line: received = accepted + damaged + rejected; missing = expected − received. */
function LineCheck({ line }) {
  const [exp, rec, acc, dam, rej] = QTY.map(([k]) => n(line[k]));
  if (rec == null) return null;
  const split = (acc || 0) + (dam || 0) + (rej || 0);
  const missing = exp != null ? exp - rec : null;
  const ok = split === rec;
  return (
    <div className={`fbb-line-check${ok ? ' is-ok' : ' is-off'}`}>
      {ok ? '✓ Received matches accepted + damaged + rejected' : `Received is ${rec}, but accepted + damaged + rejected is ${split}`}
      {missing != null && missing > 0 && <span> · {missing} missing</span>}
      {missing != null && missing < 0 && <span> · {-missing} more than expected</span>}
    </div>
  );
}

function Receiving({ preset, clearPreset }) {
  const warehouses = useLoad('/fbb/warehouses');
  const products = useLoad('/fbb/products');
  const receipts = useLoad('/fbb/receipts?limit=50');
  const shipments = useLoad('/fbb/shipments?status=in_transit');
  const { busy, act } = useAct();
  const [draft, setDraft] = useState(null);
  const activeWarehouses = (warehouses.data || []).filter((w) => w.isActive);
  const newDraft = useCallback((sellerId = '', productId = '') => setDraft({
    key: key(), warehouseId: (warehouses.data || []).find((w) => w.isActive)?._id || '', sellerId, reference: '', notes: '', lines: [blankLine(productId)],
  }), [warehouses.data]);
  // Count a delivery the seller announced: seller, warehouse and expected quantities come from their notice.
  const fromShipment = (s) => {
    setDraft({
      key: key(), shipmentId: s._id, shipmentNo: s.shipmentNo, warehouseId: String(s.warehouseId?._id || s.warehouseId), sellerId: String(s.sellerId?._id || s.sellerId),
      reference: [s.invoiceNo, s.trackingNo && `${s.courier ? `${s.courier} ` : ''}${s.trackingNo}`].filter(Boolean).join(' · ').slice(0, 100) || s.shipmentNo, notes: '',
      lines: s.lines.map((l) => ({ ...blankLine(String(l.productId)), variantId: String(l.variantId), expectedQty: String(l.qty) })),
    });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };
  // Opened from Products → "Count delivery": start a receipt for that seller and product.
  useEffect(() => {
    if (preset && warehouses.data) { newDraft(preset.sellerId, preset.productId); clearPreset(); }
  }, [preset, warehouses.data, newDraft, clearPreset]);
  const sellers = useMemo(() => {
    const map = new Map();
    for (const p of products.data || []) map.set(String(p.sellerId?._id || p.sellerId), p.sellerId?.businessName || p.sellerName || String(p.sellerId?._id || p.sellerId));
    return [...map];
  }, [products.data]);
  const sellerProducts = (products.data || []).filter((p) => String(p.sellerId?._id || p.sellerId) === draft?.sellerId);
  const setLine = (i, k, v) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'productId' ? { variantId: '' } : {}) } : l)) }));
  const num = (v) => (v === '' ? undefined : Number(v));
  const save = () => act(() => adminPost('/fbb/receipts', {
    idempotencyKey: draft.key, warehouseId: draft.warehouseId, sellerId: draft.sellerId, reference: draft.reference, notes: draft.notes,
    ...(draft.shipmentId ? { shipmentId: draft.shipmentId } : {}),
    lines: draft.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, expectedQty: num(l.expectedQty), receivedQty: num(l.receivedQty), acceptedQty: num(l.acceptedQty), damagedQty: num(l.damagedQty), rejectedQty: num(l.rejectedQty), note: l.note })),
  }), async () => { setDraft(null); await Promise.all([receipts.reload(), shipments.reload()]); });
  const post = (r) => window.confirm(`Post ${r.receiptNo}? Accepted units go on sale${r.storageCharged ? '' : ' and storage is charged'}. A posted receipt cannot be edited.`)
    && act(() => adminPost(`/fbb/receipts/${r._id}/post`), receipts.reload);
  const cancel = (r) => window.confirm(`Cancel draft ${r.receiptNo}?`) && act(() => adminPost(`/fbb/receipts/${r._id}/cancel`), async () => { await Promise.all([receipts.reload(), shipments.reload()]); });
  const units = (s) => s.lines.reduce((n, l) => n + l.qty, 0);
  const linesReady = draft?.lines.every((l) => l.productId && l.variantId && l.receivedQty !== '');

  return (
    <>
      <section>
        <CardHead title="Stock on the way">Sellers tell us here when they send stock. When the boxes arrive, click “Count this delivery”: the seller, warehouse and expected quantities are filled in.</CardHead>
        <Refused error={shipments.error} />
        <Table rows={shipments.data || []} empty="No seller has announced a shipment." columns={[
          ['Shipment', (s) => <><strong>{s.shipmentNo}</strong><div className="fbb-sub">sent {when(s.createdAt)}</div></>],
          ['Seller', (s) => sellerName(s.sellerId)], ['To', (s) => s.warehouseId?.name || '—'],
          ['Items', (s) => <>{s.lines.map((l, i) => <div key={i}>{l.qty} × {l.productName}{l.variantName && l.variantName !== 'Default' ? ` (${l.variantName})` : ''}</div>)}<div className="fbb-sub">{units(s)} units</div></>],
          ['Courier', (s) => <>{s.courier || '—'}{s.trackingNo && <div className="fbb-sub">{s.trackingNo}</div>}</>],
          ['Invoice / note', (s) => <>{s.invoiceNo || '—'}{s.expectedBy && <div className="fbb-sub">expected {new Date(s.expectedBy).toLocaleDateString('en-IN')}</div>}{s.note && <div className="fbb-sub">{s.note}</div>}</>],
          ['', (s) => <Btn primary disabled={Boolean(draft)} title={draft ? 'Finish or discard the receipt below first' : undefined} onClick={() => fromShipment(s)}>Count this delivery</Btn>],
        ]} />
      </section>
      <section>
        <CardHead title="Count a delivery" action={!draft && <Btn primary onClick={() => newDraft()}>+ New receipt</Btn>}>
          When a seller’s stock arrives, record what came in. Save it as a draft, check it, then post it. Only accepted units go on sale and are charged storage.
        </CardHead>
        <Refused error={warehouses.error || products.error} />
        {draft && (
          <div className="fbb-form-panel">
            {draft.shipmentNo && <p className="fbb-ok" style={{ marginBottom: 14 }}>Counting seller shipment <strong>{draft.shipmentNo}</strong>. Expected quantities are what the seller said they sent; enter what actually arrived.</p>}
            <h4>1. Delivery details</h4>
            <div className="fbb-form">
              <Field label="Warehouse">
                <select value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}>
                  <option value="">Choose…</option>{activeWarehouses.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
                </select>
              </Field>
              <Field label="Seller" hint={!sellers.length ? 'No seller has an FBB product yet' : undefined}>
                <select value={draft.sellerId} onChange={(e) => setDraft({ ...draft, sellerId: e.target.value, lines: [blankLine()] })}>
                  <option value="">Choose…</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </Field>
              <Field label="Reference" hint="Invoice or challan number">
                <input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="INV-1042" />
              </Field>
            </div>

            <h4>2. Items received</h4>
            {!draft.sellerId && <p className="fbb-muted">Choose the seller first to see their FBB products.</p>}
            <div className="fbb-lines">
              {draft.lines.map((l, i) => {
                const product = sellerProducts.find((p) => String(p._id) === l.productId);
                return (
                  <div key={i} className="fbb-line">
                    <div className="fbb-line-head">
                      <span className="fbb-line-num">Item {i + 1}</span>
                      {draft.lines.length > 1 && <Btn ghost onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}>Remove</Btn>}
                    </div>
                    <div className="fbb-form cols-2">
                      <Field label="Product">
                        <select value={l.productId} disabled={!draft.sellerId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                          <option value="">Choose…</option>{sellerProducts.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Variant">
                        <select value={l.variantId} disabled={!product} onChange={(e) => setLine(i, 'variantId', e.target.value)}>
                          <option value="">Choose…</option>{(product?.variants || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="fbb-qty-grid">
                      {QTY.map(([k, label, hint]) => (
                        <Field key={k} label={label} hint={hint}><input type="number" min="0" step="1" inputMode="numeric" value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} /></Field>
                      ))}
                    </div>
                    <LineCheck line={l} />
                    <Field label="Note for this item (optional)"><input value={l.note} onChange={(e) => setLine(i, 'note', e.target.value)} placeholder="e.g. 2 boxes crushed" /></Field>
                  </div>
                );
              })}
            </div>
            <Btn ghost className="fbb-add-line" disabled={!draft.sellerId} onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>+ Add another item</Btn>

            <h4>3. Notes</h4>
            <Field label="Notes for the whole delivery (optional)"><textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
            <div className="fbb-actions">
              <Btn primary disabled={busy || !draft.warehouseId || !draft.sellerId || !linesReady} onClick={save}>Save draft</Btn>
              <Btn onClick={() => setDraft(null)}>Discard</Btn>
              {!linesReady && draft.sellerId && <span className="fbb-muted">Fill product, variant and received for every item.</span>}
            </div>
          </div>
        )}
      </section>
      <section>
        <CardHead title="Receipts">Drafts need “Verify & post” before the stock goes on sale.</CardHead>
        <Refused error={receipts.error} />
        <Table rows={receipts.data?.rows || []} columns={[
          ['Receipt', (r) => <><strong>{r.receiptNo}</strong><div className="fbb-sub">{r.reference || ''}</div></>],
          ['Seller', (r) => sellerName(r.sellerId)], ['Status', (r) => <Badge value={r.status} />],
          ['Items', (r) => r.lines.map((l) => (
            <div key={l._id} className="fbb-receipt-line">
              <span>{l.productName}{l.variantName ? ` (${l.variantName})` : ''}</span>
              <span className="fbb-sub">exp {l.expectedQty ?? '—'} · rec {l.receivedQty} · <b>acc {l.acceptedQty}</b> · dmg {l.damagedQty} · rej {l.rejectedQty}{l.missingQty ? ` · missing ${l.missingQty}` : ''}</span>
            </div>
          ))],
          ['Posted', (r) => when(r.postedAt)],
          ['', (r) => r.status === 'draft' && <div className="fbb-row-actions"><Btn primary disabled={busy} onClick={() => post(r)}>Verify & post</Btn><Btn disabled={busy} onClick={() => cancel(r)}>Cancel</Btn></div>],
        ]} empty="No receipts yet." />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ stock ---------------------------------------- */
function Stock() {
  const stock = useLoad('/fbb/stock?limit=100');
  const movements = useLoad('/fbb/movements?limit=50');
  const recon = useLoad('/fbb/reconciliation');
  const { busy, act } = useAct();
  const mismatches = (Array.isArray(recon.data) ? recon.data : recon.data?.rows || []).filter((r) => !r.matches);
  return (
    <>
      <section>
        <CardHead title="Warehouse stock">
          Parcels the courier brings back (RTO) wait under “To inspect” until inspected in Orders → Returned — to inspect.
        </CardHead>
        <Refused error={stock.error} />
        <Table rows={stock.data?.rows || []} columns={[
          ['Product', (r) => <><strong>{r.productId?.name}</strong><div className="fbb-sub">{r.variantName || ''}</div></>], ['Seller', (r) => sellerName(r.sellerId)], ['Warehouse', (r) => r.warehouseId?.name || '—'],
          ['For sale', (r) => <strong>{r.sellable}</strong>], ['Reserved', (r) => r.reserved], ['To inspect', (r) => r.quarantine || 0], ['Damaged', (r) => r.damaged],
        ]} empty="No stock yet. Post a receipt under Receiving to add stock." />
      </section>
      <section>
        <CardHead title="Listing vs warehouse check">
          The listing’s stock must equal the warehouse’s for-sale units. A mismatch can be re-derived from the warehouse (the warehouse is the source of truth).
        </CardHead>
        <Refused error={recon.error} />
        <Table rows={mismatches} columns={[
          ['Product', (r) => r.productName], ['Variant', (r) => r.variantName], ['Listing shows', (r) => r.mirrorStock], ['Warehouse for sale', (r) => r.warehouseSellable],
          ['', (r) => <Btn disabled={busy} onClick={() => act(() => adminPost(`/fbb/reconciliation/${r.productId}/resync`), recon.reload)}>Re-derive</Btn>],
        ]} empty="✓ Everything matches." />
      </section>
      <section>
        <CardHead title="Recent movements" />
        <Refused error={movements.error} />
        <Table rows={movements.data?.rows || []} columns={[
          ['When', (m) => when(m.createdAt)], ['Product', (m) => m.productId?.name || String(m.productId)], ['Reason', (m) => String(m.reason || '').replace(/_/g, ' ')], ['Bucket', (m) => m.bucket || '—'],
          ['Change', (m) => { const d = m.quantityDelta ?? m.delta ?? m.qty; return <span className={Number(d) < 0 ? 'fbb-neg' : 'fbb-pos'}>{Number(d) > 0 ? `+${d}` : d}</span>; }],
          ['Reference', (m) => [m.referenceType, m.referenceId].filter(Boolean).join(' ') || '—'],
        ]} empty="No movements yet." />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ adjustments ---------------------------------- */
function Adjustments() {
  const list = useLoad('/fbb/adjustments');
  const stock = useLoad('/fbb/stock?limit=100');
  const { busy, act } = useAct();
  const [form, setForm] = useState({ row: '', bucket: 'sellable', delta: '', reason: '' });
  const rows = stock.data?.rows || [];
  const chosen = rows.find((r) => r._id === form.row);
  const request = () => act(() => adminPost('/fbb/adjustments', {
    warehouseId: chosen.warehouseId?._id || chosen.warehouseId, productId: chosen.productId?._id || chosen.productId, variantId: chosen.variantId,
    bucket: form.bucket, delta: Number(form.delta), reason: form.reason,
  }), async () => { setForm({ row: '', bucket: 'sellable', delta: '', reason: '' }); await list.reload(); });
  const decide = (a, approve) => {
    const note = window.prompt(approve ? 'Approval note (optional)' : 'Why is it rejected?') ?? null;
    if (note === null) return;
    act(() => adminPost(`/fbb/adjustments/${a._id}/decision`, { approve, note }), list.reload);
  };
  return (
    <>
      <section>
        <CardHead title="Request an adjustment">
          For counted differences only. Every adjustment needs a reason and approval by a different admin; nothing changes until it is approved.
        </CardHead>
        <Refused error={stock.error} />
        <div className="fbb-form">
          <Field label="Stock line" span={3}>
            <select value={form.row} onChange={(e) => setForm({ ...form, row: e.target.value })}>
              <option value="">Choose…</option>{rows.map((r) => <option key={r._id} value={r._id}>{r.productId?.name} {r.variantName ? `(${r.variantName})` : ''} — {r.warehouseId?.name}: {r.sellable} for sale, {r.damaged} damaged</option>)}
            </select>
          </Field>
          <Field label="Bucket"><select value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })}><option value="sellable">For sale</option><option value="damaged">Damaged</option></select></Field>
          <Field label="Change" hint="Use − to remove, e.g. -2"><input type="number" step="1" value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} /></Field>
          <Field label="Reason" hint="At least 5 characters"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Cycle count 28 Nov" /></Field>
        </div>
        <div className="fbb-actions"><Btn primary disabled={busy || !chosen || !Number(form.delta) || form.reason.trim().length < 5} onClick={request}>Request adjustment</Btn></div>
      </section>
      <section>
        <CardHead title="Adjustments" />
        <Refused error={list.error} />
        <Table rows={list.data || []} columns={[
          ['When', (a) => when(a.createdAt)], ['Product', (a) => a.productId?.name], ['Seller', (a) => sellerName(a.sellerId)], ['Bucket', (a) => a.bucket],
          ['Change', (a) => <span className={a.delta < 0 ? 'fbb-neg' : 'fbb-pos'}>{a.delta > 0 ? `+${a.delta}` : a.delta}</span>],
          ['Reason', (a) => a.reason], ['Status', (a) => <Badge value={a.status} />],
          ['', (a) => a.status === 'pending' && <div className="fbb-row-actions"><Btn primary disabled={busy} onClick={() => decide(a, true)}>Approve</Btn><Btn disabled={busy} onClick={() => decide(a, false)}>Reject</Btn></div>],
        ]} empty="No adjustments." />
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ orders --------------------------------------- */
const FBB_STAGE = { awaiting_acceptance: 'Waiting for acceptance', accepted: 'Accepted', picking: 'Picking', packed: 'Packed', handed_over: 'Handed over' };
function DeliveryChoice({ order, onDone }) {
  const { data, error, reload } = useLoad(`/fbb/orders/${order._id}/fulfillment-options`);
  const { busy, act } = useAct();
  const [rider, setRider] = useState('');
  const [pkg, setPkg] = useState({ length: '', breadth: '', height: '' });
  useEffect(() => { const s = data?.shiprocket?.suggestedPackage; if (s) setPkg({ length: String(s.length), breadth: String(s.breadth), height: String(s.height) }); }, [data]);
  if (error) return <Refused error={error} />;
  if (!data) return <p className="fbb-muted">Checking delivery options…</p>;
  const riders = (data.manual?.riders || []).filter((r) => r.online);
  return (
    <div className="fbb-panel">
      <div className="fbb-panel-row">Pickup from: <strong>{[data.pickup?.name, data.pickup?.address, data.pickup?.city, data.pickup?.pincode].filter(Boolean).join(', ')}</strong></div>
      <div className="fbb-choice-grid">
        <div className="fbb-choice">
          <strong>🛵 Bulkimart rider</strong>
          {!data.manual?.available && <p className="fbb-muted">{data.manual?.reason}</p>}
          {riders.length > 0 && <select value={rider} onChange={(e) => setRider(e.target.value)}><option value="">Any eligible rider (broadcast)</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
          <Btn primary disabled={busy || !data.manual?.available}
            onClick={() => window.confirm('Send this order to a Bulkimart rider from the warehouse?') && act(() => adminPost(`/fbb/orders/${order._id}/fulfillment/manual`, rider ? { riderId: rider } : {}), onDone)}>Use rider</Btn>
        </div>
        <div className="fbb-choice">
          <strong>🚚 Shiprocket</strong>
          <p className="fbb-muted">{data.shiprocket?.quote ? `Estimated freight ${money(data.shiprocket.quote.courierCharge)}` : data.shiprocket?.reason || ''}</p>
          <div className="fbb-qty-grid cols-3">
            {['length', 'breadth', 'height'].map((k) => <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (cm)`}><input type="number" min="1" value={pkg[k]} onChange={(e) => setPkg({ ...pkg, [k]: e.target.value })} /></Field>)}
          </div>
          <div className="fbb-row-actions">
            <Btn primary disabled={busy || !data.shiprocket?.available || !data.shiprocket?.quote || !pkg.length || !pkg.breadth || !pkg.height}
              onClick={() => window.confirm(`Book Shiprocket from the warehouse (estimated freight ${money(data.shiprocket.quote.courierCharge)})?`)
                && act(() => adminPost(`/fbb/orders/${order._id}/fulfillment/shiprocket`, { confirm: true, package: { length: Number(pkg.length), breadth: Number(pkg.breadth), height: Number(pkg.height) }, quotedCourierCharge: data.shiprocket.quote.courierCharge }), onDone)}>Book Shiprocket</Btn>
            <Btn onClick={reload}>Refresh</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** An RTO parcel back at the warehouse: split each line into back-on-sale and damaged units (once). */
function Inspect({ order, onDone }) {
  const lines = order.fbb?.returnInspection?.lines || [];
  const [sellable, setSellable] = useState(() => lines.map(() => ''));
  const [note, setNote] = useState('');
  const { busy, act } = useAct();
  const name = (l) => {
    const item = order.items.find((i) => String(i.productId) === String(l.productId) && String(i.variantId) === String(l.variantId));
    return item ? `${item.name}${item.variantName ? ` (${item.variantName})` : ''}` : 'Item';
  };
  const parsed = lines.map((l, i) => (sellable[i] === '' ? null : Number(sellable[i])));
  const valid = parsed.every((v, i) => Number.isInteger(v) && v >= 0 && v <= lines[i].qty);
  const submit = () => window.confirm('Record this inspection? Units marked sellable go back on sale; the rest go to the damaged bucket. This cannot be repeated.')
    && act(() => adminPost(`/fbb/orders/${order._id}/inspect`, { note, lines: lines.map((l, i) => ({ productId: l.productId, variantId: l.variantId, sellableQty: parsed[i], damagedQty: l.qty - parsed[i] })) }), onDone);
  return (
    <div className="fbb-panel">
      <h4>Inspect returned parcel</h4>
      <div className="fbb-form">
        {lines.map((l, i) => (
          <Field key={i} label={`${name(l)} — ${l.qty} back`} hint={Number.isInteger(parsed[i]) && parsed[i] <= l.qty ? `${l.qty - parsed[i]} go to damaged` : 'How many can be sold again?'}>
            <input type="number" min="0" max={l.qty} value={sellable[i]} placeholder="Resellable" onChange={(e) => setSellable(sellable.map((v, j) => (j === i ? e.target.value : v)))} />
          </Field>
        ))}
        <Field label="Note (optional)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="fbb-actions"><Btn primary disabled={busy || !valid} onClick={submit}>Record inspection</Btn></div>
    </div>
  );
}

function Orders() {
  const [stage, setStage] = useState('open');
  const { data, error, reload } = useLoad(`/fbb/orders${qs({ stage, limit: 50 })}`, [stage]);
  const { busy, act } = useAct();
  const [choosing, setChoosing] = useState(null);
  const step = (o, path, prompt) => (!prompt || window.confirm(prompt)) && act(() => adminPost(`/fbb/orders/${o._id}/${path}`), reload);
  const cancel = (o) => { const reason = window.prompt('Why is this order cancelled? (customer is refunded per the usual rules)'); if (reason) act(() => adminPost(`/fbb/orders/${o._id}/cancel`, { reason }), reload); };
  const actions = (o) => {
    const s = o.fbb?.status;
    return (
      <div className="fbb-row-actions">
        {s === 'awaiting_acceptance' && <Btn primary disabled={busy} onClick={() => step(o, 'accept')}>Accept</Btn>}
        {s === 'accepted' && <Btn primary disabled={busy} onClick={() => step(o, 'pick')}>Start picking</Btn>}
        {s === 'picking' && <Btn primary disabled={busy} onClick={() => step(o, 'pack', 'Mark packed? The packaging charge is booked now.')}>Mark packed</Btn>}
        {s === 'packed' && o.status === 'preparing' && !o.deliveryPartnerId && !o.shiprocket?.awb && <Btn primary onClick={() => setChoosing(choosing === o._id ? null : o._id)}>{choosing === o._id ? 'Close' : 'Choose delivery'}</Btn>}
        {s === 'packed' && o.shiprocket?.awb && <Btn primary disabled={busy} onClick={() => step(o, 'handoff', 'Confirm the courier collected the parcel? Stock leaves the warehouse and the fulfilment charge is booked.')}>Confirm courier pickup</Btn>}
        {o.fbb?.returnInspection?.status === 'pending' && <Btn primary onClick={() => setChoosing(choosing === o._id ? null : o._id)}>{choosing === o._id ? 'Close' : 'Inspect returned parcel'}</Btn>}
        {s !== 'handed_over' && ['placed', 'confirmed', 'preparing'].includes(o.status) && <Btn disabled={busy} onClick={() => cancel(o)}>Cancel</Btn>}
      </div>
    );
  };
  const done = async () => { setChoosing(null); await reload(); };
  return (
    <section>
      <CardHead title="FBB orders">Accept → Start picking → Mark packed → Choose delivery (rider or Shiprocket).</CardHead>
      <Segmented value={stage} onChange={setStage} options={[['open', 'To fulfil'], ['in_transit', 'In transit'], ['inspection', 'Returned — to inspect'], ['done', 'Finished']]} />
      <Refused error={error} />
      <Table rows={data?.rows || []}
        expand={(o) => choosing === o._id && (o.fbb?.returnInspection?.status === 'pending' ? <Inspect order={o} onDone={done} /> : <DeliveryChoice order={o} onDone={done} />)}
        columns={[
          ['Order', (o) => <><strong>{o.orderNo}</strong><div className="fbb-sub">{when(o.createdAt)}</div></>],
          ['Seller', (o) => sellerName(o.items?.[0]?.sellerId)],
          ['Items', (o) => o.items.map((i, k) => <div key={k}>{i.qty} × {i.name}{i.variantName ? ` (${i.variantName})` : ''}</div>)],
          ['Deliver to', (o) => `${o.shippingAddress?.city || ''} ${o.shippingAddress?.pincode || ''}`], ['Payment', (o) => <span className="fbb-upper">{o.paymentMethod}</span>],
          ['Status', (o) => <div className="fbb-sub-stack"><Badge value={o.status} /><Badge value={o.fbb?.status} label={FBB_STAGE[o.fbb?.status] || o.fbb?.status || '—'} /></div>],
          ['Delivery', (o) => (o.shiprocket?.awb ? `Shiprocket ${o.shiprocket.awb}` : o.deliveryPartnerId ? 'Bulkimart rider' : o.needsManualAssignment ? 'Waiting for a rider' : '—')],
          ['', actions],
        ]} empty="No orders in this stage." />
    </section>
  );
}

/* ------------------------------------------------------------------ returns -------------------------------------- */
function ReturnPickup({ ret, onDone }) {
  const { data, error } = useLoad(`/fbb/returns/${ret._id}/pickup-options`);
  const { busy, act } = useAct();
  const [rider, setRider] = useState('');
  if (error) return <Refused error={error} />;
  if (!data) return <p className="fbb-muted">Checking pickup options…</p>;
  return (
    <div className="fbb-panel">
      <div className="fbb-panel-row">Back to: <strong>{[data.drop?.name, data.drop?.city, data.drop?.pincode].filter(Boolean).join(', ')}</strong></div>
      <div className="fbb-row-actions">
        {data.manual?.riders?.length > 0 && <select value={rider} onChange={(e) => setRider(e.target.value)}><option value="">Choose rider…</option>{data.manual.riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        <Btn primary disabled={busy || !rider} onClick={() => act(() => adminPost(`/fbb/returns/${ret._id}/pickup`, { pickupMethod: 'MANUAL', riderId: rider }), onDone)}>Send rider</Btn>
        <Btn disabled={busy || !data.shiprocket?.available} onClick={() => window.confirm('Book a Shiprocket reverse pickup to the warehouse?') && act(() => adminPost(`/fbb/returns/${ret._id}/pickup`, { pickupMethod: 'SHIPROCKET' }), onDone)}>Book Shiprocket</Btn>
        {data.manual?.reason && <em className="fbb-muted">{data.manual.reason}</em>}
      </div>
    </div>
  );
}
function Returns() {
  const { data, error, reload } = useLoad('/fbb/returns');
  const { busy, act } = useAct();
  const [picking, setPicking] = useState(null);
  const decide = (r, approve) => {
    const reason = approve ? '' : window.prompt('Why is the return rejected?');
    if (!approve && !reason) return;
    act(() => adminPost(`/fbb/returns/${r._id}/decision`, approve ? { decision: 'APPROVED' } : { decision: 'REJECTED', rejectionReason: reason }), reload);
  };
  return (
    <section>
      <CardHead title="FBB returns">
        Bulkimart decides FBB returns and brings them back to the warehouse. After it arrives, inspect it and restock or refund on the Returns & Refunds screen: resellable units go back on sale, others to the damaged bucket.
      </CardHead>
      <Refused error={error} />
      <Table rows={data || []}
        expand={(r) => picking === r._id && <ReturnPickup ret={r} onDone={async () => { setPicking(null); await reload(); }} />}
        columns={[
          ['Return', (r) => <strong>{r.returnNo || String(r._id).slice(-6)}</strong>], ['Requested', (r) => when(r.requestedAt)], ['Reason', (r) => r.reason], ['Status', (r) => <Badge value={r.status} />], ['Pickup', (r) => r.pickup?.status || '—'],
          ['', (r) => <div className="fbb-row-actions">
            {['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(r.status) && <><Btn primary disabled={busy} onClick={() => decide(r, true)}>Approve</Btn><Btn disabled={busy} onClick={() => decide(r, false)}>Reject</Btn></>}
            {r.status === 'APPROVED' && <Btn primary onClick={() => setPicking(picking === r._id ? null : r._id)}>{picking === r._id ? 'Close' : 'Arrange pickup'}</Btn>}
            {r.status === 'AWAITING_RETURN' && <><Btn disabled={busy} onClick={() => act(() => adminPost(`/fbb/returns/${r._id}/pickup/refresh`), reload)}>Refresh courier</Btn>
              <Btn primary disabled={busy} onClick={() => window.confirm('Confirm the parcel reached the warehouse?') && act(() => adminPost(`/fbb/returns/${r._id}/mark-received`), reload)}>Received at warehouse</Btn></>}
          </div>],
        ]} empty="No FBB returns need attention." />
    </section>
  );
}

/* ------------------------------------------------------------------ charges (finance) ---------------------------- */
const TYPE = { storage: 'Storage', packaging: 'Packaging', fulfillment: 'Fulfilment' };
const BASIS = { per_unit: 'per unit', per_order: 'per order' };
function Charges() {
  const configs = useLoad('/fbb/finance/charge-config');
  const billing = useLoad('/fbb/finance/billing');
  const charges = useLoad('/fbb/finance/charges?limit=50');
  const recon = useLoad('/fbb/finance/charges/reconciliation');
  const { busy, act } = useAct();
  const [form, setForm] = useState(null);
  const saveRates = () => window.confirm('Save new FBB rates? Existing rates and orders already placed are not changed.') && act(() => adminPost('/fbb/finance/charge-config', {
    effectiveFrom: form.effectiveFrom || undefined, reason: form.reason,
    storage: { amount: Number(form.storage), basis: 'per_unit' }, packaging: { amount: Number(form.packaging), basis: form.packagingBasis }, fulfillment: { amount: Number(form.fulfillment), basis: form.fulfillmentBasis },
  }), async () => { setForm(null); await configs.reload(); });
  const reverse = (c) => { const reason = window.prompt(`Reverse this ${TYPE[c.type] || c.type} charge of ${money(c.amount)}? Give the reason.`); if (reason) act(() => adminPost(`/fbb/finance/charges/${encodeURIComponent(c._id)}/reverse`, { reason }), async () => { await charges.reload(); await billing.reload(); }); };
  const settle = (s) => window.confirm(`Deduct ${s.sellerName || 'this seller'}'s outstanding FBB charges from eligible earnings now? Only what is eligible is deducted.`)
    && act(() => adminPost(`/fbb/finance/billing/${s.sellerId}/settle`), billing.reload);
  const amount = (k) => <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />;
  const basis = (k) => <select value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}><option value="per_order">per order</option><option value="per_unit">per unit</option></select>;
  const latest = (configs.data || [])[0];
  return (
    <>
      <section>
        <CardHead title="Rates" action={!form && <Btn primary onClick={() => setForm({
          storage: latest ? String(latest.storage.amount) : '', packaging: latest ? String(latest.packaging.amount) : '', packagingBasis: latest?.packaging.basis || 'per_order',
          fulfillment: latest ? String(latest.fulfillment.amount) : '', fulfillmentBasis: latest?.fulfillment.basis || 'per_unit', effectiveFrom: '', reason: '' })}>+ New rate version</Btn>}>
          Each change is a new version; earlier versions never change. Orders keep the rates in force when they were placed. Tax treatment is pending accountant review.
        </CardHead>
        <Refused error={configs.error} />
        <Table rows={configs.data || []} columns={[
          ['Version', (c) => <strong>v{c.version}</strong>], ['From', (c) => when(c.effectiveFrom)], ['Storage', (c) => `${money(c.storage.amount)} ${BASIS[c.storage.basis]}`],
          ['Packaging', (c) => `${money(c.packaging.amount)} ${BASIS[c.packaging.basis]}`], ['Fulfilment', (c) => `${money(c.fulfillment.amount)} ${BASIS[c.fulfillment.basis]}`],
        ]} empty="No rates yet." />
        {form && (
          <div className="fbb-form-panel">
            <h4>New rate version</h4>
            <div className="fbb-form">
              <Field label="Storage" hint="₹ per unit, charged when stock is received">{amount('storage')}</Field>
              <Field label="Packaging" hint="₹, charged when the order is packed"><div className="fbb-input-group">{amount('packaging')}{basis('packagingBasis')}</div></Field>
              <Field label="Fulfilment" hint="₹, charged when the parcel leaves the warehouse"><div className="fbb-input-group">{amount('fulfillment')}{basis('fulfillmentBasis')}</div></Field>
              <Field label="Effective from" hint="Leave empty to start now"><input type="datetime-local" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
              <Field label="Reason for the change" span={2} hint="At least 5 characters"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Revised warehouse costs from 1 Dec" /></Field>
            </div>
            <div className="fbb-actions">
              <Btn primary disabled={busy || form.reason.trim().length < 5 || form.storage === '' || form.packaging === '' || form.fulfillment === ''} onClick={saveRates}>Save version</Btn>
              <Btn onClick={() => setForm(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </section>
      <section>
        <CardHead title="Outstanding by seller">
          Outstanding charges are deducted from eligible earnings automatically before payouts. Sellers can also pay in advance. Sellers are never suspended automatically.
        </CardHead>
        <Refused error={billing.error} />
        <Table rows={billing.data || []} columns={[
          ['Seller', (s) => <strong>{s.sellerName || String(s.sellerId)}</strong>], ['Outstanding', (s) => money(s.outstanding)],
          ['', (s) => <Btn disabled={busy} onClick={() => settle(s)}>Deduct from earnings now</Btn>],
        ]} empty="No seller owes FBB charges." />
      </section>
      <section>
        <CardHead title="Charges" />
        <Refused error={charges.error} />
        <Table rows={charges.data?.rows || []} columns={[
          ['When', (c) => when(c.createdAt)], ['Type', (c) => TYPE[c.type] || c.type], ['For', (c) => c.orderId?.orderNo || c.receiptId?.receiptNo || '—'], ['Qty', (c) => c.qty],
          ['Rate', (c) => `${money(c.rate)} ${BASIS[c.basis] || ''}`], ['Amount', (c) => <strong>{money(c.amount)}</strong>], ['Version', (c) => `v${c.configVersion}`], ['Status', (c) => <Badge value={c.status} />],
          ['', (c) => c.status === 'posted' && c.amountPaise > 0 && <Btn disabled={busy} onClick={() => reverse(c)}>Reverse</Btn>],
        ]} empty="No charges yet." />
      </section>
      <section>
        <CardHead title="Ledger check" />
        <Refused error={recon.error} />
        {recon.data && <p className={recon.data.problems.length ? 'fbb-error' : 'fbb-ok'}>{recon.data.checked} charges checked; {recon.data.problems.length ? `${recon.data.problems.length} problem(s)` : 'every charge matches its ledger entry.'}</p>}
        {recon.data?.problems?.length > 0 && <ul>{recon.data.problems.map((p, i) => <li key={i}>{typeof p === 'string' ? p : JSON.stringify(p)}</li>)}</ul>}
      </section>
    </>
  );
}

const VIEWS = { overview: Overview, products: Products, warehouses: Warehouses, pilot: PilotSellers, receiving: Receiving, stock: Stock, adjustments: Adjustments, orders: Orders, returns: Returns, charges: Charges };

export default function FbbTab() {
  const [section, setSection] = useState(() => sectionFromUrl() || 'overview');
  const [preset, setPreset] = useState(null);
  // A notification opens a section through ?section=… (same tab already open → the event re-reads it).
  useEffect(() => {
    const open = () => { const s = sectionFromUrl(); if (s) setSection(s); };
    window.addEventListener('fbb-section-open', open);
    return () => window.removeEventListener('fbb-section-open', open);
  }, []);
  // Keep the open section in the URL, so a refresh or a shared link lands on the same section.
  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/admin/fbb' && sectionFromUrl() !== section) {
      window.history.replaceState(null, '', section === 'overview' ? '/admin/fbb' : `/admin/fbb?section=${section}`);
    }
  }, [section]);
  const go = useCallback((s) => { setSection(s); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }, []);
  const clearPreset = useCallback(() => setPreset(null), []);
  const View = VIEWS[section];
  const props = section === 'overview' ? { go }
    : section === 'products' ? { onReceive: (p) => { setPreset({ sellerId: String(p.sellerId?._id || p.sellerId), productId: String(p._id) }); go('receiving'); } }
      : section === 'receiving' ? { preset, clearPreset } : {};
  return (
    <div className="fbb-ws">
      <div className="fbb-ws-head">
        <h2 className="fbb-ws-title">Fulfilled by Bulkimart</h2>
        <p className="fbb-ws-subtitle">Warehouse stock, FBB orders and returns, and FBB service charges.</p>
      </div>
      <nav aria-label="FBB sections" className="fbb-tabs">
        {SECTIONS.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} className={`fbb-tab${section === id ? ' is-active' : ''}`} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <View key={section} {...props} />
    </div>
  );
}
