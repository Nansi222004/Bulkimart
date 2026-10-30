import ModalPortal from '../../../components/ModalPortal';
import ShiprocketFeePayment from './ShiprocketFeePayment';
import OrderFinancialBreakdown from './OrderFinancialBreakdown';
import OrderInvoices from '../../../components/finance/OrderInvoices';
import { apiUrl } from '../../../utils/api';
import { getPortalToken } from '../../../utils/portalSession';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import { orderDetailSections, addressText } from './orderDetailSections';
import React, { useEffect, useRef, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { EmptyState } from './EmptyState';
import { Bike, Package } from 'lucide-react';
import './SellerOrderDetails.css';
import { sellerOrderTotal } from '../utils/sellerOrderAmounts';

/**
 * Orders — live from GET /api/sellers/orders, and now actionable.
 *
 * Every button here goes to the server and the list is re-read from it; nothing
 * repaints locally. An earlier version faked exactly that, which let a seller
 * believe they had dispatched an order the customer still saw as pending.
 *
 * The two storefronts part company after the shop is done packing. A Quick order
 * stops at `dispatched`, because a rider takes over and reports the rest. A Shop
 * All parcel goes to a courier that does not talk to this system, so the shop
 * stays the reporter to the end — which is why only Shop All sees "Out for
 * delivery" and "Delivered".
 *
 * Still true, and still the reason there is no per-seller status: an order can
 * hold several sellers' goods but carries one status. For a single-seller order,
 * which is every order today, that is the same thing.
 */

/**
 * Is this parcel going to a courier, or to one of our own riders?
 *
 * The question these buttons turn on, and it is about the carrier, not the
 * storefront. This used to ask `channel === 'ecommerce'`, which was right while
 * Shop All meant courier. A Same-Day order is Shop All and a rider collects it —
 * so the shop was shown "Hand to courier" and a form demanding a waybill they
 * had no way to produce. They could not finish, the order never reached
 * `dispatched`, and no rider was ever rung about it.
 *
 * Falls back to the storefront for rows served before the API sent the carrier.
 */
const byCourier = (order) =>
  order.deliveryType ? order.deliveryType === 'shiprocket' : order.channel === 'ecommerce';

// Actions are supplied by the authorized order API; absent data fails closed.
export const actionsFor = order => Array.isArray(order.permittedActions) ? order.permittedActions : [];
const STATUS_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'New', value: 'placed' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Dispatched', value: 'dispatched' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Cancelled', value: 'cancelled' },
];

const PILL = {
  placed: { bg: '#fef3c7', fg: '#92400e' },
  confirmed: { bg: '#dbeafe', fg: '#1e40af' },
  preparing: { bg: '#e0e7ff', fg: '#3730a3' },
  dispatched: { bg: '#ede9fe', fg: '#6d28d9' },
  out_for_delivery: { bg: '#ede9fe', fg: '#6d28d9' },
  delivered: { bg: '#dcfce7', fg: '#166534' },
  cancelled: { bg: '#fee2e2', fg: '#b91c1c' },
  return_requested: { bg: '#fef3c7', fg: '#92400e' },
  returned: { bg: '#fee2e2', fg: '#b91c1c' },
  refunded: { bg: '#f1f5f9', fg: '#475569' },
};

