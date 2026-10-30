import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';

/**
 * `preparing` deliberately reads as "Confirmed".
 *
 * It is a real status the shop passes through, but it has been taken off the
 * customer's timeline. Labelling it here would put a stage on the order card
 * that the tracking screen does not show — the same order described two
 * different ways depending on which screen you were looking at.
 */
import { deliveryLabelFor } from '../utils/deliveryLabel';

/**
 * What each storefront is called on a customer's receipt.
 *
 * The stored values are `grocery` / `ecommerce`; these are the names people
 * actually see in the app. Kept in one place so the badge, and anything else
 * that needs to name a channel, cannot drift apart. (The retired SHG store has
 * no label or filter; a historical order of that type reads as "Order".)
 */
const CHANNEL_LABEL = {
  grocery: 'Quick',
  ecommerce: 'Shop All',
};

const STATUS_LABEL = {
  placed: 'Order Placed', confirmed: 'Confirmed', preparing: 'Confirmed',
  dispatched: 'Dispatched', out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered', cancelled: 'Cancelled',
  return_requested: 'Return Requested', returned: 'Returned', refunded: 'Refunded',
};

// maps a backend status onto the CSS class the card already styles
const STATUS_CLASS = {
  delivered: 'delivered', cancelled: 'cancelled', returned: 'cancelled',
  refunded: 'cancelled', placed: 'pending', confirmed: 'confirmed',
  preparing: 'confirmed', dispatched: 'shipped', out_for_delivery: 'shipped',
  return_requested: 'pending',
};

