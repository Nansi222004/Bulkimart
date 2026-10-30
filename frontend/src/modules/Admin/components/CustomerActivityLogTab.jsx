import ModalPortal from '../../../components/ModalPortal';
import React, { useState, useEffect, useMemo } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Customer Activity & Security Audit Log — a REAL feed (wallet transactions
 * + profile/address updates, off admin.controller.js::getCustomerActivityLog).
 */

const ACTION_LABELS = {
  wallet_credit: 'Wallet Credit',
  wallet_debit: 'Wallet Debit',
  account_update: 'Profile Updated',
};

// Bug #195 fix: meaningful status configurations based on event type
const STATUS_CONFIG = {
  wallet_credit: { label: 'Credited', bg: '#dcfce7', color: '#15803d' },
  wallet_debit: { label: 'Debited', bg: '#e0f2fe', color: '#0369a1' },
  account_update: { label: 'Updated', bg: '#ede9fe', color: '#6d28d9' },
};

/** Minimal, dependency-free CSV — quotes only the cells that need it. */
const toCsv = (rows, columns) => {
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => escapeCell(c.value(r))).join(','));
  return [header, ...lines].join('\r\n');
};

const downloadCsv = (filename, csvContent) => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const CustomerActivityLogTab = () => {
  const {
    activityLogs, activityLogsLoading, fetchCustomerActivityLog,
    consumerLocations, fetchConsumerLocations, triggerToast,
  } = useAdmin();

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [stateFilter, setStateFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState('All');
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => { fetchConsumerLocations(); }, [fetchConsumerLocations]);
  useEffect(() => { setDistrictFilter('All'); }, [stateFilter]);

  useEffect(() => {
    fetchCustomerActivityLog({
      state: stateFilter === 'All' ? undefined : stateFilter,
      district: districtFilter === 'All' ? undefined : districtFilter,
    });
  }, [stateFilter, districtFilter, fetchCustomerActivityLog]);

  // Bug #196 fix: if no state is selected, gather all known districts across all states
  // so the dropdown is always clickable and functional.
  const allDistricts = useMemo(() => {
    const set = new Set();
    Object.values(consumerLocations.districtsByState || {}).forEach((arr) => {
      (arr || []).forEach((d) => set.add(d));
    });
    return Array.from(set).sort();
  }, [consumerLocations.districtsByState]);

  const districtOptions = stateFilter === 'All'
    ? allDistricts
    : (consumerLocations.districtsByState[stateFilter] || []);

  const rows = useMemo(() => activityLogs.map((a, i) => {
    const statusCfg = STATUS_CONFIG[a.type] || { label: 'Completed', bg: '#f1f5f9', color: '#475569' };
    return {
      id: `EVT-${String(i + 1).padStart(4, '0')}`,
      userName: a.userName || a.userPhone || 'Buyer',
      userPhone: a.userPhone || '—',
      actionKey: a.type,
      action: ACTION_LABELS[a.type] || 'Profile Updated',
      status: statusCfg.label,
      statusBg: statusCfg.bg,
      statusColor: statusCfg.color,
      description: a.description || '—',
      amount: a.amount,
      device: 'Not tracked',
      timestampLabel: a.timestamp
        ? new Date(a.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—',
      location: a.location || 'Not tracked',
    };
  }), [activityLogs]);

  const filteredRows = rows.filter((r) => {
    const matchesSearch = !search || `${r.userName} ${r.userPhone}`.toLowerCase().includes(search.toLowerCase());
    const matchesAction = actionFilter === 'All' || r.actionKey === actionFilter;
    return matchesSearch && matchesAction;
  });

  const handleExportCsv = () => {
    if (filteredRows.length === 0) {
      triggerToast('Nothing to export — no matching records.');
      return;
    }
    const csv = toCsv(filteredRows, [
      { label: 'Event ID', value: (r) => r.id },
      { label: 'Customer Name', value: (r) => r.userName },
      { label: 'Phone', value: (r) => r.userPhone },
      { label: 'Action', value: (r) => r.action },
      { label: 'Description', value: (r) => r.description },
      { label: 'Amount', value: (r) => r.amount ?? '' },
      { label: 'Device / IP', value: (r) => r.device },
      { label: 'Timestamp', value: (r) => r.timestampLabel },
      { label: 'Location', value: (r) => r.location },
      { label: 'Status', value: (r) => r.status },
    ]);
    downloadCsv(`customer-activity-log-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    triggerToast(`Exported ${filteredRows.length} record(s) to CSV.`);
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>
              Customer Activity & Security Audit Log
            </h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {filteredRows.length} of {rows.length} Records
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Wallet transactions and profile/address updates across buyer accounts. Location is each buyer's
            saved default address — Device/IP has no capture path in this app yet, so it reads as not tracked.
          </p>
        </div>

        <button
          className="sa-btn-primary"
          style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
          onClick={handleExportCsv}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: '1 1 260px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Search by customer name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select className="sa-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="All">All Actions</option>
          <option value="wallet_credit">Wallet Credit</option>
          <option value="wallet_debit">Wallet Debit</option>
          <option value="account_update">Profile Updated</option>
        </select>

        <select className="sa-select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          <option value="All">All States</option>
          {consumerLocations.states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Bug #196 fix: always clickable, shows All Cities instead of unclickable disabled state */}
        <select
          className="sa-select"
          value={districtFilter}
          onChange={(e) => setDistrictFilter(e.target.value)}
        >
          <option value="All">All Cities</option>
          {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Table */}
      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Event ID', 'Customer Name', 'Timestamp', 'Location', 'Status'].map((col) => (
                <th key={col} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {col}
                </th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {activityLogsLoading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>Loading…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>No matching records found.</td></tr>
            ) : (
              filteredRows.map((row, idx) => {
                return (
                  <tr key={row.id} style={{ borderBottom: idx === filteredRows.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sa-text-secondary)' }}>{row.id}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--sa-text-primary)' }}>
                      {row.userName}
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sa-text-muted)' }}>{row.userPhone}</div>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)', fontWeight: 600 }}>{row.timestampLabel}</td>
                    <td style={{ padding: '12px 16px', color: row.location === 'Not tracked' ? 'var(--sa-text-muted)' : 'var(--sa-text-secondary)', fontStyle: row.location === 'Not tracked' ? 'italic' : 'normal', fontWeight: 600 }}>
                      {row.location}
                    </td>
                    {/* Bug #195 fix: dynamic status pill based on event type */}
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        className="sa-status-pill"
                        style={{
                          backgroundColor: row.statusBg,
                          color: row.statusColor,
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => setSelectedRow(row)}>
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedRow && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 480 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">Activity Event — {selectedRow.id}</h3>
              <button className="admin-modal-close" onClick={() => setSelectedRow(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Customer', selectedRow.userName],
                ['Phone', selectedRow.userPhone],
                ['Action', selectedRow.action],
                ['Status', selectedRow.status],
                ['Description', selectedRow.description],
                ...(selectedRow.amount != null ? [['Amount', `₹${selectedRow.amount}`]] : []),
                ['Device / IP', selectedRow.device],
                ['Timestamp', selectedRow.timestampLabel],
                ['Location', selectedRow.location],
              ].map(([label, value]) => (
                <div key={label} className="admin-item-row" style={{ padding: '4px 0' }}>
                  <span className="admin-item-label">{label}</span>
                  <span className="admin-item-value" style={{ fontWeight: 700 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default CustomerActivityLogTab;