const LABEL = {
  placed: 'New',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  dispatched: 'Dispatched',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
  refunded: 'Refunded',
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmt = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const OrdersTab = ({ detailPage = false }) => {
  const ui = useFeedback();
  const { orders, ordersLoading, ordersError, fetchSellerOrders, updateOrderStatus, getFulfillmentOptions, selectManualFulfillment, createShiprocketShipment, triggerToast, selectedTypes, activeMode, setActiveMode, selectedOrder: selected, openSellerOrder, closeSellerOrder, orderDetailId, orderDetailLoading, orderDetailError, orderListState, setOrderListState } = useSeller();
  const [tab, setTab] = useState(orderListState?.tab || 'all');
  const [orderScope, setOrderScope] = useState(orderListState?.scope || 'active');
  const chooseMode = mode => { setOrderScope('active'); setActiveMode(mode); };
  // Which order is mid-request, so its buttons can be disabled rather than
  // letting an impatient double-tap fire the same transition twice.
  const [busyId, setBusyId] = useState(null);
  // The order waiting on courier details before it can be dispatched.
  const [dispatching, setDispatching] = useState(null);
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [fulfilling, setFulfilling] = useState(null);
  const [fulfillmentOptions, setFulfillmentOptions] = useState(null);
  const [fulfillmentError, setFulfillmentError] = useState('');
  const [deliveryChoice, setDeliveryChoice] = useState(null);
  const [selectedRiderId, setSelectedRiderId] = useState(null);
  const [packageSize, setPackageSize] = useState({ length: '', breadth: '', height: '' });

  const [searchQuery, setSearchQuery] = useState(orderListState?.search || '');
  const fulfillmentScope = useRef(0);
  const loadAvailability = async (order, preserveChoice = false) => {
    const generation = ++fulfillmentScope.current;
    if (!preserveChoice) {
      setDeliveryChoice(null);
      setSelectedRiderId(order.fulfillment?.requestedRiderId || null);
      setPackageSize({ length: '', breadth: '', height: '' });
    }
    setFulfilling(order); setFulfillmentOptions(null); setFulfillmentError('');
    const result = await getFulfillmentOptions(order._id);
    if (generation !== fulfillmentScope.current) return;
    if (result.ok) {
      setFulfillmentOptions(result.data);
      setSelectedRiderId(current => result.data.manual?.riders?.some(rider => String(rider.id) === String(current) && rider.online) ? current : null);
    }
    else setFulfillmentError(result.message);
  };

  useEffect(() => { if (!detailPage) setOrderListState?.({ tab, search: searchQuery, scope: orderScope }); }, [tab, searchQuery, orderScope, detailPage]);
  // Always load every status: the summary cards count this list, and the tabs
  // filter it locally. Fetching only pending orders zeroed the other cards.
  useEffect(() => { if (!detailPage) fetchSellerOrders?.('all'); }, [detailPage, fetchSellerOrders]);
  useEffect(() => {
    if (!detailPage || !selected || !actionsFor(selected).some(action => action.setup)) { setFulfilling(null); setFulfillmentOptions(null); return; }
    loadAvailability(selected);
    return () => { fulfillmentScope.current++; };
  }, [detailPage, selected?._id, selected?.version, selected?.status, selected?.deliveryPartnerId, selected?.deliveryAssignment?.status]);

  const run = async (order, to, extra) => {
    setBusyId(order._id);
    const res = await updateOrderStatus(order._id, to, { version: order.version, ...extra });
    setBusyId(null);
    triggerToast?.(res.ok ? res.message || 'Order updated' : res.message);
    return res.ok;
  };

  const onAction = async (order, action) => {
    if (action.reject) {
      return ui.collect(action.label === 'Reject' ? 'Reason for rejection (required):' : 'Reason for cancellation (required):', {title: "Provide a reason", required:true, action: async (reason) => {
      return run(order, 'cancelled', { reason, version: order.version });

}});}
    if (action.setup) {
      if (!detailPage) return openSellerOrder(order._id);
      return loadAvailability(order);
    }
    // Only a genuine courier hand-off needs a waybill. A rider pickup is a
    // straight status change — asking for a tracking number there is asking for
    // something that does not exist.
    if (byCourier(order) && action.to === 'dispatched') {
      if (order.shiprocket?.awb && order.shiprocket?.courier) {
        run(order, action.to);
        return;
      }
      setCourier('');
      setAwb('');
      setDispatching(order);
      return;
    }
    run(order, action.to);
  };

  const confirmDispatch = async () => {
    if (!courier.trim() || !awb.trim()) {
      triggerToast?.('Enter the courier name and the tracking number');
      return;
    }
    const ok = await run(dispatching, 'dispatched', { courier: courier.trim(), awb: awb.trim() });
    if (ok) setDispatching(null);
  };

  const activeChannelName = activeMode === 'quick' ? 'grocery' : 'ecommerce';

  const channelOrders = (orders || []).filter((o) => {
    if (orderScope === 'all') return true;
    if (o.channel) return o.channel === activeChannelName;
    if (activeMode === 'quick') return !byCourier(o);
    return byCourier(o);
  });

  const totalOrdersCount = channelOrders.length;
  const pendingOrdersCount = channelOrders.filter(o => ['placed', 'confirmed', 'preparing'].includes(o.status)).length;
  const confirmedOrdersCount = channelOrders.filter(o => o.status === 'confirmed' || o.status === 'preparing').length;
  const deliveredOrdersCount = channelOrders.filter(o => o.status === 'delivered').length;

  const shown = channelOrders.filter((o) => {
    const matchesTab = tab === 'all' ? true : tab === 'pending' ? ['placed', 'confirmed', 'preparing'].includes(o.status) : (o.status === tab || (tab === 'confirmed' && o.status === 'preparing'));
    const orderNo = (o.orderNo || '').toLowerCase();
    const custName = (o.customer?.name || '').toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query || orderNo.includes(query) || custName.includes(query);
    return matchesTab && matchesSearch;
  });

  return (
    <div className={detailPage ? 'seller-order-page' : undefined} style={{ padding: '0 4px 40px 4px' }}>
      {!detailPage && <>
      <style dangerouslySetInnerHTML={{__html: `
        .order-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .order-kpi-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
        }
        .order-kpi-card {
          background-color: #fff;
          border: 1.5px solid #f1f5f9;
          border-radius: 16px;
          padding: 14px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02);
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          min-width: 0;
          cursor: pointer;
        }
        .order-kpi-card:hover {
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
              Order Management
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
              REAL-TIME
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Process and track your customer orders with ease.
          </p>
        </div>
      </div>

      {/* Mode Switcher Toggle (Moved from Header for Orders Tab) */}
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
              onClick={() => chooseMode('ecommerce')}
              style={{
                border: 'none',
                background: orderScope !== 'all' && activeMode === 'ecommerce' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'none',
                color: orderScope !== 'all' && activeMode === 'ecommerce' ? '#fff' : '#64748b',
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
              onClick={() => chooseMode('quick')}
              style={{
                border: 'none',
                background: orderScope !== 'all' && activeMode === 'quick' ? 'linear-gradient(135deg, #10b981, #047857)' : 'none',
                color: orderScope !== 'all' && activeMode === 'quick' ? '#fff' : '#64748b',
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
            <button type="button" aria-pressed={orderScope === 'all'} onClick={() => setOrderScope('all')} style={{ border: 0, padding: '6px 12px', borderRadius: 10, background: orderScope === 'all' ? '#073b78' : 'transparent', color: orderScope === 'all' ? '#fff' : '#64748b', cursor: 'pointer', fontWeight: 700 }}>All storefronts</button>
          </div>
        </div>
      )}

      {/* KPI Cards ("Chips") */}
      <div className="order-kpi-grid">
        {/* Card 1: Total Orders */}
        <div 
          className="order-kpi-card" 
          onClick={() => setTab('all')}
          style={{ border: tab === 'all' ? '1.5px solid #2563eb' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: '#f1f5f9',
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
              <line x1="12" y1="22.08" x2="12" y2="12"></line>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              TOTAL ORDERS
            </span>
            <span style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {totalOrdersCount}
            </span>
          </div>
        </div>

        {/* Card 2: Pending */}
        <div 
          className="order-kpi-card" 
          onClick={() => setTab('pending')}
          style={{ border: tab === 'pending' ? '1.5px solid #f59e0b' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: '#fef3c7',
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              PENDING
            </span>
            <span style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {pendingOrdersCount}
            </span>
          </div>
        </div>

        {/* Card 3: Confirmed */}
        <div 
          className="order-kpi-card" 
          onClick={() => setTab('confirmed')}
          style={{ border: tab === 'confirmed' ? '1.5px solid #2563eb' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: '#dbeafe',
            color: '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              CONFIRMED
            </span>
            <span style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {confirmedOrdersCount}
            </span>
          </div>
        </div>

        {/* Card 4: Delivered */}
        <div 
          className="order-kpi-card" 
          onClick={() => setTab('delivered')}
          style={{ border: tab === 'delivered' ? '1.5px solid #10b981' : '1.5px solid #f1f5f9' }}
        >
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: '#dcfce7',
            color: '#15803d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 10, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>
              DELIVERED
            </span>
            <span style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              {deliveredOrdersCount}
            </span>
          </div>
        </div>
      </div>

      {/* Search Input Bar */}
      <div style={{
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#fff',
        border: '1.5px solid #e2e8f0',
        borderRadius: 12,
        padding: '10px 16px'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input 
          type="text" 
          placeholder="Search by Order ID or Customer name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            background: 'none',
            fontSize: 13,
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

      <div className="seller-scroll-tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            className={`seller-tab-btn ${tab === t.value ? 'active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="orders-tab-list">
        {ordersLoading ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            Loading your orders…
          </div>
        ) : ordersError ? (
          <div style={{ padding: '40px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 700, marginBottom: 10 }}>{ordersError}</div>
            <button className="seller-tab-btn" onClick={() => fetchSellerOrders()}>Try again</button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="🧾"
            title={tab === 'all' ? 'No orders yet' : 'Nothing in this stage'}
            message={
              tab === 'all'
                ? 'Orders appear here as soon as customers start buying from your store.'
                : 'No orders are currently at this stage.'
            }
          />
        ) : (
          shown.map((order) => {
            const pill = PILL[order.status] || PILL.placed;
            return (
              <div key={order._id} className="order-fulfillment-card">
                <div className="order-f-header">
                  <span className="order-f-id">{order.orderNo}{order.salesChannel === 'wholesale' ? ' · Wholesale' : ''}</span>
                  <span
                    className="order-f-status-pill"
                    style={{ backgroundColor: pill.bg, color: pill.fg }}
                  >
                    {order.displayStatus || LABEL[order.status] || order.status}
                  </span>
                </div>

                <div className="order-f-body">
                  <div className="order-f-customer">
                    <h4>{order.customer?.name || 'Customer'}</h4>
                    <p>
                      {fmt(order.placedAt)} • {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                      {order.customer?.city ? ` • ${order.customer.city}` : ''}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <small>{sellerOrderTotal(order).label}</small>
                    <div className="order-f-amount">{money(sellerOrderTotal(order).value)}</div>
                    {order.sellerAmounts?.totalDiscount > 0 && <small>Discount: {money(order.sellerAmounts.totalDiscount)}</small>}
                  </div>
                </div>

                {/* A Same-Day job carries a promise the shop has to pack against,
                    so it says so on the card rather than looking like any other
                    Shop All order. */}
                {order.deliveryMode === 'same_day' && (
                  <div className="order-f-customer" style={{ paddingTop: 0 }}>
                    <p style={{ fontSize: 11, color: '#166534', fontWeight: 800 }}>
                      ⚡ Same-day — a rider collects this
                      {order.promisedBy
                        ? ` · by ${new Date(order.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
                        : ''}
                    </p>
                  </div>
                )}

                {/* The courier and waybill, once there is one — the customer is
                    shown the same two strings on their tracking screen. */}
                {order.shiprocket?.awb && (
                  <div className="order-f-customer" style={{ paddingTop: 0 }}>
                    <p style={{ fontSize: 11 }}>
                      📦 {order.shiprocket.courier} • {order.shiprocket.awb}
                    </p>
                  </div>
                )}

                {(order.returnReason || order.returnDescription || order.returnRequest) && (
                  <div className="order-f-customer" style={{ paddingTop: 0 }}>
                    <p style={{ fontSize: 11, color: '#c2410c', background: '#fff7ed', padding: '6px 10px', borderRadius: 8, margin: '4px 0', border: '1px solid #fed7aa', lineHeight: 1.4 }}>
                      ↩️ <strong>Return requested:</strong> {String(order.returnReason || order.returnRequest?.reason || '').replace(/_/g, ' ')}
                      {(order.returnDescription || order.returnRequest?.customerDescription) ? ` — “${order.returnDescription || order.returnRequest?.customerDescription}”` : ''}
                    </p>
                  </div>
                )}

                <div className="order-f-actions">
                  <button className="order-action-btn-sm details" onClick={() => openSellerOrder(order._id)}>
                    Details
                  </button>
                  {actionsFor(order).map((action) => (
                    <button
                      key={action.to + action.label}
                      className="order-action-btn-sm"
                      disabled={busyId === order._id}
                      onClick={() => onAction(order, action)}
                    >
                      {busyId === order._id ? 'Working…' : action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      </>}
      {detailPage && <><div className="seller-order-topbar"><button type="button" className="order-action-btn-sm" aria-label="Close order details" onClick={closeSellerOrder}>← Back to orders</button></div>
        {orderDetailLoading && <p role="status">Loading latest order…</p>}
        {orderDetailError && <div role="alert"><p>{orderDetailError}</p><button type="button" onClick={() => openSellerOrder(orderDetailId)}>Retry loading order</button></div>}
        {selected && <header className="seller-order-hero">
          <div><span className="seller-order-eyebrow">{selected.salesChannel === 'wholesale' ? 'Wholesale order' : selected.channel === 'grocery' ? 'Quick Commerce order' : 'E-Commerce order'}</span>
            <h1>Order {selected.orderNo}</h1><p>Placed {fmt(selected.placedAt || selected.createdAt)}</p></div>
          <div className="seller-order-hero-meta"><span className="seller-order-status" style={{ background: PILL[selected.status]?.bg || '#f1f5f9', color: PILL[selected.status]?.fg || '#475569' }}>{LABEL[selected.displayStatus || selected.status] || String(selected.displayStatus || selected.status).replaceAll('_', ' ')}</span>
            <span>{selected.paymentMethod} · {selected.paymentStatus || 'Payment status unavailable'}</span></div>
          <div className="seller-order-primary-actions">{actionsFor(selected).filter(action => !action.setup || action.label === 'Reassign delivery partner').map(action => <button type="button" key={action.label} disabled={busyId === selected._id || orderDetailLoading}
            className="order-action-btn-sm" onClick={() => onAction(selected, action)}>{action.label}</button>)}</div>
        </header>}
      </>}
      {/* Courier hand-off. Asked for once, at the only moment it is knowable. */}
      {dispatching && (
        <ModalPortal className="seller-modal-overlay">
          <div className="seller-modal-sheet">
            <div className="modal-sheet-header">
              <h3 className="modal-sheet-title">Hand to courier</h3>
              <button className="modal-close-btn" onClick={() => setDispatching(null)}>✕</button>
            </div>

            <p style={{ fontSize: 12, color: '#64748b', padding: '0 0 14px' }}>
              {dispatching.orderNo} — once this parcel leaves your shop the tracking
              number is the only way the customer can follow it.
            </p>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Courier</label>
              <input
                className="onboarding-input"
                placeholder="e.g. Delhivery, Blue Dart, India Post"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
              />
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Tracking / AWB number</label>
              <input
                className="onboarding-input"
                placeholder="As printed on the courier's label"
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
              />
            </div>

            <button
              className="primary-onboarding-btn"
              style={{ width: '100%', marginTop: 8 }}
              disabled={busyId === dispatching._id}
              onClick={confirmDispatch}
            >
              {busyId === dispatching._id ? 'Saving…' : 'Confirm hand-off'}
            </button>
          </div>
        </ModalPortal>
      )}

      {fulfilling && fulfillmentOptions && (
        <section className="seller-delivery-methods" aria-label="Choose delivery method">
          <div>
            <div className="seller-delivery-heading"><div><span className="seller-order-eyebrow">Arrange fulfillment</span><h2>Choose delivery method</h2></div></div>
            <div className="seller-delivery-choices" role="group" aria-label="Delivery methods">
              <button type="button" aria-pressed={deliveryChoice === 'manual'} aria-controls="seller-manual-delivery" disabled={Boolean(busyId)} onClick={() => setDeliveryChoice('manual')}><span className="seller-delivery-choice-icon" aria-hidden="true"><Bike size={24} /></span><span><strong>Manual Delivery</strong><small>View active delivery boys</small></span><span className="seller-delivery-choice-indicator" aria-hidden="true">{deliveryChoice === 'manual' ? '✓' : '→'}</span></button>
              <button type="button" aria-pressed={deliveryChoice === 'shiprocket'} aria-controls="seller-shiprocket-delivery" disabled={Boolean(busyId)} onClick={() => setDeliveryChoice('shiprocket')}><span className="seller-delivery-choice-icon" aria-hidden="true"><Package size={24} /></span><span><strong>Use Shiprocket</strong><small>Courier delivery & tracking</small></span><span className="seller-delivery-choice-indicator" aria-hidden="true">{deliveryChoice === 'shiprocket' ? '✓' : '→'}</span></button>
            </div>
            {deliveryChoice === 'manual' && <div id="seller-manual-delivery" className="seller-delivery-panel" aria-label="Manual delivery">
              <div className="seller-rider-heading"><div><h3>Active delivery boys</h3><p>{fulfillmentOptions.manual?.eligibleRiderCount || 0} on-duty eligible riders for this order</p></div><button type="button" className="order-action-btn-sm" onClick={() => loadAvailability(fulfilling, true)} disabled={Boolean(busyId)}>Refresh availability</button></div>
              <div className="seller-rider-list" role="group" aria-label="Available delivery partners">{fulfillmentOptions.manual?.riders?.filter(rider => rider.online === true).map((rider, index) => <button type="button" className="seller-rider-card" key={rider.id || index} aria-pressed={Boolean(rider.id && String(selectedRiderId) === String(rider.id))} disabled={Boolean(busyId) || !rider.id} onClick={() => setSelectedRiderId(rider.id)}><span className="seller-rider-avatar" aria-hidden="true">{rider.name?.charAt(0)?.toUpperCase() || 'R'}</span><div><strong>{rider.name}</strong>{rider.contact && <span>{rider.contact}</span>}<small>{rider.availability}</small></div><span className="seller-rider-active">{rider.id && String(selectedRiderId) === String(rider.id) ? '✓ Selected' : 'Active'}</span></button>)}</div>
              {!fulfillmentOptions.manual?.riders?.some(rider => rider.online === true) && <div className="seller-rider-empty"><strong>No active delivery boys available</strong><p>Refresh availability to check for on-duty riders with capacity and coverage for this pickup.</p></div>}
              <p className="seller-delivery-help">Select a delivery partner to request them, or leave the choice open to eligible riders. Riders accept offers in their delivery app before they are assigned.</p>
            <button className="primary-onboarding-btn" style={{ width: '100%', marginTop: 12 }}
              disabled={!fulfillmentOptions.manual?.available || busyId === fulfilling._id}
              onClick={async () => {
                setBusyId(fulfilling._id);
                const result = await selectManualFulfillment(fulfilling._id, selectedRiderId);
                setBusyId(null); triggerToast?.(result.message);
                if (result.ok) { setFulfilling(null); await openSellerOrder(fulfilling._id); }
              }}>
              {busyId === fulfilling._id ? 'Saving…' : 'Confirm manual delivery'}
            </button>
            {!fulfillmentOptions.manual?.available && <p style={{ fontSize: 11, color: '#b45309' }}>{fulfillmentOptions.manual?.reason}</p>}
              <a className="seller-delivery-profile-link" href="/seller/profile">Check or update the store pickup location</a>
            </div>}

            {deliveryChoice === 'shiprocket' && <div id="seller-shiprocket-delivery" className="seller-delivery-panel" aria-label="Shiprocket delivery">
              <h3>Shiprocket shipment</h3>
              {fulfilling.channel === 'grocery' && <ShiprocketFeePayment key={fulfilling._id} orderId={fulfilling._id} provider={fulfillmentOptions.shiprocket || {}} onRefresh={() => loadAvailability(fulfilling, true)} />}
              <div className="seller-delivery-route"><div><span>Pickup from</span><p>{addressText(fulfillmentOptions.shiprocket?.verifiedPickup || fulfillmentOptions.pickup)}</p></div><span aria-hidden="true">→</span><div><span>Deliver to</span><p>{addressText(fulfillmentOptions.destination)}</p></div></div>
              {!fulfillmentOptions.shiprocket?.pickupLinked && <p><a href="/seller/profile">Check or retry pickup synchronization in your store profile</a></p>}
              <p style={{ fontSize: 11, color: '#64748b' }}>{fulfillmentOptions.shiprocket?.reason || 'Serviceability is checked before any shipment is created.'}</p>
              <p>Weight from order item snapshots: {fulfillmentOptions.shiprocket?.packageWeightKg || 'Unavailable'} kg</p>
              {fulfilling.channel !== 'grocery' && fulfillmentOptions.shiprocket?.quote && (
                <div style={{ fontSize: 12, marginBottom: 10, padding: 10, background: '#f8fafc', borderRadius: 8 }}>
                  <div><strong>Estimated courier freight:</strong> {money(fulfillmentOptions.shiprocket.quote.courierCharge)}</div>
                  {fulfilling.channel === 'ecommerce' && <div>Provider estimate only. The customer's checkout delivery charge stays unchanged; no additional customer charge or new vendor deduction is applied here.</div>}
                </div>
              )}
              {fulfillmentOptions.shiprocket?.activation?.blockers?.length > 0 && <div style={{ padding: 10, marginBottom: 10, borderRadius: 8, background: '#fff7ed', color: '#9a3412', fontSize: 11 }}>
                Live Quick third-party shipping is disabled: {fulfillmentOptions.shiprocket.activation.blockers.join('; ')}.
              </div>}
              <div className="seller-parcel-fields">{['length', 'breadth', 'height'].map((field) => (
                <label key={field}><span>{field[0].toUpperCase() + field.slice(1)} (cm)</span><input className="onboarding-input" style={{ marginBottom: 8 }} type="number" min="0.51" max="500" step="any"
                  placeholder={`${field[0].toUpperCase() + field.slice(1)} (cm)`} value={packageSize[field]}
                  onChange={(e) => setPackageSize((value) => ({ ...value, [field]: e.target.value }))} /></label>
              ))}</div>
              <button className="primary-onboarding-btn" style={{ width: '100%' }}
                disabled={!fulfillmentOptions.shiprocket?.available || !fulfillmentOptions.shiprocket?.quote || (fulfilling.channel === 'grocery' && fulfillmentOptions.shiprocket?.feeCollection?.status !== 'paid') || busyId === fulfilling._id}
                onClick={async () => {
                  if (Object.values(packageSize).some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0.5 || Number(value) > 500)) return triggerToast?.('Enter dimensions greater than 0.5 cm and at most 500 cm');
                  return ui.perform(`Create a Shiprocket shipment with estimated courier freight ${money(fulfillmentOptions.shiprocket.quote.courierCharge)}? The customer's total stays unchanged.`, async () => {
                  setBusyId(fulfilling._id);
                  const result = await createShiprocketShipment(fulfilling._id, packageSize, fulfillmentOptions.shiprocket.quote.courierCharge);
                  setBusyId(null); triggerToast?.(result.message);
                  if (result.ok) { setFulfilling(null); await openSellerOrder(fulfilling._id); }
                  return result;

});
}}>
                Create Shiprocket shipment
              </button>
            </div>}
          </div>
        </section>
      )}
      {detailPage && fulfilling && !fulfillmentOptions && <div className="seller-delivery-loading" role={fulfillmentError ? 'alert' : 'status'}>{fulfillmentError || 'Checking delivery eligibility…'} {fulfillmentError && <button type="button" className="order-action-btn-sm" onClick={() => loadAvailability(fulfilling, true)}>Retry delivery check</button>}</div>}

      {detailPage && selected && (
        <section aria-label="Order details">
          <OrderFinancialBreakdown orderId={selected._id} />
          {(selected.deliveredAt || selected.status === 'delivered') && <OrderInvoices label="View / print invoice" buttonClassName="order-action-btn-sm" load={async () => {
            const res = await fetch(apiUrl(`/api/sellers/orders/${selected._id}/invoice`), { headers: { Authorization: `Bearer ${getPortalToken('seller')}` } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.success === false || !body.data) throw new Error(body.message || 'Could not load the invoice');
            return [body.data];
          }} />}
          <div className="seller-order-page-content">
            {orderDetailSections(selected)}
            {actionsFor(selected).some(action => action.to === 'ready_for_pickup') && <p>Mark this parcel Ready for pickup to see both delivery methods and their eligibility.</p>}
          </div>
        </section>
      )}
    </div>
  );
};

export default OrdersTab;
