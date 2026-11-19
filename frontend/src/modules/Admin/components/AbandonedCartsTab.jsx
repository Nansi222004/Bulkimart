import React, { useCallback, useEffect, useState } from 'react';
import { adminGet, adminPost, qs } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';

/**
 * Abandoned carts: customers who added products and did not order, their add/remove
 * history, and "your cart is waiting" reminders (one customer, a selection, or everyone
 * in the current filter). Reminders open the customer's cart when tapped.
 */
const money = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const ago = (d) => {
  if (!d) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const CHANNEL_LABEL = { ecommerce: 'Shop All', grocery: 'Quick', wholesale: 'Wholesale' };
const INACTIVE = [['1', '1 hour'], ['6', '6 hours'], ['24', '24 hours'], ['72', '3 days'], ['168', '7 days']];
const SKIP_REASON = { recently_reminded: 'reminded recently', empty_cart: 'cart now empty', inactive_account: 'account inactive' };

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const btn = (primary) => ({ padding: '8px 14px', borderRadius: 9, border: primary ? 'none' : '1px solid #cbd5e1', background: primary ? '#10b981' : '#fff', color: primary ? '#fff' : '#0f172a', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' });
const input = { padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff', minWidth: 0 };

function Stat({ label, value, sub }) {
  return <div style={{ ...card, flex: '1 1 180px' }}>
    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
    {sub ? <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{sub}</div> : null}
  </div>;
}

/** Title/message editor used for every send. Placeholders are filled per customer. */
function RemindDialog({ target, defaults, onClose, onSent }) {
  const { triggerToast } = useAdmin();
  const [title, setTitle] = useState(defaults?.title || '');
  const [message, setMessage] = useState(defaults?.message || '');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await adminPost('/abandoned-carts/remind', { ...(target.userIds ? { userIds: target.userIds } : { filters: target.filters }), title, message });
      const skipped = res.data?.skipped || [];
      const reasons = Object.entries(skipped.reduce((m, s) => ({ ...m, [s.reason]: (m[s.reason] || 0) + 1 }), {})).map(([r, n]) => `${n} ${SKIP_REASON[r] || r}`).join(', ');
      triggerToast(`${res.data?.sent || 0} reminder${res.data?.sent === 1 ? '' : 's'} sent${reasons ? ` · skipped: ${reasons}` : ''}`);
      onSent();
    } catch (err) { triggerToast(err.message || 'Could not send reminders', { type: 'error' }); }
    finally { setBusy(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label="Send cart reminder" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <div style={{ ...card, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 17 }}>Send “your cart is waiting” reminder</h3>
      <p style={{ margin: 0, fontSize: 12.5, color: '#475569' }}>To: <strong>{target.label}</strong>. Sent as an app notification and in their notification list. Tapping it opens their cart. Customers reminded in the last {defaults?.minGapHours || 24} hours are skipped.</p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 700 }}>Title
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={input} /></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 700 }}>Message
        <textarea value={message} maxLength={300} rows={4} onChange={(e) => setMessage(e.target.value)} style={{ ...input, resize: 'vertical' }} /></label>
      <small style={{ color: '#64748b' }}>Filled in for each customer: <code>{'{name}'}</code> first name · <code>{'{item}'}</code> a product in their cart · <code>{'{more}'}</code> “and 2 more items” · <code>{'{count}'}</code> number of items.</small>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" style={btn(false)} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" style={btn(true)} onClick={send} disabled={busy || !title.trim() || !message.trim()}>{busy ? 'Sending…' : 'Send reminder'}</button>
      </div>
    </div>
  </div>;
}

/** One customer's carts and full history (cart changes, reminders, orders). */
function CustomerDetail({ userId, onBack, onRemind }) {
  const { triggerToast } = useAdmin();
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    adminGet(`/abandoned-carts/${userId}`).then((r) => { if (live) setD(r.data); }).catch((err) => triggerToast(err.message || 'Could not load customer', { type: 'error' }));
    return () => { live = false; };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>;
  const timeline = [
    ...d.activity.map((a) => ({ at: a.at, icon: { add: '➕', qty: '🔢', remove: '➖', clear: '🗑️' }[a.action],
      text: a.action === 'add' ? `Added ${a.qty} × ${a.name || 'item'}${a.price ? ` (${money(a.price)})` : ''}`
        : a.action === 'qty' ? `Changed ${a.name || 'item'} from ${a.fromQty} to ${a.qty}`
        : a.action === 'remove' ? `Removed ${a.name || 'item'}` : `Emptied the ${CHANNEL_LABEL[a.channel] || ''} cart (${a.qty} item${a.qty === 1 ? '' : 's'})`,
      sub: CHANNEL_LABEL[a.channel] })),
    ...d.reminders.map((r) => ({ at: r.sentAt, icon: '🔔', text: `Reminder sent${r.source === 'auto' ? ' automatically' : r.sentBy ? ` by ${r.sentBy}` : ''}: “${r.title}”`,
      sub: r.recovered ? `✅ Ordered ${r.recovered.orderNo} (${money(r.recovered.amount)}) on ${when(r.recovered.at)}` : 'No order yet', good: Boolean(r.recovered) })),
    ...d.orders.map((o) => ({ at: o.createdAt, icon: '📦', text: `Placed order ${o.orderNo} · ${money(o.amount)}`, sub: o.status })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" style={btn(false)} onClick={onBack}>← All abandoned carts</button>
      <button type="button" style={btn(true)} onClick={() => onRemind({ userIds: [userId], label: d.customer.name })} disabled={!d.carts.length}>🔔 Send reminder</button>
    </div>
    <div style={card}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{d.customer.name}</div>
      <div style={{ fontSize: 13, color: '#475569' }}>{[d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}</div>
    </div>
    {d.carts.length ? d.carts.map((c) => <div key={c.channel} style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <strong>{CHANNEL_LABEL[c.channel] || c.channel} cart · {money(c.value)}</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>Last changed {ago(c.updatedAt)}</span>
      </div>
      {c.items.map((i) => <div key={i._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
        {i.image ? <img src={i.image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ width: 40, height: 40, borderRadius: 6, background: '#f1f5f9', display: 'inline-block' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{i.name}{i.variantName ? ` · ${i.variantName}` : ''}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{i.qty} × {money(i.price)}{i.addedAt ? ` · added ${ago(i.addedAt)}` : ''}</div>
        </div>
        <strong style={{ fontSize: 13 }}>{money((i.price || 0) * i.qty)}</strong>
      </div>)}
    </div>) : <div style={card}>This customer’s cart is empty now.</div>}
    <div style={card}>
      <strong style={{ display: 'block', marginBottom: 8 }}>History</strong>
      {timeline.length ? timeline.map((t, n) => <div key={n} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: n ? '1px solid #f1f5f9' : 'none' }}>
        <span aria-hidden="true">{t.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13 }}>{t.text}</div>
          <div style={{ fontSize: 11.5, color: t.good ? '#047857' : '#64748b' }}>{when(t.at)}{t.sub ? ` · ${t.sub}` : ''}</div>
        </div>
      </div>) : <span style={{ fontSize: 13, color: '#64748b' }}>No cart activity recorded yet. History is kept from the day this feature went live.</span>}
    </div>
  </div>;
}

function ReminderSettings({ value, onSaved }) {
  const { triggerToast } = useAdmin();
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(value), [value]);
  const save = async () => {
    setBusy(true);
    try { const r = await adminPost('/abandoned-carts/settings', { ...f, autoAfterHours: Number(f.autoAfterHours), minGapHours: Number(f.minGapHours) }); triggerToast('Reminder settings saved.'); onSaved(r.data); }
    catch (err) { triggerToast(err.message || 'Could not save settings', { type: 'error' }); }
    finally { setBusy(false); }
  };
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const label = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 700 };
  return <details style={card}>
    <summary style={{ cursor: 'pointer', fontWeight: 800 }}>⚙️ Reminder settings {value.autoEnabled ? '· automatic reminders ON' : '· automatic reminders off'}</summary>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 14 }}>
      <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 8, gridColumn: '1 / -1' }}>
        <input type="checkbox" checked={Boolean(f.autoEnabled)} onChange={set('autoEnabled')} style={{ width: 18, height: 18, accentColor: '#10b981' }} />
        Send reminders automatically
      </label>
      <label style={label}>Remind automatically after (hours)<input type="number" min="1" max="720" value={f.autoAfterHours} onChange={set('autoAfterHours')} style={input} />
        <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>Once per abandoned cart: a customer is reminded again only after changing their cart and leaving it again.</span></label>
      <label style={label}>Never remind the same customer within (hours)<input type="number" min="1" max="720" value={f.minGapHours} onChange={set('minGapHours')} style={input} />
        <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>Applies to manual and automatic reminders, so nobody is spammed.</span></label>
      <label style={{ ...label, gridColumn: '1 / -1' }}>Default title<input value={f.title} maxLength={80} onChange={set('title')} style={input} /></label>
      <label style={{ ...label, gridColumn: '1 / -1' }}>Default message<textarea rows={3} value={f.message} maxLength={300} onChange={set('message')} style={{ ...input, resize: 'vertical' }} />
        <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>{'{name}'} first name · {'{item}'} a product in the cart · {'{more}'} “and 2 more items” · {'{count}'} number of items</span></label>
    </div>
    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}><button type="button" style={btn(true)} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
  </details>;
}

