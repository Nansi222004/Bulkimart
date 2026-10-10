import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';

/**
 * Returns & Refund Requests.
 *
 * Provides real-time Return KPIs (Total Returns, Requested, Approved, Refunded),
 * filter tabs, live search, and modern return item cards.
 */
const RETURN_STATUSES = [
  'return_requested', 'returned', 'refunded',
  'Requested', 'Under Review', 'Approved', 'Awaiting Return', 'Received', 'Refund Pending', 'Refunded', 'Rejected', 'Cancelled'
];

const STATUS_STYLE = {
  return_requested: { bg: '#fef3c7', fg: '#92400e', label: 'Requested 🕒' },
  Requested:        { bg: '#fef3c7', fg: '#92400e', label: 'Requested 🕒' },
  'Under Review':   { bg: '#e0e7ff', fg: '#3730a3', label: 'Under Review' },
  Approved:         { bg: '#dbeafe', fg: '#1e40af', label: 'Approved 🚚' },
  returned:         { bg: '#dbeafe', fg: '#1e40af', label: 'Returned' },
  Received:         { bg: '#ede9fe', fg: '#6d28d9', label: 'Received' },
  refunded:         { bg: '#dcfce7', fg: '#166534', label: 'Refunded ✓' },
  Refunded:         { bg: '#dcfce7', fg: '#166534', label: 'Refunded ✓' },
  Rejected:         { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected' },
  Cancelled:        { bg: '#f1f5f9', fg: '#64748b', label: 'Cancelled' },
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export const ReturnRequestsTab = () => {
  const { orders, ordersLoading, selectedTypes, activeMode, setActiveMode } = useSeller();
  const [selectedTab, setSelectedTab] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const activeChannelName = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  
  // Filter mode-scoped orders
  const channelOrders = (orders || []).filter((o) => {
    if (o.channel) return o.channel === activeChannelName;
    return true;
  });

  // Extract all returns
  const allReturns = channelOrders.filter((o) => RETURN_STATUSES.includes(o.status));

  // KPI calculations with actual live counts
  const totalCount = allReturns.length;
  const requestedCount = allReturns.filter(o => o.status === 'return_requested' || o.status === 'Requested').length;
  const inTransitCount = allReturns.filter(o => o.status === 'returned' || o.status === 'Approved' || o.status === 'Received').length;
  const refundedCount = allReturns.filter(o => o.status === 'refunded' || o.status === 'Refunded').length;

  // Tabbed & Search Filtering
  const shownReturns = allReturns.filter((o) => {
    let matchesTab = true;
    if (selectedTab === 'Requested') {
      matchesTab = o.status === 'return_requested' || o.status === 'Requested';
    } else if (selectedTab === 'Approved') {
      matchesTab = o.status === 'returned' || o.status === 'Approved';
    } else if (selectedTab === 'Refunded') {
      matchesTab = o.status === 'refunded' || o.status === 'Refunded';
    }

    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query || 
      (o.orderNo || '').toLowerCase().includes(query) ||
      (o.customer?.name || '').toLowerCase().includes(query) ||
      (o.items || []).some(i => (i.name || '').toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  if (ordersLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
        Loading return requests…
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .return-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .return-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .return-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          cursor: pointer;
        }
        .return-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
        }
        .return-item-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .return-item-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
        }
      `}} />

      {/* Header */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              Item Returns
            </h1>
            <span style={{
              backgroundColor: '#fef3c7',
              color: '#b45309',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              LOGISTICS & REFUNDS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Approval/refund is Admin-managed — pickup logistics and item inspection are yours.
          </p>
        </div>
      </div>

      {/* Mode Switcher Toggle */}
      {selectedTypes && selectedTypes.includes('ecommerce') && selectedTypes.includes('quick') && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          margin: '0 0 16px 0'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '2px',
            backgroundColor: '#f1f5f9',
            borderRadius: '12px',
            border: '1.5px solid #e2e8f0'
          }}>
            <button 
              onClick={() => setActiveMode('ecommerce')}
              style={{
                border: 'none',
                background: activeMode === 'ecommerce' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'none',
                color: activeMode === 'ecommerce' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'ecommerce' ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              📦 E-Commerce
            </button>
            <button 
              onClick={() => setActiveMode('quick')}
              style={{
                border: 'none',
                background: activeMode === 'quick' ? 'linear-gradient(135deg, #10b981, #047857)' : 'none',
                color: activeMode === 'quick' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'quick' ? '0 2px 4px rgba(16, 185, 129, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              ⚡ Quick Commerce
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="return-kpi-grid">
        {/* Card 1: Total Returns */}
        <div className="return-kpi-card" onClick={() => setSelectedTab('All')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>TOTAL RETURNS</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>↩️</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>{totalCount}</div>
        </div>

        {/* Card 2: Requested */}
        <div className="return-kpi-card" onClick={() => setSelectedTab('Requested')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>REQUESTED</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⏳</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#b45309', fontFamily: "'Outfit', sans-serif" }}>{requestedCount}</div>
        </div>

        {/* Card 3: Approved / In Transit */}
        <div className="return-kpi-card" onClick={() => setSelectedTab('Approved')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>APPROVED / PICKUP</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🚚</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Outfit', sans-serif" }}>{inTransitCount}</div>
        </div>

        {/* Card 4: Refunded */}
        <div className="return-kpi-card" onClick={() => setSelectedTab('Refunded')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>REFUNDED</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✅</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#166534', fontFamily: "'Outfit', sans-serif" }}>{refundedCount}</div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar Row */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12
      }}>
        {/* Status Filter Tabs */}
        <div style={{
          display: 'flex',
          backgroundColor: '#f1f5f9',
          padding: 3,
          borderRadius: 100,
          gap: 2
        }}>
          {['All', 'Requested', 'Approved', 'Refunded'].map((t) => {
            const isActive = selectedTab === t;
            return (
              <button
                key={t}
                onClick={() => setSelectedTab(t)}
                style={{
                  border: 'none',
                  background: isActive ? '#fff' : 'none',
                  color: isActive ? '#0f172a' : '#64748b',
                  fontSize: 11,
                  fontWeight: isActive ? '800' : '700',
                  padding: '7px 16px',
                  borderRadius: 100,
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#fff',
          border: '1.5px solid #e2e8f0',
          borderRadius: 100,
          padding: '8px 14px',
          minWidth: '240px',
          maxWidth: '340px',
          flex: 1
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input 
            type="text" 
            placeholder="Search by Return ID, Customer, or Product..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              background: 'none',
              fontSize: 12,
              fontWeight: 600,
              color: '#0f172a',
              width: '100%'
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Return List */}
      {allReturns.length === 0 ? (
        <EmptyState
          icon="↩️"
          title="No return requests"
          message="When a customer asks to return an item from your store, it will appear here."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shownReturns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b', fontSize: 12, fontWeight: 600, backgroundColor: '#fff', borderRadius: 16, border: '1.5px solid #f1f5f9' }}>
              No returns found matching the active filter.
            </div>
          ) : shownReturns.map((o) => {
            const style = STATUS_STYLE[o.status] || STATUS_STYLE.return_requested;
            return (
              <div key={o._id} className="return-item-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                        RET-{o.orderNo?.replace('ORD-', '') || o._id.slice(-8).toUpperCase()}
                      </span>
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>
                        Order: {o.orderNo}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, fontWeight: 500 }}>
                      {o.customer?.name || 'Customer'} · {o.customer?.city || '—'}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, backgroundColor: style.bg, color: style.fg }}>
                    {style.label}
                  </span>
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {o.items.map((i) => (
                    <div key={i.productId || i.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {i.image ? (
                          <img src={i.image} alt={i.name} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                            📦
                          </div>
                        )}
                        <span style={{ color: '#0f172a', fontWeight: 700 }}>
                          {i.name} <span style={{ color: '#64748b', fontWeight: 600 }}>× {i.qty}</span>
                        </span>
                      </div>
                      <span style={{ fontWeight: 800, color: '#0f172a' }}>{money(i.lineTotal)}</span>
                    </div>
                  ))}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderTop: '1px dashed #e2e8f0', paddingTop: 8, marginTop: 4 }}>
                    <span style={{ color: '#64748b', fontWeight: 700 }}>Refund Status</span>
                    <span style={{ fontWeight: 900, color: '#059669' }}>
                      {o.status === 'refunded' ? `Refund Completed · ${money(o.subtotal)}` : `Refund Pending · ${money(o.subtotal)}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReturnRequestsTab;
