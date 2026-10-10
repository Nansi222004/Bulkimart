import React from 'react';
import { useSHG } from '../context/SHGContext';

const SHGOrdersTab = () => {
  const {
    orders,
    activeOrderTab,
    setActiveOrderTab,
    selectedOrder,
    setSelectedOrder,
    handleUpdateOrderStatus,
    activeMode
  } = useSHG();

  // Filter orders
  const filteredOrders = orders.filter(order => {
    if (activeOrderTab === 'All') return true;
    return order.status === activeOrderTab;
  });

  const MODE_LABEL = { shg: 'all storefronts (SHG Store)', ecommerce: 'Ecommerce orders only', quick: 'Quick Commerce orders only' };

  return (
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Which storefront these orders are scoped to — set by the header's
          mode switcher; the list itself is already fetched pre-filtered
          server-side (see SHGContext.fetchSHGData). */}
      <div style={{ padding: '10px 18px 0', fontSize: 11.5, fontWeight: 700, color: 'var(--shg-text-muted)' }}>
        Showing {MODE_LABEL[activeMode] || 'all storefronts'}
      </div>

      {/* Tabs Filter Row */}
      <div className="shg-tab-row" style={{ borderTop: 'none' }}>
        {['All', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'].map(tab => (
          <button 
            key={tab} 
            className={`shg-filter-tab ${activeOrderTab === tab ? 'active' : ''}`}
            onClick={() => setActiveOrderTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Orders List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 32px' }}>
        <div className="shg-card">
          {filteredOrders.length === 0 ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">📋</div>
              <p className="shg-empty-text">No orders found in this section.</p>
            </div>
          ) : (
            filteredOrders.map(order => (
              <div 
                key={order.id} 
                className="shg-order-row"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="shg-order-id">{order.orderNo || order.id}</div>
                
                <div className="shg-order-meta">
                  <div className="shg-order-customer">{order.customer}</div>
                  <div className="shg-order-detail">{order.items} • {order.date}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="shg-order-amount">₹{order.total}</div>
                  <span className={`shg-status-badge ${order.statusType}`}>
                    {order.status}
                  </span>
                  <span className="menu-chevron" style={{ opacity: 0.4 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Order Detail Modal Sheet */}
      {selectedOrder && (
        <div className="shg-modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="shg-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="shg-modal-header">
              <h3 className="shg-modal-title">Fulfillment Order Detail</h3>
              <button className="shg-modal-close" onClick={() => setSelectedOrder(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Meta Card */}
              <div style={{ padding: 16, background: 'var(--shg-bg-page)', borderRadius: 'var(--shg-radius-md)', border: '1px solid var(--shg-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--shg-text-muted)' }}>ORDER ID</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--shg-primary)' }}>{selectedOrder.orderNo || selectedOrder.id}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--shg-text-muted)' }}>CUSTOMER</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--shg-text-primary)' }}>{selectedOrder.customer}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--shg-text-muted)' }}>BOOKED DATE</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--shg-text-secondary)' }}>{selectedOrder.date}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--shg-text-muted)' }}>CURRENT STATUS</span>
                  <span className={`shg-status-badge ${selectedOrder.statusType}`}>{selectedOrder.status}</span>
                </div>
              </div>

              {/* Items Card */}
              <div className="shg-card" style={{ margin: 0 }}>
                <div className="shg-card-header" style={{ padding: 12 }}>
                  <h4 className="shg-card-title">Order Items</h4>
                </div>
                <div style={{ padding: 14 }}>
                  {(selectedOrder.itemsList || []).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                      <span style={{ color: 'var(--shg-text-primary)', fontWeight: 600 }}>{item.qty}x {item.name}</span>
                      <span style={{ fontWeight: 700 }}>₹{item.price * item.qty}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px dashed var(--shg-border)', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800 }}>
                    <span style={{ color: 'var(--shg-primary)' }}>Total Amount Paid</span>
                    <span>₹{selectedOrder.total}</span>
                  </div>
                </div>
              </div>

              {/* Status Update Actions */}
              <div>
                <label className="shg-label" style={{ marginBottom: 8 }}>Update Order Status</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {selectedOrder.status === 'Pending' && (
                    <>
                      <button 
                        className="shg-primary-btn" 
                        style={{ margin: 0 }}
                        onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Confirmed')}
                      >
                        Confirm Order
                      </button>
                      <button 
                        className="shg-secondary-btn" 
                        onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Cancelled')}
                      >
                        Reject Order
                      </button>
                    </>
                  )}
                  {selectedOrder.status === 'Confirmed' && (
                    <button 
                      className="shg-primary-btn" 
                      style={{ gridColumn: 'span 2', margin: 0 }}
                      onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Shipped')}
                    >
                      Ship Order Packages
                    </button>
                  )}
                  {selectedOrder.status === 'Shipped' && (
                    <button 
                      className="shg-primary-btn" 
                      style={{ gridColumn: 'span 2', margin: 0 }}
                      onClick={() => handleUpdateOrderStatus(selectedOrder.id, 'Delivered')}
                    >
                      Mark as Delivered
                    </button>
                  )}
                  {(selectedOrder.status === 'Delivered' || selectedOrder.status === 'Cancelled') && (
                    <div style={{ gridColumn: 'span 2', textAlign: 'center', fontSize: 12, color: 'var(--shg-text-muted)', fontStyle: 'italic', padding: 8 }}>
                      Fulfillment lifecycle has finished for this order.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SHGOrdersTab;
