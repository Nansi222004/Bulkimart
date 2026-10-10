import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';
import { apiUrl } from '../../../utils/api';

const money = (n) => '₹' + Math.round(Number(n) || 0);

export const DonationSettingsTab = () => {
  const { triggerToast } = useAdmin();

  const [viewMode, setViewMode] = useState('transactions'); // 'transactions' | 'config'

  // ---- Settings State ----
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [current, setCurrent] = useState(null);

  const [isEnabled, setIsEnabled] = useState(true);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [knowMoreText, setKnowMoreText] = useState('');
  const [options, setOptions] = useState([10, 20, 50, 80, 100]);
  const [newChip, setNewChip] = useState('');
  const [allowCustom, setAllowCustom] = useState(true);
  const [minCustomAmount, setMinCustomAmount] = useState('1');
  const [maxCustomAmount, setMaxCustomAmount] = useState('10000');

  const [previewChip, setPreviewChip] = useState(null);
  const [showKnowMore, setShowKnowMore] = useState(false);

  // ---- Transactions & Dashboard State ----
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overview, setOverview] = useState(null);

  const [loadingTxns, setLoadingTxns] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTxns, setTotalTxns] = useState(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  const [selectedTxn, setSelectedTxn] = useState(null);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [disburseRef, setDisburseRef] = useState('');

  // Load Config
  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await authGet('/api/admin/donation-setting');
      const c = res.data?.current || null;
      setCurrent(c);
      if (c) {
        setIsEnabled(Boolean(c.isEnabled));
        setTitle(c.title || '');
        setSubtitle(c.subtitle || '');
        setKnowMoreText(c.knowMoreText || '');
        setOptions(Array.isArray(c.options) ? c.options : [10, 20, 50, 80, 100]);
        setAllowCustom(Boolean(c.allowCustom));
        setMinCustomAmount(String(c.minCustomAmount ?? 1));
        setMaxCustomAmount(String(c.maxCustomAmount ?? 10000));
      }
    } catch (err) {
      triggerToast(err.message || 'Could not load donation settings');
    } finally {
      setLoadingConfig(false);
    }
  };

  // Load Dashboard Overview
  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await authGet('/api/admin/donations/overview');
      setOverview(res.data || null);
    } catch (err) {
      // fallback if overview fails
    } finally {
      setLoadingOverview(false);
    }
  };

  // Load Transactions Table
  const loadTransactions = async (pageNum = page) => {
    setLoadingTxns(true);
    try {
      const params = new URLSearchParams();
      params.append('page', pageNum);
      params.append('limit', 15);
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      if (methodFilter) params.append('paymentMethod', methodFilter);

      const res = await authGet(`/api/admin/donations/transactions?${params.toString()}`);
      setTransactions(res.data || []);
      if (res.meta) {
        setPage(res.meta.page || 1);
        setTotalPages(res.meta.pages || 1);
        setTotalTxns(res.meta.total || 0);
      }
    } catch (err) {
      triggerToast(err.message || 'Could not load donation transactions');
    } finally {
      setLoadingTxns(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadOverview();
    loadTransactions(1);
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadTransactions(1);
  };

  const addChip = () => {
    const n = Number(newChip);
    if (!Number.isFinite(n) || n <= 0) return;
    if (options.includes(n)) { setNewChip(''); return; }
    setOptions((prev) => [...prev, n].sort((a, b) => a - b));
    setNewChip('');
  };

  const removeChip = (n) => setOptions((prev) => prev.filter((o) => o !== n));

  const saveConfig = async () => {
    if (!options.length) { triggerToast('Add at least one preset amount.'); return; }
    setSavingConfig(true);
    try {
      await authPost('/api/admin/donation-setting', {
        isEnabled, title, subtitle, knowMoreText, options,
        allowCustom, minCustomAmount: Number(minCustomAmount), maxCustomAmount: Number(maxCustomAmount),
      });
      triggerToast('Donation setting saved successfully.');
      await loadConfig();
    } catch (err) {
      triggerToast(err.message || 'Could not save donation setting');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleAddAdminNote = async () => {
    if (!selectedTxn || !newNote.trim()) return;
    if (newNote.trim().length < 3) {
      triggerToast('Admin note must be at least 3 characters long');
      return;
    }
    setSavingNote(true);
    try {
      const res = await authPost(`/api/admin/donations/transactions/${selectedTxn._id}/notes`, { note: newNote.trim() });
      setSelectedTxn(res.data);
      setNewNote('');
      triggerToast('Internal admin note saved.');
      loadTransactions(page);
    } catch (err) {
      triggerToast(err.message || 'Could not add admin note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    if (!selectedTxn) return;
    setUpdatingStatus(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(apiUrl(`/api/admin/donations/transactions/${selectedTxn._id}/status`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status: newStatus,
          reference: disburseRef,
          organizationName: 'Bulkimart Social Work Fund',
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Status update failed');
      setSelectedTxn(body.data);
      triggerToast(`Donation status updated to ${newStatus}`);
      loadTransactions(page);
      loadOverview();
    } catch (err) {
      triggerToast(err.message || 'Could not update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleExportCSV = () => {
    const token = localStorage.getItem('adminToken');
    window.open(apiUrl(`/api/admin/donations/export?token=${encodeURIComponent(token || '')}`), '_blank');
  };

  const dirtyConfig = current && (
    Boolean(current.isEnabled) !== isEnabled
    || (current.title || '') !== title
    || (current.subtitle || '') !== subtitle
    || (current.knowMoreText || '') !== knowMoreText
    || JSON.stringify(current.options || []) !== JSON.stringify(options)
    || Boolean(current.allowCustom) !== allowCustom
    || String(current.minCustomAmount ?? 1) !== minCustomAmount
    || String(current.maxCustomAmount ?? 10000) !== maxCustomAmount
  );

  const labelStyle = { fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' };
  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Header & Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '16px 20px', borderRadius: 14, border: '1.5px solid #e2e8f0' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Donations & Social Impact</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
            Audit, track collections, and configure checkout donation prompts.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setViewMode('transactions')}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
              background: viewMode === 'transactions' ? '#0f172a' : '#f1f5f9',
              color: viewMode === 'transactions' ? '#fff' : '#475569',
            }}
          >
            📊 Transactions & Audit
          </button>
          <button
            type="button"
            onClick={() => setViewMode('config')}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
              background: viewMode === 'config' ? '#0f172a' : '#f1f5f9',
              color: viewMode === 'config' ? '#fff' : '#475569',
            }}
          >
            ⚙️ Prompt Settings
          </button>
        </div>
      </div>

      {viewMode === 'transactions' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Dashboard Aggregated KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <p style={labelStyle}>Total Collected</p>
              <h2 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, color: '#16a34a' }}>
                {money(overview?.totalCollected || 0)}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>All time successful contributions</p>
            </div>
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <p style={labelStyle}>Today's Donations</p>
              <h2 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, color: '#0284c7' }}>
                {money(overview?.todayCollected || 0)}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>Collected since midnight</p>
            </div>
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <p style={labelStyle}>This Month</p>
              <h2 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, color: '#8b5cf6' }}>
                {money(overview?.monthCollected || 0)}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>Current calendar month</p>
            </div>
            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <p style={labelStyle}>Total Transactions</p>
              <h2 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
                {overview?.totalTransactions || 0}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94a3b8' }}>
                Disbursed: {money(overview?.disbursedAmount || 0)}
              </p>
            </div>
          </div>

          {/* Filters & Export Toolbar */}
          <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 260 }}>
              <input
                style={inputStyle}
                placeholder="Search Donation ID, User, Comment..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                Search
              </button>
            </form>

            <select
              style={{ ...inputStyle, width: 'auto' }}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); }}
            >
              <option value="">All Statuses</option>
              <option value="COLLECTED">COLLECTED</option>
              <option value="DISBURSED">DISBURSED</option>
              <option value="REFUNDED">REFUNDED</option>
            </select>

            <select
              style={{ ...inputStyle, width: 'auto' }}
              value={methodFilter}
              onChange={(e) => { setMethodFilter(e.target.value); }}
            >
              <option value="">All Payment Methods</option>
              <option value="wallet">Wallet</option>
              <option value="online">PhonePe / Online</option>
              <option value="cod">Cash on Delivery</option>
            </select>

            <button
              type="button"
              onClick={handleExportCSV}
              style={{ padding: '9px 16px', borderRadius: 8, border: '1.5px solid #16a34a', background: '#f0fdf4', color: '#166534', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
            >
              📥 Export CSV
            </button>
          </div>

          {/* Transactions Table */}
          <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <th style={{ padding: '12px 16px' }}>Transaction ID</th>
                  <th style={{ padding: '12px 16px' }}>User</th>
                  <th style={{ padding: '12px 16px' }}>Order</th>
                  <th style={{ padding: '12px 16px' }}>Amount</th>
                  <th style={{ padding: '12px 16px' }}>Method</th>
                  <th style={{ padding: '12px 16px' }}>Customer Comment</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loadingTxns ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading transactions…</td>
                  </tr>
                ) : !transactions.length ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No donation transactions found.</td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>{t.transactionId}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{t.userId?.name || 'Customer'}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{t.userId?.email || t.userId?.phone || ''}</div>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0284c7' }}>
                        {t.orderId?.orderNo || 'Order'}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 900, color: '#16a34a' }}>{money(t.amount)}</td>
                      <td style={{ padding: '12px 16px', textTransform: 'capitalize' }}>{t.paymentMethod || 'online'}</td>
                      <td style={{ padding: '12px 16px', color: t.customerComment ? '#334155' : '#94a3b8', fontStyle: t.customerComment ? 'normal' : 'italic', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.customerComment || 'None'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800,
                          background: t.status === 'COLLECTED' ? '#dcfce7' : t.status === 'DISBURSED' ? '#e0f2fe' : '#fee2e2',
                          color: t.status === 'COLLECTED' ? '#15803d' : t.status === 'DISBURSED' ? '#0369a1' : '#b91c1c',
                        }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 11.5 }}>
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedTxn(t)}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                        >
                          Audit & Notes
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>Showing page {page} of {totalPages} ({totalTxns} total)</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    disabled={page <= 1}
                    onClick={() => loadTransactions(page - 1)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => loadTransactions(page + 1)}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Configuration & Live Preview View */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Checkout Donation Config</h2>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: isEnabled ? '#16a34a' : '#94a3b8' }}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)}
                  style={{ width: 36, height: 20, cursor: 'pointer', accentColor: '#16a34a' }} />
              </label>
            </div>

            <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Section Title</label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Donate & Support Transformative Social Work In India" />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>Subtitle</label>
                <input style={inputStyle} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="A short line under the title" />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={labelStyle}>"Know More" Explanation</label>
                <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={4} value={knowMoreText}
                  onChange={(e) => setKnowMoreText(e.target.value)} placeholder="Explain the social impact shown in the Know More modal." />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={labelStyle}>Preset Contribution Chips</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {options.map((n) => (
                    <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: '#f0fdf4', border: '1.5px solid #bbf7d0', fontSize: 12.5, fontWeight: 800, color: '#166534' }}>
                      {money(n)}
                      <button type="button" onClick={() => removeChip(n)} aria-label={`Remove ${money(n)}`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534', fontWeight: 900, padding: 0, lineHeight: 1 }}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number" min="1" value={newChip} onChange={(e) => setNewChip(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(); } }}
                    placeholder="Add amount, e.g. 25" style={{ ...inputStyle, maxWidth: 160 }}
                  />
                  <button type="button" onClick={addChip}
                    style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                    Add Chip
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                  <input type="checkbox" checked={allowCustom} onChange={(e) => setAllowCustom(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#16a34a' }} />
                  Allow shoppers to enter a custom amount
                </label>
                {allowCustom && (
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <label style={labelStyle}>Min Custom Amount</label>
                      <input style={inputStyle} type="number" min="1" value={minCustomAmount} onChange={(e) => setMinCustomAmount(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <label style={labelStyle}>Max Custom Amount</label>
                      <input style={inputStyle} type="number" min="1" value={maxCustomAmount} onChange={(e) => setMaxCustomAmount(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button" onClick={saveConfig} disabled={savingConfig || !dirtyConfig}
                style={{
                  padding: '12px 0', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 900, cursor: (savingConfig || !dirtyConfig) ? 'not-allowed' : 'pointer',
                  background: (savingConfig || !dirtyConfig) ? '#e2e8f0' : '#16a34a', color: (savingConfig || !dirtyConfig) ? '#94a3b8' : '#fff',
                }}
              >
                {savingConfig ? 'Saving…' : 'Save Config Changes'}
              </button>
            </div>
          </div>

          {/* Live Mobile Preview */}
          <div style={{ position: 'sticky', top: 20 }}>
            <p style={{ ...labelStyle, marginBottom: 8 }}>Live Customer Checkout Preview</p>
            <div style={{ background: '#0f172a', borderRadius: 24, padding: 10 }}>
              <div style={{ background: '#f8fafc', borderRadius: 16, padding: 14, minHeight: 240 }}>
                {!isEnabled ? (
                  <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '30px 0' }}>
                    Donation prompt is disabled — nothing shows at checkout.
                  </p>
                ) : (
                  <div style={{ background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>❤️</span>
                      <div>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0f172a', lineHeight: 1.35 }}>
                          {title || 'Donate & Support Transformative Social Work In India'}
                        </p>
                        {subtitle && <p style={{ margin: '2px 0 0', fontSize: 10.5, color: '#64748b' }}>{subtitle}</p>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {options.map((n) => (
                        <button
                          key={n} type="button" onClick={() => setPreviewChip((p) => (p === n ? null : n))}
                          style={{
                            padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                            border: previewChip === n ? '1.5px solid #16a34a' : '1.5px solid #e2e8f0',
                            background: previewChip === n ? '#16a34a' : '#fff',
                            color: previewChip === n ? '#fff' : '#0f172a',
                          }}
                        >
                          {money(n)}
                        </button>
                      ))}
                    </div>

                    <button type="button" onClick={() => setShowKnowMore(true)}
                      style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#16a34a', cursor: 'pointer' }}>
                      Know More →
                    </button>
                  </div>
                )}

                {isEnabled && previewChip && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700, color: '#16a34a' }}>
                    <span>Social Work Contribution</span>
                    <span>+{money(previewChip)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Audit Modal */}
      {selectedTxn && (
        <div
          onClick={() => setSelectedTxn(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', pb: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>{selectedTxn.transactionId}</h3>
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#64748b' }}>Created {new Date(selectedTxn.createdAt).toLocaleString()}</p>
              </div>
              <button
                type="button" onClick={() => setSelectedTxn(null)}
                style={{ background: 'none', border: 'none', fontSize: 18, fontWeight: 900, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: '#f8fafc', padding: 14, borderRadius: 10 }}>
              <div>
                <span style={labelStyle}>Customer</span>
                <p style={{ margin: '2px 0 0', fontWeight: 800, fontSize: 13, color: '#0f172a' }}>{selectedTxn.userId?.name || 'Customer'}</p>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{selectedTxn.userId?.email || selectedTxn.userId?.phone || ''}</p>
              </div>
              <div>
                <span style={labelStyle}>Donation Amount</span>
                <p style={{ margin: '2px 0 0', fontWeight: 900, fontSize: 16, color: '#16a34a' }}>{money(selectedTxn.amount)}</p>
                <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Method: {selectedTxn.paymentMethod || 'online'}</p>
              </div>
            </div>

            {/* Customer Comment (Read Only) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={labelStyle}>Customer Message / Comment</span>
              <div style={{ padding: '10px 12px', background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, color: selectedTxn.customerComment ? '#0f172a' : '#94a3b8', fontStyle: selectedTxn.customerComment ? 'normal' : 'italic' }}>
                {selectedTxn.customerComment || 'No comment provided by customer.'}
              </div>
            </div>

            {/* Status Management */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#f0fdf4', border: '1.5px solid #bbf7d0', padding: 14, borderRadius: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>Financial Status: {selectedTxn.status}</span>
              {selectedTxn.status === 'COLLECTED' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 12 }}
                    placeholder="Disbursement Ref (e.g. NGO-TRANSFER-101)"
                    value={disburseRef}
                    onChange={(e) => setDisburseRef(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus('DISBURSED')}
                    style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#0284c7', color: '#fff', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' }}
                  >
                    Mark Disbursed
                  </button>
                  <button
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus('REFUNDED')}
                    style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 800, fontSize: 11.5, cursor: 'pointer' }}
                  >
                    Mark Refunded
                  </button>
                </div>
              )}
            </div>

            {/* Internal Admin Audit Notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={labelStyle}>Immutable Admin Audit Notes ({selectedTxn.adminNotes?.length || 0})</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                {!selectedTxn.adminNotes?.length ? (
                  <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No internal admin notes recorded yet.</p>
                ) : (
                  selectedTxn.adminNotes.map((note, idx) => (
                    <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: 10.5, fontWeight: 700, marginBottom: 2 }}>
                        <span>{note.adminId?.name || 'Admin'} ({note.adminId?.email || 'System'})</span>
                        <span>{new Date(note.createdAt).toLocaleString()}</span>
                      </div>
                      <p style={{ margin: 0, color: '#0f172a' }}>{note.note}</p>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="Add internal note..."
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddAdminNote(); }}
                />
                <button
                  type="button"
                  disabled={savingNote || !newNote.trim()}
                  onClick={handleAddAdminNote}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                >
                  {savingNote ? 'Saving...' : 'Add Note'}
                </button>
              </div>
            </div>

            <button
              type="button" onClick={() => setSelectedTxn(null)}
              style={{ marginTop: 8, padding: '10px 0', borderRadius: 8, border: 'none', background: '#f1f5f9', color: '#475569', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}
            >
              Close Detail View
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DonationSettingsTab;