export const AbandonedCartsTab = () => {
  const { triggerToast } = useAdmin();
  const [filters, setFilters] = useState({ inactiveHours: '1', channel: '', minValue: '', reminded: '', q: '' });
  const [page, setPage] = useState(1);
  const [list, setList] = useState(null);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [viewing, setViewing] = useState(null);
  const [remind, setRemind] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        adminGet('/abandoned-carts' + qs({ ...filters, page, limit: 20 })),
        adminGet('/abandoned-carts/stats' + qs({ inactiveHours: filters.inactiveHours })),
      ]);
      setList(l.data); setStats(s.data);
    } catch (err) { triggerToast(err.message || 'Could not load abandoned carts', { type: 'error' }); }
    finally { setLoading(false); }
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { adminGet('/abandoned-carts/settings').then((r) => setSettings(r.data)).catch(() => {}); }, []);

  const setFilter = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); setSelected(new Set()); };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rows = list?.rows || [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(String(r.userId)));

  const dialog = remind && <RemindDialog target={remind} defaults={settings} onClose={() => setRemind(null)} onSent={() => { setRemind(null); setSelected(new Set()); load(); }} />;

  if (viewing) return <div style={{ padding: '20px 16px', maxWidth: 900, margin: '0 auto', fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>
    <CustomerDetail key={viewing} userId={viewing} onBack={() => { setViewing(null); load(); }} onRemind={setRemind} />{dialog}
  </div>;

  return <div style={{ padding: '20px 16px', maxWidth: 1180, margin: '0 auto', fontFamily: "'Inter', sans-serif", color: '#0f172a', display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>🛒 Abandoned Carts</h2>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>Customers who added products to their cart and have not ordered. See what they added and removed, and send a reminder so they complete checkout.</p>
    </div>

    {stats ? <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Stat label="Customers with items waiting" value={stats.waiting.customers} sub={`cart idle for ${INACTIVE.find(([v]) => v === filters.inactiveHours)?.[1] || filters.inactiveHours + ' h'}+`} />
      <Stat label="Value left in carts" value={money(stats.waiting.value)} />
      <Stat label={`Reminders sent (${stats.lastDays} days)`} value={stats.reminders} />
      <Stat label="Recovered by reminders" value={`${stats.recovered} · ${stats.recoveryRate}%`} sub={`${money(stats.recoveredValue)} ordered within 7 days of a reminder`} />
    </div> : null}

    {settings ? <ReminderSettings value={settings} onSaved={setSettings} /> : null}

    <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>Cart idle for at least
        <select value={filters.inactiveHours} onChange={setFilter('inactiveHours')} style={input}>{INACTIVE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>Shop
        <select value={filters.channel} onChange={setFilter('channel')} style={input}><option value="">All</option>{Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>Min cart value (₹)
        <input type="number" min="0" value={filters.minValue} onChange={setFilter('minValue')} style={{ ...input, width: 110 }} /></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>Reminded
        <select value={filters.reminded} onChange={setFilter('reminded')} style={input}><option value="">All</option><option value="no">Not yet</option><option value="yes">Already reminded</option></select></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, flex: '1 1 180px' }}>Search
        <input placeholder="Name, phone or email" value={filters.q} onChange={setFilter('q')} style={input} /></label>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" style={btn(true)} disabled={!selected.size} onClick={() => setRemind({ userIds: [...selected], label: `${selected.size} selected customer${selected.size === 1 ? '' : 's'}` })}>🔔 Remind selected ({selected.size})</button>
      <button type="button" style={btn(false)} disabled={!list?.totals.customers} onClick={() => setRemind({ filters: { ...filters }, label: `all ${list.totals.customers} customer${list.totals.customers === 1 ? '' : 's'} in this list` })}>Remind all in this list ({list?.totals.customers || 0})</button>
      <span style={{ fontSize: 12, color: '#64748b' }}>{list ? `${list.totals.customers} customers · ${list.totals.items} items · ${money(list.totals.value)}` : ''}</span>
    </div>

    <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
        <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}>
          <th style={{ padding: 10, width: 32 }}><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); rows.forEach((r) => (allOnPage ? n.delete(String(r.userId)) : n.add(String(r.userId)))); return n; })} /></th>
          {['Customer', 'In cart', 'Value', 'Last cart activity', 'Reminders', ''].map((h) => <th key={h} style={{ padding: 10, fontSize: 12, color: '#475569' }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {loading && !rows.length ? <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Loading…</td></tr> : null}
          {!loading && !rows.length ? <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No abandoned carts match these filters.</td></tr> : null}
          {rows.map((r) => <tr key={r.userId} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td style={{ padding: 10 }}><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(String(r.userId))} onChange={() => toggle(String(r.userId))} /></td>
            <td style={{ padding: 10 }}><div style={{ fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{r.phone}</div></td>
            <td style={{ padding: 10 }}><div>{r.itemCount} item{r.itemCount === 1 ? '' : 's'} · {r.carts.map((c) => CHANNEL_LABEL[c.channel] || c.channel).join(', ')}</div><div style={{ fontSize: 12, color: '#64748b', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.preview.join(', ')}</div></td>
            <td style={{ padding: 10, fontWeight: 700 }}>{money(r.value)}</td>
            <td style={{ padding: 10 }}>{ago(r.lastActivity)}</td>
            <td style={{ padding: 10 }}>{r.reminderCount ? <span>{r.reminderCount} · last {ago(r.lastReminderAt)}</span> : <span style={{ color: '#94a3b8' }}>None</span>}</td>
            <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
              <button type="button" style={{ ...btn(false), marginRight: 6 }} onClick={() => setViewing(String(r.userId))}>View</button>
              <button type="button" style={btn(true)} onClick={() => setRemind({ userIds: [String(r.userId)], label: r.name })}>Remind</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {list && list.totalPages > 1 ? <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
      <button type="button" style={btn(false)} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
      <span style={{ fontSize: 13 }}>Page {page} of {list.totalPages}</span>
      <button type="button" style={btn(false)} disabled={page >= list.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
    </div> : null}
    {dialog}
  </div>;
};

export default AbandonedCartsTab;