const OrdersPage = () => {
  const { setActiveNav, orders, ordersLoading, ordersError, setSelectedOrder, fetchOrders, requestPushPermission } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [pushDismissed, setPushDismissed] = useState(() => {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('push_prompt_dismissed') === 'true' : false;
  });
  const showPushPrompt = typeof window !== 'undefined' && typeof Notification !== 'undefined' && Notification.permission === 'default' && !pushDismissed;

  // Razorpay checkout returns here only after the authenticated backend
  // verification call. The query is a UX cue, never payment proof.
  const [paymentBanner, setPaymentBanner] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('payment');
    if (!status) return;

    const orderNo = params.get('order');
    fetchOrders();
    if (status === 'paid') {
      setPaymentBanner({ tone: 'good', text: `Payment successful${orderNo ? ` for order ${orderNo}` : ''}.` });
    } else if (status === 'failed') {
      setPaymentBanner({ tone: 'bad', text: `Payment failed${orderNo ? ` for order ${orderNo}` : ''}. You can retry from the order details.` });
    } else {
      setPaymentBanner({ tone: 'neutral', text: 'We are confirming your payment — this may take a moment.' });
    }

    params.delete('payment');
    params.delete('order');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, []);

  // Real orders from GET /api/orders, flattened to what the card renders.
  const rows = (orders || []).map((o) => {
    const first = o.items?.[0] || {};
    const extra = (o.items?.length || 0) - 1;
    return {
      id: o._id,
      orderNo: o.orderNo,
      productName: extra > 0 ? `${first.name} +${extra} more` : (first.name || 'Order'),
      img: first.image || '',
      qty: o.items?.reduce((n, i) => n + i.qty, 0) || 0,
      total: o.pricing?.totalAmount ?? 0,
      status: STATUS_LABEL[o.status] || o.status,
      statusType: STATUS_CLASS[o.status] || 'pending',
      dateText: new Date(o.createdAt).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
      // Wholesale is a sales channel on Shop All orders, so it is checked first.
      channel: o.salesChannel === 'wholesale' ? 'Wholesale' : CHANNEL_LABEL[o.type] || 'Order',
      /**
       * How this one was delivered, from the order's own record.
       *
       * Not derived from `o.type` — that says which storefront it came from,
       * and Shop All has two ways of arriving. Not derived from the product or
       * the shop either: those describe today, and this row describes what was
       * bought. Null for Quick orders, which have only one way of arriving and
       * so nothing to distinguish.
       */
      delivery: deliveryLabelFor(o),
      raw: o,
    };
  });

  // Filter orders based on search query
  const q = searchQuery.trim().toLowerCase();
  const filteredOrders = rows.filter((o) =>
    (statusFilter === 'all' || o.raw.status === statusFilter || (statusFilter === 'confirmed' && o.raw.status === 'preparing')) &&
    (channelFilter === 'all' || o.channel === channelFilter) &&
    (!q || o.productName.toLowerCase().includes(q) ||
    o.status.toLowerCase().includes(q) ||
    (o.orderNo || '').toLowerCase().includes(q))
  );

  return (
    <div className="orders-page-container">
      {/* Header Row */}
      <div className="orders-header-row">
        <button className="back-arrow-btn" onClick={() => setActiveNav('home')} aria-label="Go back to Home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h2 className="orders-page-title">MY ORDERS</h2>
        <div style={{ width: 20 }}></div>
      </div>

      {/* Thin header divider line */}
      <div className="orders-header-divider"></div>

      {paymentBanner && (
        <div
          style={{
            margin: '10px 16px 0',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.5,
            background: paymentBanner.tone === 'good' ? 'rgba(27,122,55,0.10)' : paymentBanner.tone === 'bad' ? 'rgba(239,68,68,0.10)' : 'rgba(100,116,139,0.10)',
            border: `1px solid ${paymentBanner.tone === 'good' ? 'rgba(27,122,55,0.35)' : paymentBanner.tone === 'bad' ? 'rgba(239,68,68,0.35)' : 'rgba(100,116,139,0.35)'}`,
            color: paymentBanner.tone === 'good' ? '#1b7a37' : paymentBanner.tone === 'bad' ? '#b91c1c' : '#475569',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>{paymentBanner.text}</span>
          <button
            onClick={() => setPaymentBanner(null)}
            style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {showPushPrompt && (
        <div
          style={{
            margin: '10px 16px 0',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.5,
            background: 'linear-gradient(135deg, rgba(20, 110, 180, 0.08), rgba(20, 110, 180, 0.15))',
            border: '1px solid rgba(20, 110, 180, 0.3)',
            color: '#0369a1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            <span>Enable notifications to get real-time order updates & delivery alerts.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={async () => {
                await requestPushPermission?.();
                setPushDismissed(true);
              }}
              style={{
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
              }}
            >
              Enable
            </button>
            <button
              onClick={() => {
                setPushDismissed(true);
                if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('push_prompt_dismissed', 'true');
              }}
              style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Search and Filters row */}
      <div className="orders-search-filter-row">
        <div className="orders-search-wrapper">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="orders-search-input"
            placeholder="Search orders"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button type="button" className="orders-filter-btn" aria-label="Open filters" aria-expanded={filtersOpen}
          aria-controls="orders-filters" onClick={() => setFiltersOpen(value => !value)}>
          <svg className="filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
          Filters
        </button>
      </div>

      {filtersOpen && <div id="orders-filters" className="orders-filter-panel">
        <label>Order status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).filter(([value]) => value !== 'preparing').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Storefront<select value={channelFilter} onChange={event => setChannelFilter(event.target.value)}>
          <option value="all">All storefronts</option>
          {[...Object.values(CHANNEL_LABEL), 'Wholesale'].map(label => <option key={label} value={label}>{label}</option>)}
        </select></label>
        <button type="button" onClick={() => { setStatusFilter('all'); setChannelFilter('all'); }}>Clear filters</button>
        <button type="button" onClick={() => setFiltersOpen(false)}>Done</button>
      </div>}

      {/* Scrollable Orders List Content */}
      <div className="orders-scroll-content">
        {filteredOrders.map((order, index) => {
          return (
            <React.Fragment key={order.id}>
              {/* Order Card Item Block */}
              <div className="order-product-card" onClick={() => setSelectedOrder(order.raw)} style={{ cursor: 'pointer' }}>
                <div className="order-card-left">
                  <div className="order-img-box">
                    {order.img
                      ? <img src={order.img} alt={order.productName} className="order-img" />
                      : <div className="order-img" style={{ background: 'var(--border-color)' }} />}
                  </div>
                </div>

                <div className="order-card-middle">
                  <span className={`order-status-lbl ${order.statusType}`}>
                    {order.status}
                  </span>
                  <span className="order-date-text">{order.dateText}</span>
                  <span className="order-specs-lbl">
                    {order.orderNo} &nbsp;•&nbsp; Qty: {order.qty} &nbsp;•&nbsp; ₹{order.total}
                  </span>
                  <span className="order-mall-badge">{order.channel}</span>
                  {/* Alongside the storefront, not instead of it: which shop it
                      came from and how it travelled are two different facts. */}
                  {order.delivery && (
                    <span
                      className="order-mall-badge"
                      style={{
                        marginLeft: 6,
                        background: order.delivery.tone === 'sameday' ? '#dcfce7' : '#e2e8f0',
                        color: order.delivery.tone === 'sameday' ? '#166534' : '#475569',
                      }}
                    >
                      {order.delivery.icon} {order.delivery.text}
                    </span>
                  )}
                </div>

                <div className="order-card-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  {order.raw.paymentMethod === 'online' && order.raw.status === 'placed' && (
                    <button type="button" className="cart-secondary-btn"
                      onClick={event => { event.stopPropagation(); setSelectedOrder(order.raw); }}>
                      Order Details
                    </button>
                  )}
                  {/*
                    A shortcut into the same delivered-order screen the card
                    itself opens — not a second review modal. One place
                    knows how to submit a review and check what is already
                    submitted; a copy here would drift from it the first
                    time either one changed.
                  */}
                  {order.raw.status === 'delivered' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedOrder(order.raw); }}
                      style={{
                        background: 'none', border: '1.5px solid var(--primary)', color: 'var(--primary)',
                        borderRadius: 20, padding: '4px 10px', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ⭐ Rate Items
                    </button>
                  )}
                  <svg className="order-chevron-link" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </div>
              
              {/* Light grey separation bar below card */}
              <div className="order-card-separator"></div>
            </React.Fragment>
          );
        })}
        {ordersLoading && (
          <div className="empty-filter-view">Loading your orders…</div>
        )}
        {ordersError && <div className="empty-filter-view" role="alert">{ordersError} <button type="button" onClick={fetchOrders}>Retry</button></div>}
        {!ordersLoading && !ordersError && filteredOrders.length === 0 && (
          <div className="empty-filter-view">
            {searchQuery
              ? `No orders match "${searchQuery}".`
              : statusFilter !== 'all' || channelFilter !== 'all' ? 'No orders match these filters.' : 'You have not placed any orders yet.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersPage;
