import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';

/**
 * Delivery Tracking.
 *
 * Provides real-time tracking KPIs (On The Way, At Store, Completed Today),
 * status filter tabs (Active, Completed, All), and timeline history per order.
 */
const STATUS_LABEL = {
  placed: 'Order placed',
  confirmed: 'Payment confirmed',
  preparing: 'Being prepared',
  dispatched: 'Dispatched from you',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
  refunded: 'Refunded',
};

const fmt = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const TrackOrderTab = () => {
  const { orders, ordersLoading, selectedTypes, activeMode, setActiveMode } = useSeller();
  const [openId, setOpenId] = useState(null);
  const [filterTab, setFilterTab] = useState('ACTIVE'); // 'ACTIVE', 'COMPLETED', 'ALL'
  const [searchQuery, setSearchQuery] = useState('');

  const activeChannelName = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  
  // Mode-scoped order list
  const channelOrders = (orders || []).filter((o) => {
    if (o.channel) return o.channel === activeChannelName;
    return true;
  });

  // KPI Calculations
  const onTheWayCount = channelOrders.filter(o => ['dispatched', 'out_for_delivery'].includes(o.status)).length;
  const atStoreCount = channelOrders.filter(o => ['placed', 'confirmed', 'preparing'].includes(o.status)).length;
  const completedTodayCount = channelOrders.filter(o => o.status === 'delivered').length;

  // Filtered Tracking List
  const filteredOrders = channelOrders.filter((o) => {
    let matchesTab = true;
    if (filterTab === 'ACTIVE') {
      matchesTab = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery'].includes(o.status);
    } else if (filterTab === 'COMPLETED') {
      matchesTab = ['delivered', 'cancelled', 'returned', 'refunded'].includes(o.status);
    }

    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query ||
      (o.orderNo || '').toLowerCase().includes(query) ||
      (o.customer?.name || '').toLowerCase().includes(query) ||
      (o.shippingAddress?.city || '').toLowerCase().includes(query);

    return matchesTab && matchesSearch;
  });

  if (ordersLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
        Loading live tracking data…
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .track-kpi-grid {
          display: grid;
          grid-template-columns: repeat(1, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }
        @media (min-width: 640px) {
          .track-kpi-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
          }
        }
        .track-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          min-width: 0;
          cursor: pointer;
        }
        .track-kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 15px -3px rgba(0,0,0,0.04);
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
              Delivery Tracking
            </h1>
            <span style={{
              backgroundColor: '#f1f5f9',
              color: '#64748b',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              LIVE FLEET
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Monitor active deliveries and assigned partners.
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

      {/* KPI Cards Grid (On The Way, At Store, Completed Today) */}
      <div className="track-kpi-grid">
        {/* Card 1: On The Way */}
        <div 
          className="track-kpi-card" 
          onClick={() => setFilterTab('ACTIVE')}
          style={{ border: filterTab === 'ACTIVE' ? '1.5px solid #2563eb' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#f1f5f9',
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="2"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              ON THE WAY
            </span>
            <span style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {onTheWayCount}
            </span>
          </div>
        </div>

        {/* Card 2: At Store */}
        <div 
          className="track-kpi-card" 
          onClick={() => setFilterTab('ACTIVE')}
          style={{ border: filterTab === 'ACTIVE' ? '1.5px solid #f59e0b' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#fef3c7',
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              AT STORE
            </span>
            <span style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {atStoreCount}
            </span>
          </div>
        </div>

        {/* Card 3: Completed Today */}
        <div 
          className="track-kpi-card" 
          onClick={() => setFilterTab('COMPLETED')}
          style={{ border: filterTab === 'COMPLETED' ? '1.5px solid #10b981' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#dcfce7',
            color: '#15803d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
              <path d="M16 10l-4 4-2-2"></path>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              COMPLETED TODAY
            </span>
            <span style={{ fontSize: 24, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {completedTodayCount}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Row */}
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
          {['ACTIVE', 'COMPLETED', 'ALL'].map((tab) => {
            const isActive = filterTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
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
                {tab}
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
            placeholder="Search ID or Partner..."
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

      {/* Orders List */}
      {filteredOrders.length === 0 ? (
        <EmptyState
          icon="🚚"
          title={filterTab === 'ACTIVE' ? 'Nothing in transit' : 'No tracking records found'}
          message={
            filterTab === 'ACTIVE'
              ? 'Orders you have not yet handed over, and those on their way to the customer, show up here.'
              : 'No order tracking records found for the selected filter.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredOrders.map((o) => {
            const open = openId === o._id;
            const trail = [...(o.timeline || [])].reverse();

            return (
              <div key={o._id} className="review-summary-card" style={{ backgroundColor: '#fff', border: '1.5px solid #f1f5f9', borderRadius: 14, padding: 14 }}>
                <div
                  onClick={() => setOpenId(open ? null : o._id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{o.orderNo}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, fontWeight: 500 }}>
                      {o.customer?.name || 'Customer'} · {o.customer?.city || '—'} {o.customer?.pincode || ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: 500 }}>
                      {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · ₹{Number(o.subtotal).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 20, backgroundColor: '#f1f5f9', color: '#0f172a' }}>
                      {STATUS_LABEL[o.status] || o.status}
                    </span>
                    <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginTop: 6 }}>
                      {open ? 'Hide trail ▲' : 'Show trail ▼'}
                    </div>
                  </div>
                </div>

                {open && (
                  <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 12, paddingTop: 12 }}>
                    {trail.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#64748b' }}>No status history recorded yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {trail.map((t, i) => (
                          <div key={`${t.status}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span
                              style={{
                                width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                                backgroundColor: i === 0 ? '#3b82f6' : '#cbd5e1',
                              }}
                            />
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 800, color: i === 0 ? '#1d4ed8' : '#0f172a' }}>
                                {STATUS_LABEL[t.status] || t.status}
                              </div>
                              {t.note && <div style={{ fontSize: 10, color: '#64748b' }}>{t.note}</div>}
                              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700 }}>{fmt(t.timestamp)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}>
                      <div style={{ fontSize: 9, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>
                        Deliver to
                      </div>
                      <div style={{ fontSize: 11, color: '#0f172a', fontWeight: 600, marginTop: 2, lineHeight: 1.5 }}>
                        {o.shippingAddress?.line1}
                        {o.shippingAddress?.line2 ? `, ${o.shippingAddress.line2}` : ''}
                        <br />
                        {o.shippingAddress?.city} {o.shippingAddress?.pincode}
                        {o.shippingAddress?.phone ? ` · ${o.shippingAddress.phone}` : ''}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrackOrderTab;
