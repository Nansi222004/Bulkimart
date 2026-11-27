import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPut, qs } from '../../../utils/adminApi';
import './FbbTab.css';

/**
 * Fulfilled by Bulkimart — admin workspace (/api/admin/fbb).
 * Warehouse work (warehouses, receiving, stock, adjustments, orders, returns) needs `manage_warehouse`;
 * FBB charges and billing need `manage_finance`. The server enforces both; a section a person may not use
 * shows the server's refusal instead of data.
 */
const SECTIONS = [
  ['overview', 'Overview'], ['receiving', 'Receiving'], ['stock', 'Stock'], ['adjustments', 'Adjustments'],
  ['orders', 'Orders'], ['returns', 'Returns'], ['warehouses', 'Warehouses'], ['pilot', 'Pilot sellers'], ['charges', 'Charges & billing'],
];
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const key = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rcpt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
// Card / button looks come from FbbTab.css (Super Admin theme); these keep spacing for the inline layouts below.
const box = {};
const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const cell = { borderBottom: '1px solid #eef2f7', padding: '10px 12px', textAlign: 'left', verticalAlign: 'top' };
const btn = { minHeight: 36, padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#172b4d', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginRight: 6, marginBottom: 4 };
const primary = { ...btn, background: 'var(--sa-primary, #08b9e8)', color: '#fff', borderColor: 'var(--sa-primary, #08b9e8)' };

/** Coloured pill for a status value. */
const GOOD = ['posted', 'approved', 'active', 'delivered', 'handed_over', 'completed', 'refunded', 'settled', 'yes'];
const BAD = ['cancelled', 'rejected', 'failed', 'reversed', 'no'];
const WARN = ['draft', 'pending', 'awaiting_acceptance', 'return_requested', 'under_review', 'awaiting_return', 'placed'];
function Badge({ value, label }) {
  const v = String(value ?? '').toLowerCase();
  const tone = GOOD.includes(v) ? 'is-good' : BAD.includes(v) ? 'is-bad' : WARN.includes(v) ? 'is-warn' : 'is-info';
  return <span className={`fbb-badge ${tone}`}>{label ?? String(value ?? '—').replace(/_/g, ' ')}</span>;
}

function Table({ columns, rows, empty = 'Nothing here.' }) {
  if (!rows?.length) return <p className="fbb-empty">{empty}</p>;
  return (
    <div className="fbb-table-wrap">
      <table style={table}>
        <thead><tr>{columns.map(([label]) => <th key={label} style={{ ...cell, fontWeight: 600 }}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={row._id || row.id || i}>{columns.map(([label, render]) => <td key={label} style={cell}>{render(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

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

/* ------------------------------------------------------------------ overview ------------------------------------- */
function Overview() {
  const { data, error } = useLoad('/fbb/overview');
  if (error) return <Refused error={error} />;
  if (!data) return <p>Loading…</p>;
  // Server switches are internal and not shown here; the admin sees only what is left to set up.
  const { ready, blockers = [] } = data.readiness || {};
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
        <h3>Today</h3>
        <div className="fbb-stats">
          {[['Active warehouses', data.counts.warehouses], ['Pilot sellers', data.counts.pilotSellers ?? 0], ['FBB products', data.counts.fbbProducts],
            ['Orders to fulfil', data.counts.openOrders, true], ['Receipts to post', data.counts.draftReceipts, true], ['Adjustments to approve', data.counts.pendingAdjustments, true]]
            .map(([label, value, attention]) => (
              <div key={label} className={`fbb-stat${attention && value > 0 ? ' is-attention' : ''}`}>
                <div className="fbb-stat-label">{label}</div>
                <div className="fbb-stat-value">{value ?? 0}</div>
              </div>
            ))}
        </div>
      </section>
    </>
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
  const field = (label, path, type = 'text') => {
    const value = path.startsWith('address.') ? form.address[path.slice(8)] : form[path];
    return <label style={{ display: 'grid', fontSize: 12, gap: 2 }}>{label}<input type={type} value={value ?? ''} onChange={(e) => set(path, e.target.value)} disabled={busy} /></label>;
  };
  return (
    <section style={box}>
      <h3>Warehouses</h3>
      <Refused error={error} />
      <Table rows={data || []} columns={[
        ['Code', (w) => w.code], ['Name', (w) => w.name], ['Address', (w) => [w.address?.line1, w.address?.city, w.address?.pincode].filter(Boolean).join(', ')],
        ['Shiprocket pickup', (w) => w.shiprocketPickupLocation || '—'], ['Active', (w) => <Badge value={w.isActive ? 'active' : 'cancelled'} label={w.isActive ? 'Active' : 'Inactive'} />],
        ['', (w) => <button type="button" style={btn} onClick={() => setForm({ ...EMPTY_WAREHOUSE, ...w, address: { ...EMPTY_WAREHOUSE.address, ...w.address } })}>Edit</button>],
      ]} empty="No warehouse yet. FBB stays closed until one is active." />
      {!form && <button type="button" style={primary} onClick={() => setForm(EMPTY_WAREHOUSE)}>Add warehouse</button>}
      {form && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>
          {field('Code', 'code')}{field('Name', 'name')}{field('Phone', 'phone')}{field('Shiprocket pickup location name', 'shiprocketPickupLocation')}
          {field('Address line 1', 'address.line1')}{field('Address line 2', 'address.line2')}{field('City', 'address.city')}{field('State', 'address.state')}
          {field('Pincode', 'address.pincode')}{field('Latitude', 'address.lat', 'number')}{field('Longitude', 'address.lng', 'number')}
          <label style={{ fontSize: 12 }}><input type="checkbox" checked={form.isActive !== false} onChange={(e) => set('isActive', e.target.checked)} /> Active</label>
          <div><button type="button" style={primary} disabled={busy} onClick={save}>Save</button><button type="button" style={btn} onClick={() => setForm(null)}>Cancel</button></div>
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
  const toggle = (s) => <button type="button" style={s.fbbPilot?.enabled ? btn : primary} disabled={busy || note.trim().length < 5}
    onClick={() => change(s, !s.fbbPilot?.enabled)}>{s.fbbPilot?.enabled ? 'Remove from pilot' : 'Add to pilot'}</button>;
  const columns = [['Seller', (s) => s.storeName || s.businessName], ['Status', (s) => <Badge value={s.status} />], ['In pilot', (s) => <Badge value={s.fbbPilot?.enabled ? 'yes' : 'no'} label={s.fbbPilot?.enabled ? 'In pilot' : 'Not in pilot'} />],
    ['Last change', (s) => (s.fbbPilot?.changedAt ? `${when(s.fbbPilot.changedAt)} — ${s.fbbPilot.note || ''}` : '—')], ['', toggle]];
  return (
    <section style={box}>
      <h3>Pilot sellers</h3>
      <p style={{ fontSize: 13 }}>
        {data?.allSellers ? 'FBB is open to every seller, so this list is not needed right now.'
          : 'Only the sellers listed here can choose FBB, send stock and sell FBB items. Removing a seller stops new FBB activity; their placed orders, charges and returns carry on.'}
      </p>
      <Refused error={error} />
      <label style={{ display: 'grid', fontSize: 12, gap: 2, maxWidth: 420, marginBottom: 8 }}>Reason for the change (required, kept on the record)
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={300} /></label>
      <Table rows={data?.rows || []} columns={columns} empty="No seller is in the FBB pilot." />
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input placeholder="Find a seller by name" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
        <button type="button" style={btn} disabled={busy || q.trim().length < 2} onClick={search}>Search</button>
      </div>
      {found && <Table rows={found} columns={columns} empty="No seller matches." />}
    </section>
  );
}

/* ------------------------------------------------------------------ receiving ------------------------------------ */
const blankLine = () => ({ productId: '', variantId: '', expectedQty: '', receivedQty: '', acceptedQty: '', damagedQty: '', rejectedQty: '', note: '' });
function Receiving() {
  const warehouses = useLoad('/fbb/warehouses');
  const products = useLoad('/fbb/products');
  const receipts = useLoad('/fbb/receipts?limit=50');
  const { busy, act } = useAct();
  const [draft, setDraft] = useState(null);
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
    lines: draft.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, expectedQty: num(l.expectedQty), receivedQty: num(l.receivedQty), acceptedQty: num(l.acceptedQty), damagedQty: num(l.damagedQty), rejectedQty: num(l.rejectedQty), note: l.note })),
  }), async () => { setDraft(null); await receipts.reload(); });
  const post = (r) => window.confirm(`Post ${r.receiptNo}? Accepted units go on sale${r.storageCharged ? '' : ' and storage is charged'}. A posted receipt cannot be edited.`)
    && act(() => adminPost(`/fbb/receipts/${r._id}/post`), receipts.reload);
  const cancel = (r) => window.confirm(`Cancel draft ${r.receiptNo}?`) && act(() => adminPost(`/fbb/receipts/${r._id}/cancel`), receipts.reload);

  return (
    <>
      <section style={box}>
        <h3>Count a delivery</h3>
        <p style={{ fontSize: 12 }}>Record what arrived: received = accepted + damaged + rejected; anything not received is missing. Save as a draft, check it, then post. Only accepted units go on sale and are charged storage.</p>
        <Refused error={warehouses.error || products.error} />
        {!draft ? <button type="button" style={primary} onClick={() => setDraft({ key: key(), warehouseId: warehouses.data?.find((w) => w.isActive)?._id || '', sellerId: '', reference: '', notes: '', lines: [blankLine()] })}>New receipt</button> : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12 }}>Warehouse <select value={draft.warehouseId} onChange={(e) => setDraft({ ...draft, warehouseId: e.target.value })}>
                <option value="">Choose…</option>{(warehouses.data || []).filter((w) => w.isActive).map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}</select></label>
              <label style={{ fontSize: 12 }}>Seller <select value={draft.sellerId} onChange={(e) => setDraft({ ...draft, sellerId: e.target.value, lines: [blankLine()] })}>
                <option value="">Choose…</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label style={{ fontSize: 12 }}>Reference (invoice / challan) <input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} /></label>
            </div>
            {draft.lines.map((l, i) => {
              const product = sellerProducts.find((p) => String(p._id) === l.productId);
              return (
                <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end', borderTop: '1px dashed #e2e8f0', paddingTop: 6 }}>
                  <label style={{ fontSize: 12 }}>Product <select value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                    <option value="">Choose…</option>{sellerProducts.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label>
                  <label style={{ fontSize: 12 }}>Variant <select value={l.variantId} onChange={(e) => setLine(i, 'variantId', e.target.value)}>
                    <option value="">Choose…</option>{(product?.variants || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}</select></label>
                  {[['expectedQty', 'Expected'], ['receivedQty', 'Received'], ['acceptedQty', 'Accepted'], ['damagedQty', 'Damaged'], ['rejectedQty', 'Rejected']].map(([k, label]) => (
                    <label key={k} style={{ fontSize: 12, display: 'grid' }}>{label}<input type="number" min="0" step="1" style={{ width: 80 }} value={l[k]} onChange={(e) => setLine(i, k, e.target.value)} /></label>
                  ))}
                  <label style={{ fontSize: 12, display: 'grid' }}>Note<input value={l.note} onChange={(e) => setLine(i, 'note', e.target.value)} /></label>
                  {draft.lines.length > 1 && <button type="button" style={btn} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) })}>Remove</button>}
                </div>
              );
            })}
            <div><button type="button" style={btn} onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>Add line</button></div>
            <label style={{ fontSize: 12, display: 'grid' }}>Notes<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <div><button type="button" style={primary} disabled={busy || !draft.warehouseId || !draft.sellerId} onClick={save}>Save draft</button><button type="button" style={btn} onClick={() => setDraft(null)}>Discard</button></div>
          </div>
        )}
      </section>
      <section style={box}>
        <h3>Receipts</h3>
        <Refused error={receipts.error} />
        <Table rows={receipts.data?.rows || []} columns={[
          ['Receipt', (r) => r.receiptNo], ['Seller', (r) => r.sellerId?.businessName || String(r.sellerId?._id || r.sellerId)], ['Status', (r) => <Badge value={r.status} />],
          ['Lines (expected / received / accepted / damaged / rejected / missing)', (r) => r.lines.map((l) => <div key={l._id}>{l.productName}{l.variantName ? ` (${l.variantName})` : ''}: {l.expectedQty}/{l.receivedQty}/{l.acceptedQty}/{l.damagedQty}/{l.rejectedQty}/{l.missingQty}</div>)],
          ['Posted', (r) => when(r.postedAt)],
          ['', (r) => r.status === 'draft' && <><button type="button" style={primary} disabled={busy} onClick={() => post(r)}>Verify & post</button><button type="button" style={btn} disabled={busy} onClick={() => cancel(r)}>Cancel</button></>],
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
      <section style={box}>
        <h3>Warehouse stock</h3>
        <Refused error={stock.error} />
        <Table rows={stock.data?.rows || []} columns={[
          ['Product', (r) => r.productId?.name], ['Variant', (r) => r.variantName || '—'], ['Seller', (r) => r.sellerId?.businessName || '—'], ['Warehouse', (r) => r.warehouseId?.name || '—'],
          ['For sale', (r) => r.sellable], ['Reserved', (r) => r.reserved], ['Awaiting inspection', (r) => r.quarantine || 0], ['Damaged', (r) => r.damaged],
        ]} empty="No stock yet." />
        <p style={{ fontSize: 12 }}>Parcels the courier brings back (RTO) wait under "Awaiting inspection" until inspected in Orders → Returned — to inspect.</p>
      </section>
      <section style={box}>
        <h3>Listing vs warehouse check</h3>
        <p style={{ fontSize: 12 }}>The listing's stock must equal the warehouse's for-sale units. A mismatch can be re-derived from the warehouse (the warehouse is the source of truth).</p>
        <Refused error={recon.error} />
        <Table rows={mismatches} columns={[
          ['Product', (r) => r.productName], ['Variant', (r) => r.variantName], ['Listing shows', (r) => r.mirrorStock], ['Warehouse for sale', (r) => r.warehouseSellable],
          ['', (r) => <button type="button" style={btn} disabled={busy} onClick={() => act(() => adminPost(`/fbb/reconciliation/${r.productId}/resync`), recon.reload)}>Re-derive</button>],
        ]} empty="Everything matches." />
      </section>
      <section style={box}>
        <h3>Recent movements</h3>
        <Refused error={movements.error} />
        <Table rows={movements.data?.rows || []} columns={[
          ['When', (m) => when(m.createdAt)], ['Product', (m) => m.productId?.name || String(m.productId)], ['Reason', (m) => m.reason], ['Bucket', (m) => m.bucket || '—'],
          ['Change', (m) => m.quantityDelta ?? m.delta ?? m.qty], ['Reference', (m) => [m.referenceType, m.referenceId].filter(Boolean).join(' ') || '—'],
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
      <section style={box}>
        <h3>Request an adjustment</h3>
        <p style={{ fontSize: 12 }}>For counted differences only. Every adjustment needs a reason and approval by a different admin; nothing changes until it is approved.</p>
        <Refused error={stock.error} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ fontSize: 12 }}>Stock line <select value={form.row} onChange={(e) => setForm({ ...form, row: e.target.value })}>
            <option value="">Choose…</option>{rows.map((r) => <option key={r._id} value={r._id}>{r.productId?.name} {r.variantName ? `(${r.variantName})` : ''} — {r.warehouseId?.name}: {r.sellable} for sale, {r.damaged} damaged</option>)}</select></label>
          <label style={{ fontSize: 12 }}>Bucket <select value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })}><option value="sellable">For sale</option><option value="damaged">Damaged</option></select></label>
          <label style={{ fontSize: 12 }}>Change (+/−) <input type="number" step="1" style={{ width: 80 }} value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} /></label>
          <label style={{ fontSize: 12, flex: 1 }}>Reason <input style={{ width: '100%' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <button type="button" style={primary} disabled={busy || !chosen || !Number(form.delta) || form.reason.trim().length < 5} onClick={request}>Request</button>
        </div>
      </section>
      <section style={box}>
        <h3>Adjustments</h3>
        <Refused error={list.error} />
        <Table rows={list.data || []} columns={[
          ['When', (a) => when(a.createdAt)], ['Product', (a) => a.productId?.name], ['Seller', (a) => a.sellerId?.businessName], ['Bucket', (a) => a.bucket], ['Change', (a) => a.delta],
          ['Reason', (a) => a.reason], ['Status', (a) => <Badge value={a.status} />],
          ['', (a) => a.status === 'pending' && <><button type="button" style={primary} disabled={busy} onClick={() => decide(a, true)}>Approve</button><button type="button" style={btn} disabled={busy} onClick={() => decide(a, false)}>Reject</button></>],
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
  if (!data) return <p style={{ fontSize: 12 }}>Checking delivery options…</p>;
  const riders = (data.manual?.riders || []).filter((r) => r.online);
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 12, padding: 8, background: '#f8fafc', borderRadius: 8 }}>
      <div>Pickup from: <strong>{[data.pickup?.name, data.pickup?.address, data.pickup?.city, data.pickup?.pincode].filter(Boolean).join(', ')}</strong></div>
      <div>
        <strong>Bulkimart rider</strong> {!data.manual?.available && <em>— {data.manual?.reason}</em>}
        {riders.length > 0 && <select value={rider} onChange={(e) => setRider(e.target.value)} style={{ marginLeft: 6 }}><option value="">Any eligible rider (broadcast)</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        <button type="button" style={{ ...primary, marginLeft: 6 }} disabled={busy || !data.manual?.available}
          onClick={() => window.confirm('Send this order to a Bulkimart rider from the warehouse?') && act(() => adminPost(`/fbb/orders/${order._id}/fulfillment/manual`, rider ? { riderId: rider } : {}), onDone)}>Use rider</button>
      </div>
      <div>
        <strong>Shiprocket</strong> {data.shiprocket?.quote ? `— estimated freight ${money(data.shiprocket.quote.courierCharge)}` : data.shiprocket?.reason ? `— ${data.shiprocket.reason}` : ''}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {['length', 'breadth', 'height'].map((k) => <label key={k}>{k} (cm) <input type="number" min="1" style={{ width: 60 }} value={pkg[k]} onChange={(e) => setPkg({ ...pkg, [k]: e.target.value })} /></label>)}
          <button type="button" style={primary} disabled={busy || !data.shiprocket?.available || !data.shiprocket?.quote || !pkg.length || !pkg.breadth || !pkg.height}
            onClick={() => window.confirm(`Book Shiprocket from the warehouse (estimated freight ${money(data.shiprocket.quote.courierCharge)})?`)
              && act(() => adminPost(`/fbb/orders/${order._id}/fulfillment/shiprocket`, { confirm: true, package: { length: Number(pkg.length), breadth: Number(pkg.breadth), height: Number(pkg.height) }, quotedCourierCharge: data.shiprocket.quote.courierCharge }), onDone)}>Book Shiprocket</button>
          <button type="button" style={btn} onClick={reload}>Refresh</button>
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
  const parsed = lines.map((l, n) => (sellable[n] === '' ? null : Number(sellable[n])));
  const valid = parsed.every((v, n) => Number.isInteger(v) && v >= 0 && v <= lines[n].qty);
  const submit = () => window.confirm('Record this inspection? Units marked sellable go back on sale; the rest go to the damaged bucket. This cannot be repeated.')
    && act(() => adminPost(`/fbb/orders/${order._id}/inspect`, { note, lines: lines.map((l, n) => ({ productId: l.productId, variantId: l.variantId, sellableQty: parsed[n], damagedQty: l.qty - parsed[n] })) }), onDone);
  return (
    <div style={{ marginTop: 6, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
      {lines.map((l, n) => (
        <label key={n} style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
          {name(l)} — {l.qty} back. Resellable:{' '}
          <input type="number" min="0" max={l.qty} value={sellable[n]} style={{ width: 60 }}
            onChange={(e) => setSellable(sellable.map((v, i) => (i === n ? e.target.value : v)))} />
          {Number.isInteger(parsed[n]) && parsed[n] <= l.qty ? ` · damaged ${l.qty - parsed[n]}` : ''}
        </label>
      ))}
      <label style={{ display: 'block', fontSize: 12 }}>Note <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="button" style={primary} disabled={busy || !valid} onClick={submit}>Record inspection</button>
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
      <>
        {s === 'awaiting_acceptance' && <button type="button" style={primary} disabled={busy} onClick={() => step(o, 'accept')}>Accept</button>}
        {s === 'accepted' && <button type="button" style={primary} disabled={busy} onClick={() => step(o, 'pick')}>Start picking</button>}
        {s === 'picking' && <button type="button" style={primary} disabled={busy} onClick={() => step(o, 'pack', 'Mark packed? The packaging charge is booked now.')}>Mark packed</button>}
        {s === 'packed' && o.status === 'preparing' && !o.deliveryPartnerId && !o.shiprocket?.awb && <button type="button" style={primary} onClick={() => setChoosing(choosing === o._id ? null : o._id)}>Choose delivery</button>}
        {s === 'packed' && o.shiprocket?.awb && <button type="button" style={primary} disabled={busy} onClick={() => step(o, 'handoff', 'Confirm the courier collected the parcel? Stock leaves the warehouse and the fulfilment charge is booked.')}>Confirm courier pickup</button>}
        {s !== 'handed_over' && ['placed', 'confirmed', 'preparing'].includes(o.status) && <button type="button" style={btn} disabled={busy} onClick={() => cancel(o)}>Cancel</button>}
        {o.fbb?.returnInspection?.status === 'pending' && <button type="button" style={primary} onClick={() => setChoosing(choosing === o._id ? null : o._id)}>Inspect returned parcel</button>}
      </>
    );
  };
  return (
    <section style={box}>
      <h3>FBB orders</h3>
      <div style={{ marginBottom: 8 }}>{[['open', 'To fulfil'], ['in_transit', 'In transit'], ['inspection', 'Returned — to inspect'], ['done', 'Finished']].map(([v, l]) => <button key={v} type="button" style={stage === v ? primary : btn} onClick={() => setStage(v)}>{l}</button>)}</div>
      <Refused error={error} />
      <Table rows={data?.rows || []} columns={[
        ['Order', (o) => o.orderNo], ['Placed', (o) => when(o.createdAt)], ['Seller', (o) => o.items?.[0]?.sellerId?.businessName || '—'],
        ['Items', (o) => o.items.map((i, n) => <div key={n}>{i.qty} × {i.name}{i.variantName ? ` (${i.variantName})` : ''}</div>)],
        ['Deliver to', (o) => `${o.shippingAddress?.city || ''} ${o.shippingAddress?.pincode || ''}`], ['Payment', (o) => o.paymentMethod],
        ['Status', (o) => <><Badge value={o.status} /> <Badge value={o.fbb?.status} label={FBB_STAGE[o.fbb?.status] || o.fbb?.status || '—'} /></>],
        ['Delivery', (o) => o.shiprocket?.awb ? `Shiprocket ${o.shiprocket.awb}` : o.deliveryPartnerId ? 'Bulkimart rider' : o.needsManualAssignment ? 'Waiting for a rider' : '—'],
        ['', (o) => <>{actions(o)}{choosing === o._id && (o.fbb?.returnInspection?.status === 'pending'
          ? <Inspect order={o} onDone={async () => { setChoosing(null); await reload(); }} />
          : <DeliveryChoice order={o} onDone={async () => { setChoosing(null); await reload(); }} />)}</>],
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
  if (!data) return <p style={{ fontSize: 12 }}>Checking pickup options…</p>;
  return (
    <div style={{ fontSize: 12, padding: 8, background: '#f8fafc', borderRadius: 8 }}>
      <div>Back to: <strong>{[data.drop?.name, data.drop?.city, data.drop?.pincode].filter(Boolean).join(', ')}</strong></div>
      <div>{data.manual?.riders?.length > 0 && <select value={rider} onChange={(e) => setRider(e.target.value)}><option value="">Choose rider…</option>{data.manual.riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
        <button type="button" style={primary} disabled={busy || !rider} onClick={() => act(() => adminPost(`/fbb/returns/${ret._id}/pickup`, { pickupMethod: 'MANUAL', riderId: rider }), onDone)}>Send rider</button>
        <button type="button" style={btn} disabled={busy || !data.shiprocket?.available} onClick={() => window.confirm('Book a Shiprocket reverse pickup to the warehouse?') && act(() => adminPost(`/fbb/returns/${ret._id}/pickup`, { pickupMethod: 'SHIPROCKET' }), onDone)}>Book Shiprocket</button>
        {data.manual?.reason && <em> {data.manual.reason}</em>}</div>
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
    <section style={box}>
      <h3>FBB returns</h3>
      <p style={{ fontSize: 12 }}>Bulkimart decides FBB returns and brings them back to the warehouse. After it arrives, inspect it and restock or refund on the Returns & Refunds screen: resellable units go back on sale, others to the damaged bucket.</p>
      <Refused error={error} />
      <Table rows={data || []} columns={[
        ['Return', (r) => r.returnNo || String(r._id).slice(-6)], ['Requested', (r) => when(r.requestedAt)], ['Reason', (r) => r.reason], ['Status', (r) => <Badge value={r.status} />], ['Pickup', (r) => r.pickup?.status || '—'],
        ['', (r) => <>
          {['RETURN_REQUESTED', 'UNDER_REVIEW'].includes(r.status) && <><button type="button" style={primary} disabled={busy} onClick={() => decide(r, true)}>Approve</button><button type="button" style={btn} disabled={busy} onClick={() => decide(r, false)}>Reject</button></>}
          {r.status === 'APPROVED' && <button type="button" style={primary} onClick={() => setPicking(picking === r._id ? null : r._id)}>Arrange pickup</button>}
          {r.status === 'AWAITING_RETURN' && <><button type="button" style={btn} disabled={busy} onClick={() => act(() => adminPost(`/fbb/returns/${r._id}/pickup/refresh`), reload)}>Refresh courier</button>
            <button type="button" style={primary} disabled={busy} onClick={() => window.confirm('Confirm the parcel reached the warehouse?') && act(() => adminPost(`/fbb/returns/${r._id}/mark-received`), reload)}>Received at warehouse</button></>}
          {picking === r._id && <ReturnPickup ret={r} onDone={async () => { setPicking(null); await reload(); }} />}
        </>],
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
  return (
    <>
      <section style={box}>
        <h3>Rates</h3>
        <p style={{ fontSize: 12 }}>Each change is a new version; earlier versions never change. Orders keep the rates in force when they were placed. Tax treatment is pending accountant review.</p>
        <Refused error={configs.error} />
        <Table rows={configs.data || []} columns={[
          ['Version', (c) => c.version], ['From', (c) => when(c.effectiveFrom)], ['Storage', (c) => `${money(c.storage.amount)} ${BASIS[c.storage.basis]}`],
          ['Packaging', (c) => `${money(c.packaging.amount)} ${BASIS[c.packaging.basis]}`], ['Fulfilment', (c) => `${money(c.fulfillment.amount)} ${BASIS[c.fulfillment.basis]}`],
        ]} empty="No rates yet." />
        {!form ? <button type="button" style={primary} onClick={() => setForm({ storage: '', packaging: '', packagingBasis: 'per_order', fulfillment: '', fulfillmentBasis: 'per_unit', effectiveFrom: '', reason: '' })}>New rate version</button> : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8, fontSize: 12 }}>
            <label>Storage ₹/unit <input type="number" min="0" step="0.01" style={{ width: 80 }} value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} /></label>
            <label>Packaging ₹ <input type="number" min="0" step="0.01" style={{ width: 80 }} value={form.packaging} onChange={(e) => setForm({ ...form, packaging: e.target.value })} />
              <select value={form.packagingBasis} onChange={(e) => setForm({ ...form, packagingBasis: e.target.value })}><option value="per_order">per order</option><option value="per_unit">per unit</option></select></label>
            <label>Fulfilment ₹ <input type="number" min="0" step="0.01" style={{ width: 80 }} value={form.fulfillment} onChange={(e) => setForm({ ...form, fulfillment: e.target.value })} />
              <select value={form.fulfillmentBasis} onChange={(e) => setForm({ ...form, fulfillmentBasis: e.target.value })}><option value="per_unit">per unit</option><option value="per_order">per order</option></select></label>
            <label>Effective from <input type="datetime-local" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
            <label style={{ flex: 1 }}>Reason <input style={{ width: '100%' }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            <button type="button" style={primary} disabled={busy || form.reason.trim().length < 5 || form.storage === '' || form.packaging === '' || form.fulfillment === ''} onClick={saveRates}>Save version</button>
            <button type="button" style={btn} onClick={() => setForm(null)}>Cancel</button>
          </div>
        )}
      </section>
      <section style={box}>
        <h3>Outstanding by seller</h3>
        <p style={{ fontSize: 12 }}>Outstanding charges are deducted from eligible earnings automatically before payouts. Sellers can also pay in advance. Sellers are never suspended automatically.</p>
        <Refused error={billing.error} />
        <Table rows={billing.data || []} columns={[
          ['Seller', (s) => s.sellerName || String(s.sellerId)], ['Outstanding', (s) => money(s.outstanding)],
          ['', (s) => <button type="button" style={btn} disabled={busy} onClick={() => settle(s)}>Deduct from earnings now</button>],
        ]} empty="No seller owes FBB charges." />
      </section>
      <section style={box}>
        <h3>Charges</h3>
        <Refused error={charges.error} />
        <Table rows={charges.data?.rows || []} columns={[
          ['When', (c) => when(c.createdAt)], ['Type', (c) => TYPE[c.type] || c.type], ['For', (c) => c.orderId?.orderNo || c.receiptId?.receiptNo || '—'], ['Qty', (c) => c.qty],
          ['Rate', (c) => `${money(c.rate)} ${BASIS[c.basis] || ''}`], ['Amount', (c) => money(c.amount)], ['Rate version', (c) => c.configVersion], ['Status', (c) => <Badge value={c.status} />],
          ['', (c) => c.status === 'posted' && c.amountPaise > 0 && <button type="button" style={btn} disabled={busy} onClick={() => reverse(c)}>Reverse</button>],
        ]} empty="No charges yet." />
      </section>
      <section style={box}>
        <h3>Ledger check</h3>
        <Refused error={recon.error} />
        {recon.data && <p style={{ fontSize: 13 }}>{recon.data.checked} charges checked; {recon.data.problems.length ? <strong style={{ color: '#b42318' }}>{recon.data.problems.length} problem(s)</strong> : 'every charge matches its ledger entry.'}</p>}
        {recon.data?.problems?.length > 0 && <ul style={{ fontSize: 12 }}>{recon.data.problems.map((p, i) => <li key={i}>{typeof p === 'string' ? p : JSON.stringify(p)}</li>)}</ul>}
      </section>
    </>
  );
}

const VIEWS = { overview: Overview, warehouses: Warehouses, pilot: PilotSellers, receiving: Receiving, stock: Stock, adjustments: Adjustments, orders: Orders, returns: Returns, charges: Charges };

export default function FbbTab() {
  const [section, setSection] = useState('overview');
  const View = VIEWS[section];
  return (
    <div className="fbb-ws">
      <div className="fbb-ws-head">
        <h2 className="fbb-ws-title">Fulfilled by Bulkimart</h2>
        <p className="fbb-ws-subtitle">Warehouse stock, FBB orders and returns, and FBB service charges.</p>
      </div>
      <nav aria-label="FBB sections" className="fbb-tabs">
        {SECTIONS.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} className={`fbb-tab${section === id ? ' is-active' : ''}`} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      <View key={section} />
    </div>
  );
}
