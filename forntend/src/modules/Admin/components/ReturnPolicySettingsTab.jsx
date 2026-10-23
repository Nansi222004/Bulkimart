import React, { useEffect, useState, useRef } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPatch } from '../../../utils/adminApi';

/**
 * Admin — Return Window Settings, per HEADER category (Phase 2's backend,
 * previously configurable only via the raw API — this is its UI). Saving a
 * change only ever affects FUTURE orders; every already-placed order keeps
 * its own frozen snapshot (see models/Order.js's `returnPolicy`).
 */

export const ReturnPolicySettingsTab = () => {
  const { triggerToast } = useAdmin();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [days, setDays] = useState('');
  const [globalPolicy, setGlobalPolicy] = useState(null), [globalDays, setGlobalDays] = useState(''), [globalEnabled, setGlobalEnabled] = useState(false);
  const [maximumDays, setMaximumDays] = useState(undefined), [loadError, setLoadError] = useState(''), [saving, setSaving] = useState(false);
  const mutation = useRef(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await adminGet('/return-policies');
      setRows(res.data || []);
      setGlobalPolicy(res.meta?.globalPolicy || null);
      setGlobalDays(res.meta?.globalPolicy ? String(res.meta.globalPolicy.returnWindowDays) : '');
      setGlobalEnabled(res.meta?.globalPolicy?.isActive === true);
      setMaximumDays(res.meta?.maxWindowDays);
    } catch (err) {
      setLoadError(err.message || 'Could not load return policies');
      triggerToast(err.message || 'Could not load return policies', {type:'error'});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (row) => {
    setEditingId(row.categoryId);
    setDays(row.policy ? String(row.policy.returnWindowDays) : '');
  };

  const save = async (categoryId) => {
    if (mutation.current) return;
    const value = Number(days);
    if (!days.trim() || !Number.isSafeInteger(value) || value < 0 || (maximumDays !== undefined && value > maximumDays)) {
      triggerToast('Enter a whole number of 0 or more days.');
      return;
    }
    mutation.current = true; setSaving(true);
    try {
      await adminPatch(`/return-policies/${categoryId}`, { returnWindowDays: value, isActive: true });
      triggerToast('Saved — this applies to new orders only; existing orders keep their original policy.');
      setEditingId(null);
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not save', {type:'error'});
    } finally { mutation.current = false; setSaving(false); }
  };

  const saveGlobal = async () => {
    if (mutation.current || loading || loadError) return;
    const value = Number(globalDays);
    if (!globalDays.trim() || !Number.isSafeInteger(value) || value < 0 || (maximumDays !== undefined && value > maximumDays)) { triggerToast('Enter a valid whole number of days.'); return; }
    mutation.current = true; setSaving(true);
    try {
      const res = await adminPatch('/return-policies/global', { returnWindowDays: value, isActive: globalEnabled, version: globalPolicy?.version || 0 });
      triggerToast(res.message || 'Global return window saved. Existing orders are unchanged.');
      await load();
    } catch (err) { triggerToast(err.message || 'Could not save global return window', {type:'error'}); }
    finally { mutation.current = false; setSaving(false); }
  };

  const toggleActive = async (row) => {
    if (mutation.current) return;
    mutation.current = true; setSaving(true);
    try {
      await adminPatch(`/return-policies/${row.categoryId}`, {
        returnWindowDays: row.policy?.returnWindowDays || 0,
        isActive: !row.policy?.isActive,
      });
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update', {type:'error'});
    } finally { mutation.current = false; setSaving(false); }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Return Window Settings</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
          Configure a global default and category overrides. New return-window settings apply to future orders only — existing orders keep their original return policy.
        </p>
      </div>

      {loadError && <div role="alert"><p>{loadError}</p><button onClick={load}>Retry return settings</button></div>}
      <section aria-label="Global return window" style={{ background: '#fff', border: '1px solid var(--sa-border)', borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 8px' }}>Global return window</h3>
        <p style={{ fontSize: 13 }}>Used when a category has no return policy. Sellers must enable returns and can choose a product window up to this limit. A category with zero days or disabled returns stays non-returnable.</p>
        <fieldset disabled={loading || saving || !!loadError} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <label><input type="checkbox" checked={globalEnabled} onChange={e => setGlobalEnabled(e.target.checked)}/> Enable global default</label>
          <label>Maximum return window (days) <input aria-label="Global return window in days" type="number" min="0" max={maximumDays} step="1" value={globalDays} onChange={e => setGlobalDays(e.target.value)} style={{ width: 90, padding: 8, border: '1px solid #cbd5e1', borderRadius: 8 }}/></label>
          <button className="sa-action-btn" style={{ width: 'auto', minHeight: 40, padding: '8px 14px' }} onClick={saveGlobal}>{saving ? 'Saving…' : 'Save global return window'}</button>
        </fieldset>
        <p role="status" style={{ fontSize: 12 }}>{globalPolicy?.isActive ? `Saved global limit: ${globalPolicy.returnWindowDays} days.` : 'No active global return window.'} Existing orders keep their original terms.</p>
      </section>

      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Category', 'Channel', 'Return Window', 'Status', 'Last Updated'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No header categories found.</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.categoryId} style={{ borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{row.categoryName}</td>
                <td style={{ padding: '12px 16px' }}>{row.channel}</td>
                <td style={{ padding: '12px 16px' }}>
                  {editingId === row.categoryId ? (
                    <input type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1.5px solid var(--sa-border)' }} />
                  ) : row.policy ? `${row.policy.returnWindowDays} day(s)` : globalPolicy?.isActive && globalPolicy.returnWindowDays > 0 ? `Global default: up to ${globalPolicy.returnWindowDays} days (seller opt-in)` : 'Not configured (non-returnable)'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`sa-status-pill ${row.policy?.isActive ? 'approved' : 'rejected'}`}>{row.policy?.isActive ? 'Active' : row.policy ? 'Inactive' : globalPolicy?.isActive && globalPolicy.returnWindowDays > 0 ? 'Global default' : 'None'}</span>
                </td>
                <td style={{ padding: '12px 16px' }}>{row.policy?.updatedAt ? new Date(row.policy.updatedAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editingId === row.categoryId ? (
                    <>
                      <button disabled={saving} className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => save(row.categoryId)}>Save</button>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => setEditingId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => startEdit(row)}>Edit</button>
                      {row.policy && (
                        <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => toggleActive(row)}>
                          {row.policy.isActive ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReturnPolicySettingsTab;
