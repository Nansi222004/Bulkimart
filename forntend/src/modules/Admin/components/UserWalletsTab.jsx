import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';

const UserWalletsTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview' | 'users' | 'transactions'

  // Overview state
  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // User Wallets list state
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userPagination, setUserPagination] = useState({ page: 1, limit: 15, totalPages: 1, total: 0 });

  // Single User Detail / Modal state
  const [selectedUser, setSelectedUser] = useState(null);
  const [userTxns, setUserTxns] = useState([]);
  const [loadingUserTxns, setLoadingUserTxns] = useState(false);

  // Admin Adjustment Modal state
  const [adjustmentModal, setAdjustmentModal] = useState({ open: false, type: 'credit', user: null });
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [submittingAdj, setSubmittingAdj] = useState(false);
  const [adjMessage, setAdjMessage] = useState(null);

  // All Transactions list state
  const [allTxns, setAllTxns] = useState([]);
  const [txnSearch, setTxnSearch] = useState('');
  const [txnTypeFilter, setTxnTypeFilter] = useState('');
  const [loadingAllTxns, setLoadingAllTxns] = useState(false);
  const [txnPagination, setTxnPagination] = useState({ page: 1, limit: 20, totalPages: 1, total: 0 });

  const getAuthHeader = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + localStorage.getItem('adminToken')
  });

  const getTxnBadgeProps = (t) => {
    const typeStr = String(t.type || t.direction || '').toLowerCase();
    if (typeStr.includes('admin_debit')) {
      return { label: '🛡️ Admin Debit', bg: '#fff7ed', color: '#c2410c', border: '#ffedd5' };
    }
    if (typeStr.includes('order_payment') || typeStr.includes('order')) {
      return { label: '🛒 User Order Purchase', bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' };
    }
    if (typeStr.includes('admin_credit')) {
      return { label: '🎁 Admin Credit', bg: '#ecfeff', color: '#0e7490', border: '#cffafe' };
    }
    if (typeStr.includes('topup')) {
      return { label: '💳 User Top-up', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' };
    }
    if (typeStr.includes('refund')) {
      return { label: '↩️ Order Refund', bg: '#f0fdfa', color: '#0f766e', border: '#ccfbf1' };
    }
    return { label: t.type || 'Transaction', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
  };

  // Load Admin Overview
  const fetchOverview = async () => {
    setLoadingOverview(true);
    try {
      const res = await fetch(apiUrl('/api/wallet/admin/overview'), { headers: getAuthHeader() });
      const body = await res.json();
      if (body.success && body.data) {
        setOverview(body.data);
      }
    } catch (err) {
      console.error('Failed to load wallet overview:', err);
    } finally {
      setLoadingOverview(false);
    }
  };

  // Load User Wallets List
  const fetchUserWallets = async (page = 1, search = userSearch) => {
    setLoadingUsers(true);
    try {
      const res = await fetch(apiUrl(`/api/wallet/admin/users?page=${page}&limit=15&search=${encodeURIComponent(search)}`), { headers: getAuthHeader() });
      const body = await res.json();
      if (body.success) {
        setUsers(body.data || []);
        const meta = body.meta || body.pagination || {};
        setUserPagination({
          page: meta.page || page,
          limit: meta.limit || 15,
          totalPages: meta.pages || meta.totalPages || 1,
          total: meta.total || (body.data || []).length
        });
      }
    } catch (err) {
      console.error('Failed to load user wallets:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Load Transactions for Selected User
  const fetchSelectedUserTxns = async (userId) => {
    setLoadingUserTxns(true);
    try {
      const res = await fetch(apiUrl(`/api/wallet/admin/users/${userId}`), { headers: getAuthHeader() });
      const body = await res.json();
      if (body.success && body.data) {
        setUserTxns(body.data.transactions || []);
      }
    } catch (err) {
      console.error('Failed to load user txns:', err);
    } finally {
      setLoadingUserTxns(false);
    }
  };

  // Load All Transactions
  const fetchAllTransactions = async (page = 1, search = txnSearch, type = txnTypeFilter) => {
    setLoadingAllTxns(true);
    try {
      let query = `/api/wallet/admin/transactions?page=${page}&limit=20`;
      if (search) query += `&search=${encodeURIComponent(search)}`;
      if (type) query += `&type=${encodeURIComponent(type)}`;
      const res = await fetch(apiUrl(query), { headers: getAuthHeader() });
      const body = await res.json();
      if (body.success) {
        setAllTxns(body.data || []);
        const meta = body.meta || body.pagination || {};
        setTxnPagination({
          page: meta.page || page,
          limit: meta.limit || 20,
          totalPages: meta.pages || meta.totalPages || 1,
          total: meta.total || (body.data || []).length
        });
      }
    } catch (err) {
      console.error('Failed to load all transactions:', err);
    } finally {
      setLoadingAllTxns(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'overview') fetchOverview();
    if (activeSubTab === 'users') fetchUserWallets();
    if (activeSubTab === 'transactions') fetchAllTransactions();
  }, [activeSubTab]);

  const handleOpenUserDetail = (u) => {
    setSelectedUser(u);
    fetchSelectedUserTxns(u._id);
  };

  const handleOpenAdjustmentModal = (user, type) => {
    setAdjustmentModal({ open: true, type, user });
    setAdjAmount('');
    setAdjReason('');
    setAdjMessage(null);
  };

  const handlePerformAdjustment = async (e) => {
    e.preventDefault();
    const { user, type } = adjustmentModal;
    if (!user || !adjAmount || !adjReason || adjReason.trim().length < 5) {
      setAdjMessage({ type: 'error', text: 'A detailed reason (at least 5 characters) is required for audit logging.' });
      return;
    }
    const numAmt = parseFloat(adjAmount);
    if (isNaN(numAmt) || numAmt <= 0) {
      setAdjMessage({ type: 'error', text: 'Please enter a valid positive amount.' });
      return;
    }

    setSubmittingAdj(true);
    setAdjMessage(null);
    try {
      const endpoint = type === 'credit'
        ? `/api/wallet/admin/users/${user._id}/credit`
        : `/api/wallet/admin/users/${user._id}/debit`;

      const res = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({ amount: numAmt, reason: adjReason })
      });
      const body = await res.json();

      if (body.success) {
        const newBal = Number(body.data?.balance ?? body.data?.walletBalance ?? 0);
        setAdjMessage({ type: 'success', text: `Wallet ${type === 'credit' ? 'credited' : 'debited'} successfully! New Balance: ₹${newBal.toFixed(2)}` });
        setTimeout(() => {
          setAdjustmentModal({ open: false, type: 'credit', user: null });
          if (selectedUser?._id === user._id) {
            setSelectedUser({
              ...selectedUser,
              balance: newBal,
              wallet: { ...selectedUser.wallet, balance: newBal }
            });
            fetchSelectedUserTxns(user._id);
          }
          fetchUserWallets(userPagination.page);
          fetchOverview();
        }, 1200);
      } else {
        setAdjMessage({ type: 'error', text: body.message || 'Adjustment failed.' });
      }
    } catch (err) {
      setAdjMessage({ type: 'error', text: 'Network error performing adjustment.' });
    } finally {
      setSubmittingAdj(false);
    }
  };

  return (
    <div style={{ padding: '24px', fontFamily: "'Outfit', sans-serif", color: '#0f172a' }}>
      
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
        background: 'linear-gradient(135deg, #1b7a37 0%, #15803d 100%)',
        padding: '24px',
        borderRadius: '16px',
        color: '#ffffff',
        boxShadow: '0 4px 14px rgba(27, 122, 55, 0.2)'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#ffffff' }}>💰 Real Money Wallet System</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#dcfce7' }}>
            Manage customer wallet balances, view permanent audit ledgers, and perform controlled credit/debit adjustments.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => { fetchOverview(); fetchUserWallets(); }}
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: '700',
              cursor: 'pointer',
              fontSize: '13px'
            }}
          >
            🔄 Refresh Data
          </button>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '2px solid #e2e8f0', marginBottom: '24px' }}>
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'users', label: '👥 User Wallets' },
          { id: 'transactions', label: '📜 Transaction Ledger' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveSubTab(t.id)}
            style={{
              padding: '12px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeSubTab === t.id ? '3px solid #1b7a37' : '3px solid transparent',
              color: activeSubTab === t.id ? '#1b7a37' : '#64748b',
              fontWeight: activeSubTab === t.id ? '800' : '600',
              fontSize: '15px',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* SUB TAB 1: OVERVIEW */}
      {activeSubTab === 'overview' && (
        <div>
          {loadingOverview && !overview ? (
            <p style={{ color: '#64748b' }}>Loading wallet overview analytics...</p>
          ) : !overview ? (
            <p style={{ color: '#ef4444' }}>Unable to load overview statistics.</p>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>Total Users</span>
                  <h3 style={{ margin: '8px 0 0 0', fontSize: '26px', fontWeight: '900', color: '#0f172a' }}>
                    {overview.totalUsers?.toLocaleString('en-IN') || 0}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: '600', marginTop: '4px', display: 'block' }}>
                    {overview.usersWithWallet || 0} Active Wallets
                  </span>
                </div>

                <div style={{ border: '1.5px solid #bbf7d0', borderRadius: '14px', padding: '20px', boxShadow: '0 2px 8px rgba(22, 163, 74, 0.05)', backgroundColor: '#f0fdf4' }}>
                  <span style={{ fontSize: '12px', color: '#15803d', fontWeight: '800', textTransform: 'uppercase' }}>Total Wallet Balance</span>
                  <h3 style={{ margin: '8px 0 0 0', fontSize: '26px', fontWeight: '900', color: '#15803d' }}>
                    ₹{(overview.totalBalance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#166534', fontWeight: '600', marginTop: '4px', display: 'block' }}>
                    Active customer balance liability
                  </span>
                </div>

              </div>

              <h4 style={{ fontSize: '15px', fontWeight: '800', color: '#334155', marginBottom: '14px' }}>
                🔻 Debits Breakdown (User vs Admin)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                
                <div style={{ backgroundColor: '#ffffff', border: '1.5px solid #e0e7ff', borderRadius: '14px', padding: '20px', boxShadow: '0 2px 8px rgba(99, 102, 241, 0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#4338ca', fontWeight: '800', textTransform: 'uppercase' }}>🛒 User Order Purchases</span>
                    <span style={{ fontSize: '10.5px', background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '10px', fontWeight: '700' }}>User Debit</span>
                  </div>
                  <h3 style={{ margin: '10px 0 0 0', fontSize: '26px', fontWeight: '900', color: '#312e81' }}>
                    -₹{(overview.userDebits || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#6366f1', marginTop: '4px', display: 'block' }}>
                    Total spent by users buying products via Wallet
                  </span>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1.5px solid #ffedd5', borderRadius: '14px', padding: '20px', boxShadow: '0 2px 8px rgba(249, 115, 22, 0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#c2410c', fontWeight: '800', textTransform: 'uppercase' }}>🛡️ Admin Manual Debits</span>
                    <span style={{ fontSize: '10.5px', background: '#ffedd5', color: '#9a3412', padding: '2px 8px', borderRadius: '10px', fontWeight: '700' }}>Admin Action</span>
                  </div>
                  <h3 style={{ margin: '10px 0 0 0', fontSize: '26px', fontWeight: '900', color: '#9a3412' }}>
                    -₹{(overview.adminDebits || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#ea580c', marginTop: '4px', display: 'block' }}>
                    Total deducted manually by Admin (with audit reasons)
                  </span>
                </div>

              </div>

              <h4 style={{ fontSize: '15px', fontWeight: '800', color: '#334155', marginBottom: '14px' }}>
                🔺 Credits Breakdown (Top-ups, Refunds & Admin Credits)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                
                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px' }}>
                  <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: '800', textTransform: 'uppercase' }}>💳 User Top-ups (PhonePe)</span>
                  <h3 style={{ margin: '8px 0 0 0', fontSize: '22px', fontWeight: '900', color: '#15803d' }}>
                    +₹{(overview.userTopups || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>Added directly by customers</span>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px' }}>
                  <span style={{ fontSize: '12px', color: '#0891b2', fontWeight: '800', textTransform: 'uppercase' }}>🎁 Admin Manual Credits</span>
                  <h3 style={{ margin: '8px 0 0 0', fontSize: '22px', fontWeight: '900', color: '#0e7490' }}>
                    +₹{(overview.adminCredits || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>Added manually by Admin</span>
                </div>

                <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px' }}>
                  <span style={{ fontSize: '12px', color: '#0d9488', fontWeight: '800', textTransform: 'uppercase' }}>↩️ Order Refunds</span>
                  <h3 style={{ margin: '8px 0 0 0', fontSize: '22px', fontWeight: '900', color: '#0f766e' }}>
                    +₹{(overview.refundCredits || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>Refunds for cancelled/returned orders</span>
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB TAB 2: USER WALLETS */}
      {activeSubTab === 'users' && (
        <div>
          {/* Search bar */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <input
              type="text"
              placeholder="Search by User Name, Email, or Phone..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchUserWallets(1, userSearch); }}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                fontSize: '14px',
                outline: 'none'
              }}
            />
            <button
              onClick={() => fetchUserWallets(1, userSearch)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#1b7a37',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Search Users
            </button>
          </div>

          {/* Table */}
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontWeight: '700' }}>
                  <th style={{ padding: '14px 16px' }}>User Details</th>
                  <th style={{ padding: '14px 16px' }}>Phone / Contact</th>
                  <th style={{ padding: '14px 16px' }}>Wallet Balance</th>
                  <th style={{ padding: '14px 16px' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers ? (
                  <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading customer wallets...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No users found.</td></tr>
                ) : (
                  users.map(u => (
                    <tr key={u._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '14px 16px' }}>
                        <strong style={{ display: 'block', color: '#0f172a' }}>{u.name || 'Unnamed Customer'}</strong>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>{u.email || '—'}</span>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#334155' }}>
                        {u.phone || '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ fontSize: '15px', fontWeight: '800', color: '#16a34a' }}>
                          ₹{((u.balance ?? u.wallet?.balance) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '800',
                          padding: '3px 10px',
                          borderRadius: '20px',
                          backgroundColor: u.status === 'blocked' ? '#fef2f2' : '#f0fdf4',
                          color: u.status === 'blocked' ? '#ef4444' : '#16a34a',
                          border: `1px solid ${u.status === 'blocked' ? '#fecaca' : '#bbf7d0'}`
                        }}>
                          {(u.status || 'ACTIVE').toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => handleOpenUserDetail(u)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#f1f5f9',
                              color: '#334155',
                              border: '1px solid #cbd5e1',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: 'pointer'
                            }}
                          >
                            View Ledger
                          </button>
                          <button
                            onClick={() => handleOpenAdjustmentModal(u, 'credit')}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#f0fdf4',
                              color: '#15803d',
                              border: '1px solid #bbf7d0',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: '800',
                              cursor: 'pointer'
                            }}
                          >
                            + Credit
                          </button>
                          <button
                            onClick={() => handleOpenAdjustmentModal(u, 'debit')}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#fef2f2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: '800',
                              cursor: 'pointer'
                            }}
                          >
                            - Debit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {userPagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
              <button
                disabled={userPagination.page <= 1}
                onClick={() => fetchUserWallets(userPagination.page - 1)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}
              >
                Previous
              </button>
              <span style={{ alignSelf: 'center', fontSize: '13px', color: '#64748b' }}>
                Page {userPagination.page} of {userPagination.totalPages}
              </span>
              <button
                disabled={userPagination.page >= userPagination.totalPages}
                onClick={() => fetchUserWallets(userPagination.page + 1)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* SUB TAB 3: ALL TRANSACTIONS */}
      {activeSubTab === 'transactions' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <input
              type="text"
              placeholder="Search by Description or Reference ID..."
              value={txnSearch}
              onChange={(e) => setTxnSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchAllTransactions(1, txnSearch, txnTypeFilter); }}
              style={{
                flex: 2,
                padding: '12px 16px',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                fontSize: '14px',
                outline: 'none'
              }}
            />
            <select
              value={txnTypeFilter}
              onChange={(e) => {
                setTxnTypeFilter(e.target.value);
                fetchAllTransactions(1, txnSearch, e.target.value);
              }}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '1.5px solid #cbd5e1',
                borderRadius: '10px',
                fontSize: '14px',
                backgroundColor: '#ffffff'
              }}
            >
              <option value="">All Transaction Types</option>
              <option value="ORDER_PAYMENT">Order Payment</option>
              <option value="REFUND">Refund</option>
              <option value="ADMIN_CREDIT">Admin Credit</option>
              <option value="ADMIN_DEBIT">Admin Debit</option>
              <option value="CANCELLATION_REFUND">Cancellation Refund</option>
              <option value="RETURN_REFUND">Return Refund</option>
              <option value="WALLET_TOPUP">Wallet Top-up</option>
            </select>
            <button
              onClick={() => fetchAllTransactions(1, txnSearch, txnTypeFilter)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#1b7a37',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Filter Ledger
            </button>
          </div>

          {/* Transactions Table */}
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontWeight: '700' }}>
                  <th style={{ padding: '14px 16px' }}>Date & Txn ID</th>
                  <th style={{ padding: '14px 16px' }}>Customer</th>
                  <th style={{ padding: '14px 16px' }}>Type & Details</th>
                  <th style={{ padding: '14px 16px' }}>Direction & Amount</th>
                  <th style={{ padding: '14px 16px' }}>Balance (Before → After)</th>
                </tr>
              </thead>
              <tbody>
                {loadingAllTxns ? (
                  <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading transaction ledger...</td></tr>
                ) : allTxns.length === 0 ? (
                  <tr><td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No transactions recorded yet.</td></tr>
                ) : (
                  allTxns.map(t => {
                    const isCredit = t.direction === 'credit';
                    return (
                      <tr key={t._id || t.transactionId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <strong style={{ display: 'block', color: '#0f172a' }}>
                            {t.createdAt ? new Date(t.createdAt).toLocaleString('en-IN') : '—'}
                          </strong>
                          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                            {t.transactionId}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <strong style={{ display: 'block', color: '#0f172a' }}>{t.userId?.name || 'Customer'}</strong>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>{t.userId?.email || t.userId?.phone || '—'}</span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          {(() => {
                            const badge = getTxnBadgeProps(t);
                            return (
                              <span style={{
                                fontSize: '10.5px',
                                fontWeight: '800',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                backgroundColor: badge.bg,
                                color: badge.color,
                                border: `1px solid ${badge.border}`,
                                display: 'inline-block',
                                marginBottom: '4px'
                              }}>
                                {badge.label}
                              </span>
                            );
                          })()}
                          <span style={{ display: 'block', fontSize: '12px', color: '#334155' }}>
                            {t.description || '—'}
                          </span>
                          {t.createdBy && (
                            <span style={{ display: 'block', fontSize: '10.5px', color: '#94a3b8' }}>
                              By: {t.createdBy?.name || t.createdBy}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            fontSize: '15px',
                            fontWeight: '900',
                            color: isCredit ? '#16a34a' : '#ef4444'
                          }}>
                            {isCredit ? '+' : '-'} ₹{Number(t.amount || 0).toFixed(2)}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', color: '#475569' }}>
                          ₹{Number(t.balanceBefore || 0).toFixed(2)} → <strong style={{ color: '#0f172a' }}>₹{Number(t.balanceAfter || 0).toFixed(2)}</strong>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {txnPagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
              <button
                disabled={txnPagination.page <= 1}
                onClick={() => fetchAllTransactions(txnPagination.page - 1, txnSearch, txnTypeFilter)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}
              >
                Previous
              </button>
              <span style={{ alignSelf: 'center', fontSize: '13px', color: '#64748b' }}>
                Page {txnPagination.page} of {txnPagination.totalPages}
              </span>
              <button
                disabled={txnPagination.page >= txnPagination.totalPages}
                onClick={() => fetchAllTransactions(txnPagination.page + 1, txnSearch, txnTypeFilter)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', cursor: 'pointer' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* USER LEDGER MODAL */}
      {selectedUser && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            maxWidth: '700px',
            width: '100%',
            maxHeight: '85vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#f8fafc'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>
                  User Wallet Ledger: {selectedUser.name}
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {selectedUser.email || selectedUser.phone} • Current Balance: <strong style={{ color: '#16a34a' }}>₹{((selectedUser.balance ?? selectedUser.wallet?.balance) || 0).toFixed(2)}</strong>
                </span>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {loadingUserTxns ? (
                <p style={{ color: '#64748b', textAlign: 'center' }}>Loading user transaction history...</p>
              ) : userTxns.length === 0 ? (
                <p style={{ color: '#64748b', textAlign: 'center' }}>No wallet transactions found for this user.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {userTxns.map(t => {
                    const isCredit = t.direction === 'credit';
                    return (
                      <div key={t._id || t.transactionId} style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        backgroundColor: '#ffffff',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                            {(() => {
                              const badge = getTxnBadgeProps(t);
                              return (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: '800',
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  backgroundColor: badge.bg,
                                  color: badge.color,
                                  border: `1px solid ${badge.border}`
                                }}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                            <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#0f172a' }}>
                              {t.description || t.type}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {t.createdAt ? new Date(t.createdAt).toLocaleString('en-IN') : '—'} • Txn: {t.transactionId}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '15px', fontWeight: '900', color: isCredit ? '#16a34a' : '#ef4444' }}>
                            {isCredit ? '+' : '-'} ₹{Number(t.amount || 0).toFixed(2)}
                          </span>
                          <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>
                            Resulting Bal: ₹{Number(t.balanceAfter || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => handleOpenAdjustmentModal(selectedUser, 'credit')}
                style={{ padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}
              >
                + Admin Credit
              </button>
              <button
                onClick={() => handleOpenAdjustmentModal(selectedUser, 'debit')}
                style={{ padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}
              >
                - Admin Debit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTROLLED ADMIN CREDIT / DEBIT ADJUSTMENT MODAL */}
      {adjustmentModal.open && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            maxWidth: '500px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: adjustmentModal.type === 'credit' ? '#15803d' : '#b91c1c' }}>
                {adjustmentModal.type === 'credit' ? '➕ Controlled Admin Credit' : '➖ Controlled Admin Debit'}
              </h3>
              <button
                onClick={() => setAdjustmentModal({ open: false, type: 'credit', user: null })}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px', lineHeight: '1.5' }}>
              You are performing an audit-logged wallet adjustment for <strong>{adjustmentModal.user?.name}</strong> (Current Balance: <strong>₹{((adjustmentModal.user?.balance ?? adjustmentModal.user?.wallet?.balance) || 0).toFixed(2)}</strong>).
            </p>

            {adjMessage && (
              <div style={{
                padding: '12px 14px',
                borderRadius: '10px',
                fontSize: '13px',
                marginBottom: '16px',
                backgroundColor: adjMessage.type === 'success' ? '#f0fdf4' : '#fef2f2',
                color: adjMessage.type === 'success' ? '#15803d' : '#b91c1c',
                border: `1px solid ${adjMessage.type === 'success' ? '#bbf7d0' : '#fecaca'}`
              }}>
                {adjMessage.text}
              </div>
            )}

            <form onSubmit={handlePerformAdjustment} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                  Adjustment Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 500.00"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                  Audit Reason (Required) *
                </label>
                <textarea
                  placeholder="Provide explicit justification (e.g. Manual refund adjustment for Order #10045)..."
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    height: '80px',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  type="submit"
                  disabled={submittingAdj}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: adjustmentModal.type === 'credit' ? '#16a34a' : '#dc2626',
                    color: '#ffffff',
                    fontWeight: '800',
                    fontSize: '14px',
                    cursor: submittingAdj ? 'wait' : 'pointer'
                  }}
                >
                  {submittingAdj ? 'Processing...' : `Confirm ${adjustmentModal.type === 'credit' ? 'Credit' : 'Debit'}`}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentModal({ open: false, type: 'credit', user: null })}
                  style={{
                    padding: '12px 20px',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    fontWeight: '700',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default UserWalletsTab;
