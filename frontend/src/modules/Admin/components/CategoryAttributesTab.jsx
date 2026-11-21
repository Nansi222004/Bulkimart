import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminGet, adminPost, adminPatch, authGet, authPut } from '../../../utils/adminApi';

/**
 * Admin → Categories → Category Fields.
 * 1. Attribute library: reusable fields (Size, RAM, Purity, Expiry date …) with their type, options and limits.
 * 2. Category fields: which attributes a category asks for, required or not, per variant, as a customer filter,
 *    and on the product page. Subcategories inherit their parents' fields.
 * Seller forms, product validation and customer filters are generated from this; no code change is needed.
 */
const TYPES = [
  ['text', 'Short text'], ['longtext', 'Long text'], ['number', 'Whole number'], ['decimal', 'Decimal number'],
  ['select', 'Dropdown (one)'], ['multiselect', 'Multi-select'], ['date', 'Date'], ['boolean', 'Yes / No'],
  ['image', 'Image upload'], ['file', 'File upload'],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
const HAS_OPTIONS = ['select', 'multiselect'];
const CAN_BE_VARIANT = ['select', 'text', 'number', 'decimal'];

const box = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16 };
const input = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const btn = (primary) => ({ padding: '8px 14px', borderRadius: 8, border: primary ? 'none' : '1px solid #cbd5e1', background: primary ? '#0f766e' : '#fff', color: primary ? '#fff' : '#0f172a', fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const th = { textAlign: 'left', fontSize: 12, color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #e2e8f0' };
const td = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };

const blankAttribute = { label: '', code: '', fieldType: 'text', unit: '', helpText: '', placeholder: '', optionsText: '', min: '', max: '', maxLength: '', pattern: '', patternMessage: '' };

const flattenTree = (nodes, trail = [], out = []) => {
  for (const n of nodes || []) {
    const path = [...trail, n.name];
    out.push({ id: String(n._id), label: path.join(' › '), depth: trail.length });
    flattenTree(n.children, path, out);
  }
  return out;
};

export default function CategoryAttributesTab() {
  const [attributes, setAttributes] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | { ...form, _id? }
  const [savingAttr, setSavingAttr] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }

  const [storefront, setStorefront] = useState('ecommerce');
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [mapping, setMapping] = useState(null); // { category, mappings, effective }
  const [rows, setRows] = useState([]);
  const [savingMap, setSavingMap] = useState(false);
  const [audit, setAudit] = useState([]);

  const say = (tone, text) => setMessage({ tone, text });

  const loadAttributes = useCallback(async () => {
    try {
      const { data } = await adminGet(`/catalog/attributes${showArchived ? '?includeArchived=true' : ''}`);
      setAttributes(data || []);
    } catch (e) { say('error', e.message); }
  }, [showArchived]);
  useEffect(() => { loadAttributes(); }, [loadAttributes]);

  const loadAudit = useCallback(async () => {
    try { const { data } = await adminGet('/catalog/audit?limit=30'); setAudit(data || []); } catch { /* the log is informational */ }
  }, []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  useEffect(() => {
    let cancelled = false;
    authGet(`/api/categories/tree?type=${storefront}`)
      .then(({ data }) => { if (!cancelled) { setCategories(flattenTree(Array.isArray(data) ? data : data?.data || [])); setCategoryId(''); setMapping(null); } })
      .catch((e) => { if (!cancelled) say('error', e.message); });
    return () => { cancelled = true; };
  }, [storefront]);

  const loadMapping = useCallback(async (id) => {
    if (!id) { setMapping(null); setRows([]); return; }
    try {
      const { data } = await adminGet(`/catalog/categories/${id}/attributes`);
      setMapping(data);
      setRows((data.mappings || []).map((m) => ({
        attribute: String(m.attribute?._id || m.attribute), required: !!m.required, isVariant: !!m.isVariant, isFilter: !!m.isFilter,
        showOnDetail: m.showOnDetail !== false, group: m.group || 'Product details', sortOrder: m.sortOrder ?? 0, isActive: m.isActive !== false,
      })));
    } catch (e) { say('error', e.message); }
  }, []);
  useEffect(() => { loadMapping(categoryId); }, [categoryId, loadMapping]);

  const byId = useMemo(() => new Map(attributes.map((a) => [String(a._id), a])), [attributes]);
  const visible = attributes.filter((a) => !search || `${a.label} ${a.code}`.toLowerCase().includes(search.toLowerCase()));
  const ownIds = new Set(rows.map((r) => r.attribute));
  const inherited = (mapping?.effective || []).filter((f) => f.inherited && !ownIds.has(f.attributeId));

  // ------------------------------------------------------------ attribute form
  const startNew = () => setEditing({ ...blankAttribute });
  const startEdit = (a) => setEditing({
    _id: a._id, label: a.label, code: a.code, fieldType: a.fieldType, unit: a.unit || '', helpText: a.helpText || '', placeholder: a.placeholder || '',
    optionsText: (a.options || []).filter((o) => o.isActive !== false).map((o) => o.label).join('\n'),
    min: a.validation?.min ?? '', max: a.validation?.max ?? '', maxLength: a.validation?.maxLength ?? '', pattern: a.validation?.pattern || '', patternMessage: a.validation?.patternMessage || '',
  });
  const saveAttribute = async () => {
    if (!editing.label.trim()) { say('error', 'Give the attribute a name.'); return; }
    const existing = editing._id ? byId.get(String(editing._id)) : null;
    const labels = editing.optionsText.split('\n').map((s) => s.trim()).filter(Boolean);
    // Keep each existing option's stored value so products that already use it still match.
    const options = labels.map((label, i) => {
      const old = (existing?.options || []).find((o) => o.label.toLowerCase() === label.toLowerCase());
      return { label, value: old?.value || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `option_${i + 1}`, sortOrder: i };
    });
    const payload = {
      label: editing.label.trim(), fieldType: editing.fieldType, unit: editing.unit, helpText: editing.helpText, placeholder: editing.placeholder,
      ...(HAS_OPTIONS.includes(editing.fieldType) ? { options } : {}),
      validation: { min: editing.min, max: editing.max, maxLength: editing.maxLength, pattern: editing.pattern, patternMessage: editing.patternMessage },
      ...(!editing._id && editing.code.trim() ? { code: editing.code.trim() } : {}),
    };
    setSavingAttr(true);
    try {
      if (editing._id) await authPut(`/api/admin/catalog/attributes/${editing._id}`, payload);
      else await adminPost('/catalog/attributes', payload);
      say('success', `${payload.label} saved.`);
      setEditing(null); await loadAttributes(); loadAudit(); if (categoryId) loadMapping(categoryId);
    } catch (e) { say('error', e.message); } finally { setSavingAttr(false); }
  };
  const toggleArchive = async (a) => {
    try {
      await adminPatch(`/catalog/attributes/${a._id}/status`, { isActive: !a.isActive });
      say('success', `${a.label} ${a.isActive ? 'archived' : 'restored'}. Existing products keep their values.`);
      await loadAttributes(); loadAudit();
    } catch (e) { say('error', e.message); }
  };

  // ------------------------------------------------------------ category mapping
  const setRow = (i, key, value) => setRows((list) => list.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const addRow = (attributeId) => {
    if (!attributeId || ownIds.has(attributeId)) return;
    setRows((list) => [...list, { attribute: attributeId, required: false, isVariant: false, isFilter: false, showOnDetail: true, group: 'Product details', sortOrder: list.length, isActive: true }]);
  };
  const hideInherited = (attributeId) => setRows((list) => [...list, { attribute: attributeId, required: false, isVariant: false, isFilter: false, showOnDetail: true, group: 'Product details', sortOrder: list.length, isActive: false }]);
  const move = (i, dir) => setRows((list) => {
    const j = i + dir; if (j < 0 || j >= list.length) return list;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]];
    return next.map((r, k) => ({ ...r, sortOrder: k }));
  });
  const saveMapping = async () => {
    setSavingMap(true);
    try {
      const { data } = await authPut(`/api/admin/catalog/categories/${categoryId}/attributes`, { mappings: rows.map((r, i) => ({ ...r, sortOrder: i })) });
      setMapping((m) => ({ ...m, mappings: data.mappings, effective: data.effective }));
      say('success', `Saved. Sellers listing in ${mapping?.category?.name} now see ${data.effective.length} field${data.effective.length === 1 ? '' : 's'}.`);
      loadAudit(); loadAttributes();
    } catch (e) { say('error', e.message); } finally { setSavingMap(false); }
  };

  const [savingApproval, setSavingApproval] = useState(false);
  const toggleApproval = async (on) => {
    setSavingApproval(true);
    try {
      await adminPatch(`/catalog/categories/${categoryId}/approval`, { requireProductApproval: on });
      setMapping((m) => ({ ...m, category: { ...m.category, requireProductApproval: on } }));
      say('success', on ? `New listings in ${mapping?.category?.name} will wait in Products → Pending review.` : `New listings in ${mapping?.category?.name} go live straight away.`);
      loadAudit();
    } catch (e) { say('error', e.message); } finally { setSavingApproval(false); }
  };

  return (
    <div style={{ padding: 16, maxWidth: 1200 }}>
      <h2 style={{ margin: '0 0 4px' }}>Category Fields</h2>
      <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13 }}>
        Define product fields once, then choose which categories ask for them. Sellers see these fields when they pick the category; customers can filter by them.
      </p>
      {message ? (
        <div role="status" style={{ ...box, padding: 10, background: message.tone === 'error' ? '#fef2f2' : '#f0fdf4', borderColor: message.tone === 'error' ? '#fecaca' : '#bbf7d0', color: message.tone === 'error' ? '#b91c1c' : '#166534' }}>
          {message.text} <button type="button" onClick={() => setMessage(null)} style={{ float: 'right', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      ) : null}

      {/* ---------------- Category fields ---------------- */}
      <section style={box}>
        <h3 style={{ marginTop: 0 }}>1. Fields for a category</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={storefront} onChange={(e) => setStorefront(e.target.value)} style={{ ...input, width: 180 }} aria-label="Storefront">
            <option value="ecommerce">Shop All</option>
            <option value="grocery">Quick Commerce</option>
          </select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...input, flex: 1, minWidth: 260 }} aria-label="Category">
            <option value="">Choose a category or subcategory…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{'  '.repeat(c.depth)}{c.label}</option>)}
          </select>
        </div>

        {mapping ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0', padding: 10, border: '1px solid #e2e8f0', borderRadius: 8 }}>
            <input type="checkbox" disabled={savingApproval} checked={Boolean(mapping.category?.requireProductApproval)} onChange={(e) => toggleApproval(e.target.checked)} />
            <span><b>Require admin approval</b> for new listings in this category and its subcategories (e.g. Jewellery, Food). They wait in Products → Pending review until approved.</span>
          </label>
        ) : null}
        {mapping ? (
          <>
            {inherited.length ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Inherited from parent categories</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {inherited.map((f) => (
                    <span key={f.attributeId} style={{ fontSize: 12, background: '#f1f5f9', borderRadius: 14, padding: '4px 10px' }}>
                      {f.label}{f.required ? ' *' : ''}{f.isVariant ? ' · variant' : ''}{f.isFilter ? ' · filter' : ''}
                      <button type="button" title="Change or hide this field for this category only" onClick={() => addRow(f.attributeId)} style={{ marginLeft: 6, border: 'none', background: 'none', color: '#0f766e', cursor: 'pointer', fontSize: 12 }}>override</button>
                      <button type="button" title="Hide this inherited field for this category" onClick={() => hideInherited(f.attributeId)} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>hide</button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Field</th><th style={th}>Required</th><th style={th}>Per variant</th><th style={th}>Customer filter</th>
                  <th style={th}>On product page</th><th style={th}>Group</th><th style={th}>Order</th><th style={th} />
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const a = byId.get(r.attribute);
                    return (
                      <tr key={r.attribute} style={{ opacity: r.isActive ? 1 : 0.55 }}>
                        <td style={td}>
                          <strong>{a?.label || 'Archived field'}</strong>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{a ? TYPE_LABEL[a.fieldType] : ''}{r.isActive ? '' : ' · hidden here'}</div>
                        </td>
                        <td style={td}><input type="checkbox" checked={r.required} disabled={!r.isActive} onChange={(e) => setRow(i, 'required', e.target.checked)} aria-label="Required" /></td>
                        <td style={td}><input type="checkbox" checked={r.isVariant} disabled={!r.isActive || !CAN_BE_VARIANT.includes(a?.fieldType)} onChange={(e) => setRow(i, 'isVariant', e.target.checked)} aria-label="Per variant" title={CAN_BE_VARIANT.includes(a?.fieldType) ? 'Each variant (SKU) sets its own value, e.g. Size or Colour' : 'Only dropdown, text or number fields can define variants'} /></td>
                        <td style={td}><input type="checkbox" checked={r.isFilter} disabled={!r.isActive} onChange={(e) => setRow(i, 'isFilter', e.target.checked)} aria-label="Customer filter" /></td>
                        <td style={td}><input type="checkbox" checked={r.showOnDetail} disabled={!r.isActive} onChange={(e) => setRow(i, 'showOnDetail', e.target.checked)} aria-label="On product page" /></td>
                        <td style={td}><input value={r.group} disabled={!r.isActive} onChange={(e) => setRow(i, 'group', e.target.value)} style={{ ...input, width: 150 }} aria-label="Group" /></td>
                        <td style={td}>
                          <button type="button" onClick={() => move(i, -1)} style={{ ...btn(false), padding: '2px 8px' }} aria-label="Move up">↑</button>
                          <button type="button" onClick={() => move(i, 1)} style={{ ...btn(false), padding: '2px 8px', marginLeft: 4 }} aria-label="Move down">↓</button>
                        </td>
                        <td style={td}><button type="button" onClick={() => setRows((list) => list.filter((_, j) => j !== i))} style={{ ...btn(false), color: '#b91c1c' }}>Remove</button></td>
                      </tr>
                    );
                  })}
                  {!rows.length ? <tr><td style={td} colSpan={8}>No fields of its own yet{inherited.length ? ' (it uses the inherited ones above)' : ''}. Add one below.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value="" onChange={(e) => addRow(e.target.value)} style={{ ...input, width: 280 }} aria-label="Add a field">
                <option value="">+ Add a field to this category…</option>
                {attributes.filter((a) => a.isActive && !ownIds.has(String(a._id))).map((a) => <option key={a._id} value={a._id}>{a.label} ({TYPE_LABEL[a.fieldType]})</option>)}
              </select>
              <button type="button" onClick={saveMapping} disabled={savingMap} style={btn(true)}>{savingMap ? 'Saving…' : 'Save fields'}</button>
              <span style={{ fontSize: 12, color: '#64748b' }}>Subcategories under this one inherit these fields.</span>
            </div>
          </>
        ) : <p style={{ color: '#64748b', fontSize: 13 }}>Choose a category to see and edit its fields.</p>}
      </section>

      {/* ---------------- Attribute library ---------------- */}
      <section style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>2. Attribute library</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="Search fields" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, width: 200 }} />
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
            <button type="button" onClick={startNew} style={btn(true)}>+ New attribute</button>
          </div>
        </div>

        {editing ? (
          <div style={{ ...box, background: '#f8fafc', marginTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>{editing._id ? `Edit ${editing.label}` : 'New attribute'}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <label style={{ fontSize: 12 }}>Name *<input style={input} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. Sleeve type" /></label>
              <label style={{ fontSize: 12 }}>Code (optional){editing._id ? ' · fixed' : ''}<input style={input} value={editing.code} disabled={!!editing._id} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="auto from name, e.g. sleeve_type" /></label>
              <label style={{ fontSize: 12 }}>Field type *
                <select style={input} value={editing.fieldType} onChange={(e) => setEditing({ ...editing, fieldType: e.target.value })}>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>Unit<input style={input} value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="GB, g, ml, months…" /></label>
              <label style={{ fontSize: 12 }}>Help text<input style={input} value={editing.helpText} onChange={(e) => setEditing({ ...editing, helpText: e.target.value })} /></label>
              <label style={{ fontSize: 12 }}>Placeholder<input style={input} value={editing.placeholder} onChange={(e) => setEditing({ ...editing, placeholder: e.target.value })} /></label>
              {['number', 'decimal'].includes(editing.fieldType) ? (
                <>
                  <label style={{ fontSize: 12 }}>Minimum<input style={input} type="number" value={editing.min} onChange={(e) => setEditing({ ...editing, min: e.target.value })} /></label>
                  <label style={{ fontSize: 12 }}>Maximum<input style={input} type="number" value={editing.max} onChange={(e) => setEditing({ ...editing, max: e.target.value })} /></label>
                </>
              ) : null}
              {['text', 'longtext'].includes(editing.fieldType) ? (
                <>
                  <label style={{ fontSize: 12 }}>Max length<input style={input} type="number" value={editing.maxLength} onChange={(e) => setEditing({ ...editing, maxLength: e.target.value })} /></label>
                  <label style={{ fontSize: 12 }}>Format rule (regex, optional)<input style={input} value={editing.pattern} onChange={(e) => setEditing({ ...editing, pattern: e.target.value })} placeholder="e.g. ^\d{14}$" /></label>
                  <label style={{ fontSize: 12 }}>Message when the format is wrong<input style={input} value={editing.patternMessage} onChange={(e) => setEditing({ ...editing, patternMessage: e.target.value })} /></label>
                </>
              ) : null}
            </div>
            {HAS_OPTIONS.includes(editing.fieldType) ? (
              <label style={{ fontSize: 12, display: 'block', marginTop: 10 }}>Options, one per line *
                <textarea style={{ ...input, minHeight: 110 }} value={editing.optionsText} onChange={(e) => setEditing({ ...editing, optionsText: e.target.value })} placeholder={'S\nM\nL\nXL'} />
                <span style={{ color: '#64748b' }}>Removing an option hides it from new listings; products that already use it keep it.</span>
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={saveAttribute} disabled={savingAttr} style={btn(true)}>{savingAttr ? 'Saving…' : 'Save attribute'}</button>
              <button type="button" onClick={() => setEditing(null)} style={btn(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Field</th><th style={th}>Type</th><th style={th}>Options</th><th style={th}>Used in</th><th style={th} /></tr></thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a._id} style={{ opacity: a.isActive ? 1 : 0.55 }}>
                  <td style={td}><strong>{a.label}</strong>{a.unit ? ` (${a.unit})` : ''}<div style={{ fontSize: 11, color: '#64748b' }}>{a.code}{a.isActive ? '' : ' · archived'}</div></td>
                  <td style={td}>{TYPE_LABEL[a.fieldType]}</td>
                  <td style={td}>{HAS_OPTIONS.includes(a.fieldType) ? (a.options || []).filter((o) => o.isActive !== false).map((o) => o.label).slice(0, 6).join(', ') + ((a.options || []).length > 6 ? '…' : '') : '—'}</td>
                  <td style={td}>{a.mappedCategories ? `${a.mappedCategories} categor${a.mappedCategories === 1 ? 'y' : 'ies'}` : 'Not used yet'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => startEdit(a)} style={btn(false)}>Edit</button>
                    <button type="button" onClick={() => toggleArchive(a)} style={{ ...btn(false), marginLeft: 6 }}>{a.isActive ? 'Archive' : 'Restore'}</button>
                  </td>
                </tr>
              ))}
              {!visible.length ? <tr><td style={td} colSpan={5}>No attributes yet. Create one, or run the starter set (backend: npm run seed:catalog-attributes).</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Change log ---------------- */}
      <section style={box}>
        <h3 style={{ marginTop: 0 }}>3. Recent changes</h3>
        {audit.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {audit.map((row) => <li key={row._id}>{new Date(row.createdAt).toLocaleString('en-IN')} · {row.actorName || 'Admin'} · {row.summary || row.action}</li>)}
          </ul>
        ) : <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>No configuration changes yet.</p>}
      </section>
    </div>
  );
}
