import React, { useEffect, useState } from 'react';
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

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet('/return-policies');
      setRows(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load return policies');
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
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0) {
      triggerToast('Enter a whole number of 0 or more days.');
      return;
    }
    try {
      await adminPatch(`/return-policies/${categoryId}`, { returnWindowDays: value, isActive: true });
      triggerToast('Saved — this applies to new orders only; existing orders keep their original policy.');
      setEditingId(null);
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not save');
    }
  };

  const toggleActive = async (row) => {
    try {
      await adminPatch(`/return-policies/${row.categoryId}`, {
        returnWindowDays: row.policy?.returnWindowDays || 0,
        isActive: !row.policy?.isActive,
      });
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Return Window Settings</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
          Per header category. New return-window settings apply to future orders only — existing orders keep their original return policy.
        </p>
      </div>

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
                  ) : row.policy ? `${row.policy.returnWindowDays} day(s)` : 'Not configured (non-returnable)'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`sa-status-pill ${row.policy?.isActive ? 'approved' : 'rejected'}`}>{row.policy?.isActive ? 'Active' : row.policy ? 'Inactive' : 'None'}</span>
                </td>
                <td style={{ padding: '12px 16px' }}>{row.policy?.updatedAt ? new Date(row.policy.updatedAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editingId === row.categoryId ? (
                    <>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => save(row.categoryId)}>Save</button>
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
