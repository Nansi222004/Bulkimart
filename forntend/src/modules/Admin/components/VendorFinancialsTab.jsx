import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../../../utils/api';

const prettyStatus = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export const VendorFinancialsTab = ({ defaultSubTab = 'sales' }) => {
  const [subTab, setSubTab] = useState(defaultSubTab); // 'sales' | 'earnings' | 'payouts'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, totalPages: 1, total: 0 });

  // Modal for settling payout
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [settleRef, setSettleRef] = useState('');
  const [settleMethod, setSettleMethod] = useState('IMPS');
  const [settleNotes, setSettleNotes] = useState('');
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState('');

  const getAuthHeader = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (localStorage.getItem('adminToken') || ''),
  });

  const fetchData = useCallback(async (page = 1, currentSubTab = subTab, currentStatus = statusFilter, currentSearch = search) => {
    setLoading(true);
    setError('');
    try {
      let endpoint = '';
      if (currentSubTab === 'sales') endpoint = '/api/admin/vendor-sales';
      else if (currentSubTab === 'earnings') endpoint = '/api/admin/vendor-earnings';
      else endpoint = '/api/admin/vendor-payouts';

      let query = `${endpoint}?page=${page}&limit=15`;
      if (currentStatus && currentStatus !== 'all') query += `&status=${encodeURIComponent(currentStatus)}`;
      if (currentSearch && currentSearch.trim()) query += `&search=${encodeURIComponent(currentSearch.trim())}`;

      const res = await fetch(apiUrl(query), { headers: getAuthHeader() });
      const body = await res.json();

      if (body.success) {
        const items = Array.isArray(body.data) ? body.data : (body.data?.rows || body.rows || []);
        const summaryObj = body.summary || body.meta?.summary || body.data?.summary || null;
        setData(items);
        setSummary(summaryObj);
        const meta = body.meta || body.pagination || {};
        setPagination({
          page: meta.page || page,
          limit: meta.limit || 15,
          totalPages: meta.pages || meta.totalPages || 1,
          total: meta.total || items.length,
        });
      } else {
        setError(body.message || 'Failed to fetch financial records');
      }
    } catch (err) {
      console.error('Error fetching vendor financials:', err);
      setError(err.message || 'Network error fetching data');
    } finally {
      setLoading(false);
    }
  }, [subTab, statusFilter, search]);

  useEffect(() => {
    setSubTab(defaultSubTab);
    setStatusFilter('all');
  }, [defaultSubTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData(1, subTab, statusFilter, search);
    }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [subTab, statusFilter, search, fetchData]);

  const handleSettleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPayout) return;
    setSettling(true);
    setSettleError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/vendor-payouts/${selectedPayout._id || selectedPayout.id}/settle`), {
        method: 'PATCH',
        headers: getAuthHeader(),
        body: JSON.stringify({
          transactionRef: settleRef || 'IMPS-' + Date.now(),
          paymentMethod: settleMethod,
          notes: settleNotes,
        }),
      });
      const body = await res.json();
      if (body.success) {
        setSettleModalOpen(false);
        setSelectedPayout(null);
        setSettleRef('');
        setSettleNotes('');
        fetchData(pagination.page);
      } else {
        setSettleError(body.message || 'Failed to settle payout');
      }
    } catch (err) {
      setSettleError(err.message || 'Network error settling payout');
    } finally {
      setSettling(false);
    }
  };

  const sortedItems = data;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Header Banner */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '24px', borderRadius: '16px', color: '#ffffff', boxShadow: '0 4px 14px rgba(0,0,0,0.12)'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, letterSpacing: '-0.5px' }}>
            {subTab === 'sales' && 'Vendor Sales Ledger'}
            {subTab === 'earnings' && 'Vendor Earnings & Admin Commission'}
            {subTab === 'payouts' && 'Vendor Payouts & Disbursals'}
          </h2>
          <p style={{ margin: '6px 0 0 0', opacity: 0.8, fontSize: '14px' }}>
            {subTab === 'sales' && 'Real-time sales revenue, commission deductions, and gross order volumes across all sellers.'}
            {subTab === 'earnings' && 'Comprehensive net payable ledger, commission breakdown, and bank account details for sellers.'}
            {subTab === 'payouts' && 'Manage IMPS/NEFT bank transfers, approve pending payouts, and view settled history.'}
          </p>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {subTab === 'sales' && (
            <>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Total Gross Sales</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>{money(summary.totalGrossSales)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Admin Commission Revenue</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a', marginTop: '6px' }}>{money(summary.totalCommission)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Total Orders</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb', marginTop: '6px' }}>{summary.totalOrders || 0}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Delivered Orders</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#059669', marginTop: '6px' }}>{summary.deliveredOrders || 0}</div>
              </div>
            </>
          )}

          {subTab === 'earnings' && (
            <>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Gross Sales Volume</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>{money(summary.grossSalesVolume)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Platform Commission Retained</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a', marginTop: '6px' }}>{money(summary.platformCommission)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Net Payable to Sellers</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb', marginTop: '6px' }}>{money(summary.totalVendorPayable)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Unsettled Balance</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#d97706', marginTop: '6px' }}>{money(summary.totalUnsettledBalance)}</div>
              </div>
            </>
          )}

          {subTab === 'payouts' && (
            <>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Pending Disbursal</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#d97706', marginTop: '6px' }}>{money(summary.pendingAmount)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Total Disbursed (Paid)</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#16a34a', marginTop: '6px' }}>{money(summary.paidAmount)}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Pending Payout Requests</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#2563eb', marginTop: '6px' }}>{summary.pendingRequests || 0}</div>
              </div>
              <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>Total Payout Transactions</span>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '6px' }}>{summary.totalPayouts || 0}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Toolbar: Filter & Search */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'space-between', alignItems: 'center',
        background: '#ffffff', padding: '16px 20px', borderRadius: '12px', border: '1px solid #e2e8f0'
      }}>
        <div style={{ display: 'flex', gap: '12px', flex: 1, minWidth: '280px' }}>
          <input
            type="text"
            placeholder={subTab === 'payouts' ? "Search by seller name, phone, ref ID..." : "Search seller, order ID, store name..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
              fontSize: '14px', outline: 'none'
            }}
          />

          {subTab === 'payouts' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                fontSize: '14px', outline: 'none', background: '#ffffff'
              }}
            >
              <option value="all">All Payout Statuses</option>
              <option value="pending">Pending Disbursal</option>
              <option value="paid">Settled / Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          )}

          {subTab === 'sales' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1',
                fontSize: '14px', outline: 'none', background: '#ffffff'
              }}
            >
              <option value="all">All Order Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="placed">Placed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
        </div>

        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
          Showing {sortedItems.length} of {pagination.total} records
        </div>
      </div>

      {error && (
        <div style={{ padding: '14px', borderRadius: '8px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Main Table / Data View */}
      <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {loading ? (
          <div style={{ padding: '40px', textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center', color: '#64748b', fontSize: '14px', fontWeight: 600 }}>
            Loading financial records...
          </div>
        ) : sortedItems.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
            No financial records found matching your filters.
          </div>
        ) : (
          <>
            {/* SUB-TAB 1: SALES LEDGER TABLE */}
            {subTab === 'sales' && (
              <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                      <th style={{ padding: '14px 16px' }}>Order Details</th>
                      <th style={{ padding: '14px 16px' }}>Store / Seller</th>
                      <th style={{ padding: '14px 16px' }}>Payment Method</th>
                      <th style={{ padding: '14px 16px' }}>Gross Subtotal</th>
                      <th style={{ padding: '14px 16px' }}>Commission (%)</th>
                      <th style={{ padding: '14px 16px' }}>Admin Fee</th>
                      <th style={{ padding: '14px 16px' }}>Net Seller Share</th>
                      <th style={{ padding: '14px 16px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item, idx) => {
                      return (
                        <tr key={item._id || item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>#{item.orderId || item._id}</div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{fmtDate(item.createdAt)}</div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{item.storeName || item.sellerName || '—'}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{item.sellerPhone || ''}</div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px', background: '#f1f5f9', fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                              {item.paymentMethod || 'Online'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0f172a' }}>
                            {money(item.totalAmount || item.subTotal)}
                          </td>
                          <td style={{ padding: '14px 16px', color: '#475569' }}>
                            {item.adminCommissionPercent || 5}%
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#16a34a' }}>
                            {money(item.adminCommissionAmount)}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 700, color: '#2563eb' }}>
                            {money(item.vendorEarnings)}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                              background: item.status === 'delivered' ? '#dcfce7' : '#f1f5f9',
                              color: item.status === 'delivered' ? '#15803d' : '#475569'
                            }}>
                              {prettyStatus(item.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* SUB-TAB 2: VENDOR EARNINGS LEDGER */}
            {subTab === 'earnings' && (
              <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                      <th style={{ padding: '14px 16px' }}>Seller / Store</th>
                      <th style={{ padding: '14px 16px' }}>Bank Account Info</th>
                      <th style={{ padding: '14px 16px' }}>Total Orders</th>
                      <th style={{ padding: '14px 16px' }}>Gross Revenue</th>
                      <th style={{ padding: '14px 16px' }}>Commission Deducted</th>
                      <th style={{ padding: '14px 16px' }}>Total Disbursed</th>
                      <th style={{ padding: '14px 16px' }}>Unsettled Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item, idx) => {
                      return (
                        <tr key={item.sellerId || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{item.storeName || item.businessName || item.ownerName}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{item.ownerName} • {item.phone}</div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {item.bankAccount ? (
                              <div style={{ fontSize: '12px', color: '#334155' }}>
                                <div style={{ fontWeight: 600 }}>{item.bankAccount.bankName || 'Bank'}</div>
                                <div style={{ color: '#64748b' }}>A/C: {item.bankAccount.accountNumber || '—'}</div>
                                <div style={{ color: '#94a3b8', fontSize: '11px' }}>IFSC: {item.bankAccount.ifsc || '—'}</div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>Not Provided</span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#475569' }}>
                            {item.deliveredOrders || 0}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0f172a' }}>
                            {money(item.grossSales)}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#16a34a' }}>
                            {money(item.totalCommission)}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 600, color: '#2563eb' }}>
                            {money(item.totalSettled)}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              fontWeight: 700, fontSize: '14px',
                              color: Number(item.unsettledBalance || 0) > 0 ? '#d97706' : '#64748b'
                            }}>
                              {money(item.unsettledBalance)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* SUB-TAB 3: PAYOUTS & DISBURSALS */}
            {subTab === 'payouts' && (
              <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                      <th style={{ padding: '14px 16px' }}>Payout Ref</th>
                      <th style={{ padding: '14px 16px' }}>Seller / Store</th>
                      <th style={{ padding: '14px 16px' }}>Bank Account</th>
                      <th style={{ padding: '14px 16px' }}>Amount</th>
                      <th style={{ padding: '14px 16px' }}>Requested On</th>
                      <th style={{ padding: '14px 16px' }}>Status</th>
                      <th style={{ padding: '14px 16px' }}>Settlement Details</th>
                      <th style={{ padding: '14px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item, idx) => {
                      return (
                        <tr key={item._id || item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.payoutRef || item._id}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>IMPS / Bank Direct</div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, color: '#0f172a' }}>{item.storeName || item.sellerName || item.seller?.businessName || '—'}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{item.sellerPhone || item.seller?.phone || ''}</div>
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            {item.bankAccount ? (
                              <div style={{ fontSize: '12px', color: '#334155' }}>
                                <div><strong>{item.bankAccount.bankName}</strong></div>
                                <div>A/C: {item.bankAccount.accountNumber}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>IFSC: {item.bankAccount.ifsc}</div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>Standard Registered Bank</span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
                            {money(item.amount)}
                          </td>
                          <td style={{ padding: '14px 16px', color: '#475569' }}>
                            {fmtDate(item.createdAt)}
                          </td>
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{
                              padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                              background: item.status === 'paid' ? '#dcfce7' : item.status === 'pending' ? '#fef3c7' : '#fef2f2',
                              color: item.status === 'paid' ? '#15803d' : item.status === 'pending' ? '#b45309' : '#b91c1c',
                              border: item.status === 'paid' ? '1px solid #bbf7d0' : item.status === 'pending' ? '1px solid #fde68a' : '1px solid #fecaca'
                            }}>
                              {prettyStatus(item.status)}
                            </span>
                          </td>
                          <td style={{ padding: '14px 16px', fontSize: '12px', color: '#475569' }}>
                            {item.status === 'paid' ? (
                              <div>
                                <div style={{ fontWeight: 600, color: '#16a34a' }}>Ref: {item.transactionRef || 'IMPS-SUCCESS'}</div>
                                <div style={{ fontSize: '11px', color: '#64748b' }}>{fmtDate(item.processedAt)}</div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>Awaiting Transfer</span>
                            )}
                          </td>
                          <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                            {item.status === 'pending' && (
                              <button
                                onClick={() => {
                                  setSelectedPayout(item);
                                  setSettleRef(`IMPS-${Date.now().toString().slice(-6)}`);
                                  setSettleModalOpen(true);
                                }}
                                style={{
                                  padding: '8px 14px', background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                                  color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer',
                                  fontWeight: 600, fontSize: '12px', boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)'
                                }}
                              >
                                Approve IMPS Disbursal
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '13px', color: '#64748b'
            }}>
              <div>Page {pagination.page} of {pagination.totalPages}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => fetchData(pagination.page - 1)}
                  style={{
                    padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1',
                    background: pagination.page <= 1 ? '#f1f5f9' : '#ffffff',
                    cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer', fontWeight: 600
                  }}
                >
                  Previous
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchData(pagination.page + 1)}
                  style={{
                    padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1',
                    background: pagination.page >= pagination.totalPages ? '#f1f5f9' : '#ffffff',
                    cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer', fontWeight: 600
                  }}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Settle IMPS Modal */}
      {settleModalOpen && selectedPayout && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
        }}>
          <div style={{
            background: '#ffffff', width: '100%', maxWidth: '480px', borderRadius: '16px', overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
          }}>
            <div style={{ background: '#0f172a', padding: '20px', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Approve IMPS Bank Disbursal</h3>
              <button onClick={() => setSettleModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#ffffff', fontSize: '20px', cursor: 'pointer' }}>×</button>
            </div>

            <form onSubmit={handleSettleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>{selectedPayout.storeName || selectedPayout.sellerName || 'Seller'}</div>
                <div style={{ color: '#64748b', marginTop: '4px' }}>Disbursal Amount: <strong style={{ color: '#16a34a', fontSize: '16px' }}>{money(selectedPayout.amount)}</strong></div>
                {selectedPayout.bankAccount && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #cbd5e1', color: '#334155' }}>
                    <div>Bank: <strong>{selectedPayout.bankAccount.bankName}</strong></div>
                    <div>A/C #: <strong>{selectedPayout.bankAccount.accountNumber}</strong></div>
                    <div>IFSC: <strong>{selectedPayout.bankAccount.ifsc}</strong></div>
                  </div>
                )}
              </div>

              {settleError && (
                <div style={{ padding: '10px', borderRadius: '6px', background: '#fef2f2', color: '#991b1b', fontSize: '13px' }}>
                  {settleError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  IMPS / Bank Transaction Reference ID
                </label>
                <input
                  type="text"
                  required
                  value={settleRef}
                  onChange={(e) => setSettleRef(e.target.value)}
                  placeholder="e.g. IMPS98273612873"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Payment Method
                </label>
                <select
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  <option value="IMPS">IMPS Instant Bank Transfer</option>
                  <option value="NEFT">NEFT Bank Transfer</option>
                  <option value="UPI">UPI Direct Payout</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Admin Remarks / Notes (Optional)
                </label>
                <textarea
                  rows="2"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="e.g. Approved and transferred via ICICI IMPS Gateway"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSettleModalOpen(false)}
                  style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={settling}
                  style={{
                    padding: '10px 20px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                    color: '#ffffff', cursor: settling ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px'
                  }}
                >
                  {settling ? 'Processing...' : 'Confirm & Mark Paid'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
