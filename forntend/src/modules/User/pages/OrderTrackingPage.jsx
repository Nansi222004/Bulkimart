import { orderDiscountRows } from '../../../utils/orderDiscounts';
import ModalPortal from '../../../components/ModalPortal';
import DeliveryPartnerRating from '../components/DeliveryPartnerRating';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { DeliveryMap } from '../../../components/DeliveryMap';
import { apiUrl } from '../../../utils/api';
import { socket } from '../../../utils/socket';
import { AttachmentUploader } from '../../../components/common/AttachmentPreview';
import { deliveryLabelFor, hasLiveRider, goesByCourier } from '../utils/deliveryLabel';

const STATUS_LABELS = {
  placed: 'Order Placed',
  confirmed: 'Confirmed by Store',
  preparing: 'Preparing Items',
  dispatched: 'Dispatched (Waiting for Rider)',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_DESCS = {
  placed: 'Your order has been successfully placed.',
  confirmed: 'Merchant is reviewing and confirming items.',
  preparing: 'Merchant is packaging your grocery items.',
  dispatched: 'Ready at merchant store. Dispatching rider.',
  out_for_delivery: 'Our delivery partner is bringing your order.',
  delivered: 'Order handed over successfully.',
  cancelled: 'This order was cancelled.',
};

export const OrderTrackingPage = () => {
  const ui = useFeedback();
  const { selectedOrder, setSelectedOrder, activeRider, returnPickupOtp, setReviewProductId, initiateOnlinePayment } = useUser();

  /**
   * Live tracking data, kept separate from the order itself.
   *
   * The order document has no coordinates for the shop and no rider position;
   * GET /orders/:id/track assembles both. Fetching it here rather than folding
   * it into the order list means the list stays cheap — most orders on that
   * screen are finished and have nothing to track.
   */
  const [track, setTrack] = useState(null);
  const [riderLive, setRiderLive] = useState(null);

  const orderId = selectedOrder?._id;

  useEffect(() => { setTrack(null); setRiderLive(null); }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(apiUrl(`/api/orders/${orderId}/track`), {
          headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setTrack(body.data || null);
      } catch { /* the page still works without the map */ }
    };

    load();

    /**
     * The socket carries every change; this poll is the safety net for the ones
     * it can miss — a tab that was backgrounded, a reconnect that dropped an
     * event. It stops once the order reaches a state that cannot change again,
     * so a delivered order does not keep the tab talking to the server for as
     * long as it is left open.
     */
    const settled = ['delivered', 'cancelled', 'returned', 'refunded'];
    const id = setInterval(() => {
      if (settled.includes(track?.status)) return;
      load();
    }, 15000);

    // A status change should land immediately, not on the next poll.
    const onStatus = (payload) => {
      if (String(payload.orderId) === String(orderId)) load();
    };
    socket.on('order_status_updated', onStatus);
    socket.on('rider_assigned', onStatus);
    socket.on('order_delivered', onStatus);
    // Reaching the store, collecting the parcel, arriving at the door — the
    // moments the customer most wants to see. Without this they only appeared
    // whenever the next poll happened to run.
    socket.on('delivery_status_updated', onStatus);
    socket.on('otp_ready', onStatus);

    return () => {
      cancelled = true;
      clearInterval(id);
      socket.off('order_status_updated', onStatus);
      socket.off('rider_assigned', onStatus);
      socket.off('order_delivered', onStatus);
      socket.off('delivery_status_updated', onStatus);
      socket.off('otp_ready', onStatus);
    };
  }, [orderId, track?.status]);

  // Movement arrives over the socket between polls.
  useEffect(() => {
    if (!orderId) return;

    const onMove = (payload) => {
      if (String(payload.orderId) !== String(orderId)) return;
      setRiderLive({ lat: payload.lat, lng: payload.lng, updatedAt: payload.at });
    };

    socket.on('location_update', onMove);
    return () => socket.off('location_update', onMove);
  }, [orderId]);

  /**
   * Rate & Review — one review per product per shopper, held for moderation.
   *
   * `reviewedProductIds` is read from the server (GET /api/products/reviews/mine),
   * not just tracked locally: a product bought in an earlier order, or already
   * reviewed from its own product page, must show as submitted here too — a
   * badge that only remembers this session's own clicks would offer the button
   * again on every refresh and the submit would fail with "already reviewed".
   */
  const [reviewedProductIds, setReviewedProductIds] = useState(new Set());
  const [reviewModalItem, setReviewModalItem] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFormError, setReviewFormError] = useState('');

  const productIdOf = (item) => String(item?.productId?._id || item?.productId || '');

  /**
   * Return & Refund — every figure and every status shown below comes from
   * the backend (Phase 4's item-level Return system): eligibility from
   * GET /api/orders/:id/items/:itemId/return-eligibility, existing requests
   * from GET /api/returns?orderId=. Nothing here computes a deadline, a
   * remaining quantity, or a status on its own — see Section 19 of the V1
   * spec ("React must NOT decide..."). `order.controller.js::requestReturn`
   * (the legacy whole-order action) is unrelated and untouched.
   */
  const [returnEligibilityByItem, setReturnEligibilityByItem] = useState({});
  const [returnsByItem, setReturnsByItem] = useState({});
  const [returnModalItem, setReturnModalItem] = useState(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState('DAMAGED');
  const [returnDescription, setReturnDescription] = useState('');
  const [returnFiles, setReturnFiles] = useState([]);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnFormError, setReturnFormError] = useState('');
  const [returnRequestKey, setReturnRequestKey] = useState('');
  const [viewingReturn, setViewingReturn] = useState(null);

  const authHeader = () => ({ Authorization: 'Bearer ' + localStorage.getItem('userToken') });

  const refreshReturnData = async () => {
    if (!selectedOrder || selectedOrder.status !== 'delivered') return;
    const items = selectedOrder.items || [];

    const [eligEntries, returnsRes] = await Promise.all([
      Promise.all(items.map(async (item) => {
        try {
          const res = await fetch(apiUrl(`/api/orders/${selectedOrder._id}/items/${item._id}/return-eligibility`), { headers: authHeader() });
          const body = await res.json().catch(() => ({}));
          return [item._id, res.ok ? body.data : { eligible: false }];
        } catch {
          return [item._id, { eligible: false }];
        }
      })),
      fetch(apiUrl(`/api/returns?orderId=${selectedOrder._id}`), { headers: authHeader() }).then((r) => r.json()).catch(() => ({ data: [] })),
    ]);

    setReturnEligibilityByItem(Object.fromEntries(eligEntries));

    const grouped = {};
    for (const ret of (returnsRes.data || [])) {
      const key = String(ret.orderItemId);
      (grouped[key] = grouped[key] || []).push(ret);
    }
    setReturnsByItem(grouped);
    return grouped;
  };

  useEffect(() => {
    refreshReturnData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?._id, selectedOrder?.status]);

  /**
   * While the return detail modal is open and its pickup is still ASSIGNED
   * (waiting on the OTP handover), keep polling — same fallback reasoning
   * as the refresh-on-open above, but for an OTP the rider generates AFTER
   * the customer already opened this screen.
   */
  useEffect(() => {
    if (!viewingReturn || viewingReturn.pickup?.status !== 'ASSIGNED') return;
    const id = setInterval(async () => {
      const grouped = await refreshReturnData();
      const fresh = Object.values(grouped || {}).flat().find((r) => r._id === viewingReturn._id);
      if (fresh) setViewingReturn(fresh);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingReturn?._id, viewingReturn?.pickup?.status]);

  const openReturnModal = (item) => {
    setReturnRequestKey(crypto.randomUUID());
    const eligibility = returnEligibilityByItem[item._id];
    setReturnModalItem(item);
    setReturnQty(1);
    setReturnReason('DAMAGED');
    setReturnDescription('');
    setReturnFiles([]);
    setReturnFormError('');
    if (!eligibility?.eligible) setReturnFormError(eligibility?.reason || 'This item is no longer eligible for return.');
  };

  const submitReturn = async () => {
    if (!returnModalItem) return;
    if (returnReason === 'OTHER' && !returnDescription.trim()) {
      setReturnFormError('Please describe the issue when selecting "Other".');
      return;
    }
    setSubmittingReturn(true);
    setReturnFormError('');
    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Please sign in to request a return.');

      const fd = new FormData();
      fd.append('orderId', selectedOrder._id);
      fd.append('orderItemId', returnModalItem._id);
      fd.append('quantity', String(returnQty));
      fd.append('reason', returnReason);
      if (returnDescription.trim()) fd.append('customerDescription', returnDescription.trim());
      returnFiles.forEach((f) => fd.append('attachments', f));

      const res = await fetch(apiUrl('/api/returns'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': returnRequestKey }, body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not submit your return request');

      setReturnModalItem(null);
      // Server state is the only source of truth — refetch rather than
      // guess what the new eligibility/return list looks like.
      await refreshReturnData();
      ui.notify(`Return ${body.data.returnNumber} requested.`);
    } catch (err) {
      setReturnFormError(err.message || 'Error submitting return request');
    } finally {
      setSubmittingReturn(false);
    }
  };

  /**
   * The return/reverse-pickup stages, shown as a CONTINUATION of the same
   * "Fulfillment Live Timeline" stepper below "Delivered" — not a separate
   * widget — so a return reads as the next chapter of the same order
   * journey, matching how the rest of this page already treats delivery.
   */
  const RETURN_TIMELINE_STEPS = [
    { key: 'RETURN_REQUESTED', label: 'Return Requested', desc: 'Your return request was submitted.' },
    { key: 'UNDER_REVIEW', label: 'Under Review', desc: 'Admin is reviewing your request.' },
    { key: 'APPROVED', label: 'Return Approved', desc: 'Your return was approved.' },
    { key: 'ASSIGNED', label: 'Rider Assigned', desc: 'A delivery partner will collect the item from you.' },
    { key: 'PICKED_UP', label: 'Picked Up', desc: 'Item collected — on its way back to the seller.' },
    { key: 'DELIVERED_TO_SELLER', label: 'Returned to Seller', desc: 'Item has reached the seller.' },
    { key: 'RETURN_RECEIVED', label: 'Return Received', desc: 'Seller/Admin confirmed the item was received.' },
    { key: 'REFUND_PENDING', label: 'Refund Processing', desc: 'Your refund is being processed.' },
    { key: 'REFUNDED', label: 'Refunded', desc: 'Refund completed.' },
  ];

  /**
   * QUICK COMMERCE ONLY (for the ASSIGNED/PICKED_UP/DELIVERED_TO_SELLER
   * steps — an E-commerce return has no rider leg, so `ret.pickup` is
   * simply absent there and this collapses back to the plain status).
   * Combines `ret.status` (the refund/approval workflow) and
   * `ret.pickup.status` (the physical reverse pickup) into ONE position on
   * the stepper above — they're deliberately separate fields on the
   * backend (Return.js's `pickup` comment) but the customer reads them as
   * one continuous journey, not two.
   */
  const returnTimelineKeyFor = (ret) => {
    if (['RETURN_RECEIVED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'].includes(ret.status)) {
      return ret.status === 'REFUND_FAILED' ? 'REFUND_PENDING' : ret.status;
    }
    if (['APPROVED', 'AWAITING_RETURN'].includes(ret.status) && ret.pickup?.status && ret.pickup.status !== 'NOT_ASSIGNED' && ret.pickup.status !== 'CANCELLED') {
      return ret.pickup.status; // ASSIGNED / PICKED_UP / DELIVERED_TO_SELLER
    }
    return ret.status; // RETURN_REQUESTED / UNDER_REVIEW / APPROVED / AWAITING_RETURN
  };

  const RETURN_STATUS_LABEL = {
    RETURN_REQUESTED: 'Return requested',
    UNDER_REVIEW: 'Under review',
    APPROVED: 'Return approved',
    AWAITING_RETURN: 'Awaiting return',
    RETURN_RECEIVED: 'Return received',
    REFUND_PENDING: 'Refund pending',
    REFUND_FAILED: 'Refund pending — retrying',
    REFUNDED: 'Refund completed',
    REJECTED: 'Return rejected',
    CANCELLED: 'Return cancelled',
  };

  useEffect(() => {
    if (!selectedOrder || selectedOrder.status !== 'delivered') return;
    const ids = [...new Set((selectedOrder.items || []).map(productIdOf).filter(Boolean))];
    if (ids.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/products/reviews/mine?productIds=${ids.join(',')}`), {
          headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') },
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setReviewedProductIds(new Set(body.data?.reviewedProductIds || []));
        }
      } catch { /* the buttons still work — a failed check just re-asks the server on submit */ }
    })();

    return () => { cancelled = true; };
  }, [selectedOrder?._id, selectedOrder?.status]);

  const openReviewModal = (item) => {
    setReviewModalItem(item);
    setReviewRating(5);
    setReviewComment('');
    setReviewFormError('');
  };

  const submitReview = async () => {
    if (!reviewModalItem) return;
    const productId = productIdOf(reviewModalItem);
    if (!productId) { setReviewFormError('This item has no product to review.'); return; }

    setSubmittingReview(true);
    setReviewFormError('');
    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Please sign in to leave a review.');

      const res = await fetch(apiUrl(`/api/products/${productId}/reviews`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment.trim() }),
      });
      const body = await res.json().catch(() => ({}));

      // A product this shopper already reviewed (from the product page, or a
      // past order for the same item) reaches the same end state as a fresh
      // submission — the badge is about "is one on file", not "did this
      // exact click create it".
      if (!res.ok && !/already reviewed/i.test(body.message || '')) {
        throw new Error(body.message || 'Could not submit your review');
      }

      setReviewedProductIds((prev) => new Set([...prev, productId]));
      setReviewModalItem(null);
      ui.notify(res.ok
        ? 'Thank you! Your review has been submitted for admin approval.'
        : 'You have already reviewed this product.');
    } catch (err) {
      setReviewFormError(err.message || 'Error submitting review');
    } finally {
      setSubmittingReview(false);
    }
  };

  if (!selectedOrder) return null;

  // Sync timeline steps dynamically based on current order status
  const statusSequence = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery', 'delivered'];

  /**
   * The tracking endpoint wins over the order in hand.
   *
   * `selectedOrder` is a row copied out of the orders list when the customer
   * tapped it, and it is never refreshed. So a shop that confirmed the order a
   * minute later left this screen insisting "Order Placed" for ever — the
   * timeline froze and the map, gated on the status, never appeared at all.
   */
  const currentStatus = track?.status || selectedOrder.status || 'placed';
  const isCancelled = currentStatus === 'cancelled';
  const currentIndex = statusSequence.indexOf(currentStatus);

  /**
   * Who is carrying this, and what the customer was promised.
   *
   * The map used to be gated on "is this Quick?", which was right while Shop All
   * meant courier. It no longer is: a Same-Day order is Shop All and is
   * collected by one of our riders, so gating on the storefront would hide the
   * live map, the moving pin and the delivery code from a customer who paid for
   * exactly that. The carrier is the question.
   *
   * `deliveryLabel` comes from the order's own frozen record, so a shop turning
   * Same-Day off tomorrow cannot retitle an order that already went out today.
   */
  const liveRider = hasLiveRider(track, selectedOrder);
  const byCourier = goesByCourier(track, selectedOrder);
  const deliveryLabel = deliveryLabelFor(track) || deliveryLabelFor(selectedOrder);

  const displayAddr = selectedOrder.shippingAddress || {};
  const addrText = `${displayAddr.line1 || displayAddr.address || ''}${displayAddr.line2 ? ', ' + displayAddr.line2 : ''}, ${displayAddr.city || ''} - ${displayAddr.pincode || ''}`;

  const formatTime = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div
      className="order-tracking-page-container"
      style={{
        position: 'absolute',
        inset: 0,
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Outfit', sans-serif",
        overflowY: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1.5px solid var(--border-color)',
        position: 'sticky',
        top: 0,
        background: '#fff',
        zIndex: 10
      }}>
        <button 
          onClick={() => setSelectedOrder(null)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-primary)'
          }}
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h3 style={{ margin: '0 auto 0 8px', fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Track Order
        </h3>
      </div>

      {/* Main Content Area */}
      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status card */}
        <div className="profile-menu-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>ORDER NUMBER</span>
            {/*
              How this order was delivered, named from its own record.

              This said "Standard Delivery" for everything that was not Quick —
              which a Same-Day customer, who paid ₹40 for a rider to bring it
              today, would read as a different product from the one they bought.
              The mode is frozen on the order at checkout, so the label holds for
              the whole lifecycle and does not change if the shop's settings do.

              Orders placed before delivery modes existed have none to show; the
              carrier is the closest true thing left, so they fall back to it.
            */}
            <span style={{
              fontSize: 12, fontWeight: 800, borderRadius: 20, padding: '2px 8px',
              color: deliveryLabel?.tone === 'sameday' ? '#166534' : 'var(--primary)',
              background: deliveryLabel?.tone === 'sameday' ? '#dcfce7' : 'var(--primary-light)',
            }}>
              {selectedOrder.type === 'grocery'
                ? 'Quick Commerce'
                : deliveryLabel
                  ? `${deliveryLabel.icon} ${deliveryLabel.text}`
                  : (byCourier ? '📦 Scheduled Delivery' : 'Delivery')}
            </span>
          </div>
          <strong style={{ fontSize: 18, color: 'var(--text-primary)' }}>{selectedOrder.orderNo || selectedOrder._id}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Placed on {formatDate(selectedOrder.createdAt)} at {formatTime(selectedOrder.createdAt)}</span>
        </div>

        {/*
          The map appears the moment the store accepts, not when a rider is
          found. Between those two points it shows the shop, the destination and
          an "assigning a partner" banner — the customer can see their order is
          real and moving, instead of a blank panel that reads like nothing is
          happening.
        */}
        {liveRider && ['confirmed', 'preparing', 'dispatched', 'out_for_delivery'].includes(currentStatus) && (
          <>
          <DeliveryMap
            pickup={track?.pickup}
            drop={track?.drop}
            status={currentStatus}
            stage={track?.stage}
            etaMin={track?.route?.durationMin}
            rider={
              track?.rider
                ? {
                    ...track.rider,
                    // Socket pings are fresher than the last poll, so they win.
                    location: riderLive || track.rider.location,
                  }
                : null
            }
            height={260}
          />

          {/*
            The delivery code.
            Read from the tracking response rather than from socket state, so it
            survives a refresh — losing it meant the customer could not tell the
            rider the number, and the delivery could not be completed at all.
          */}
          {track?.deliveryOtp && (
            <div style={{
              marginTop: 12, padding: 16, borderRadius: 12, textAlign: 'center',
              background: 'var(--primary-light)', border: '2px dashed var(--primary)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Share this code with your delivery partner
              </div>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 10, color: 'var(--text-primary)', margin: '8px 0 4px' }}>
                {track.deliveryOtp}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                Only give it once your order is in your hands
              </div>
            </div>
          )}
          </>
        )}

        {/*
          Shop All has no map, and should not pretend otherwise.

          A parcel with a courier is not followable minute by minute — there is
          no rider pinging a position, and inventing a moving dot would be a lie.
          What the customer can actually use is the courier's name and the
          waybill number, which is exactly what the shop entered at hand-off.
        */}
        {byCourier && track?.shiprocket?.awb && (
          <div style={{
            padding: 16, borderRadius: 12, marginBottom: 12,
            background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              On its way with {track.shiprocket.courier}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1.5, color: 'var(--text-primary)', margin: '6px 0 4px' }}>
              {track.shiprocket.awb}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
              Quote this tracking number to {track.shiprocket.courier}
            </div>
            {track.shiprocket.trackingUrl && (
              <a
                href={track.shiprocket.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', marginTop: 10, fontSize: 12, fontWeight: 800,
                  color: 'var(--primary)', textDecoration: 'underline',
                }}
              >
                Track on the courier's site
              </a>
            )}
          </div>
        )}

        {/* Shop All, packed but not yet handed over. */}
        {byCourier && !track?.shiprocket?.awb
          && ['confirmed', 'preparing'].includes(currentStatus) && (
          <div style={{
            padding: 14, borderRadius: 12, marginBottom: 12,
            background: 'var(--bg-secondary, #f8fafc)', border: '1.5px dashed var(--border-color, #cbd5e1)',
            fontSize: 12, color: 'var(--text-muted)', fontWeight: 600,
          }}>
            📦 The store is packing your order. A tracking number will appear here
            once it is handed to the courier.
          </div>
        )}

        {/* Rider detail card — only once somebody is actually carrying it. */}
        {currentStatus === 'out_for_delivery' && activeRider && String(activeRider.orderId) === String(selectedOrder._id) && (
          <div style={{
            padding: 16,
            background: 'var(--primary-light)',
            border: '1.5px solid var(--primary)',
            borderRadius: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                🛵 Active Rider Delivery
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--primary)', color: '#fff' }}>
                {activeRider.step === 'pickup' ? 'Heading to Merchant' : activeRider.step === 'arrived' ? 'At Merchant Store' : 'On the way to you'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                🛵
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>{activeRider.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{activeRider.vehicleType?.toUpperCase()} • {activeRider.phone}</div>
              </div>
            </div>

            {/* OTP box below rider info */}
            {activeRider.otp && (
              <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1.5px dashed var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>DELIVERY OTP</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--primary)', letterSpacing: 3 }}>{activeRider.otp}</div>
              </div>
            )}
          </div>
        )}

        {/* Timeline tracker */}
        <div className="profile-menu-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            Fulfillment Live Timeline
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {isCancelled ? (
              <div style={{ display: 'flex', gap: 12, position: 'relative' }}>
                <div style={{ 
                  width: 20, 
                  height: 20, 
                  borderRadius: '50%', 
                  background: '#dc2626', 
                  border: '2px solid #dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  zIndex: 2,
                  fontWeight: 800
                }}>
                  ✗
                </div>
                <div>
                  <h4 style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
                    Cancelled
                  </h4>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                    {selectedOrder.cancelReason || 'This order was cancelled.'}
                  </p>
                </div>
              </div>
            ) : (
              [
                { label: 'Order Placed', desc: 'We have received your order.', status: 'placed' },
                { label: 'Confirmed', desc: 'Seller has accepted your order.', status: 'confirmed' },
                // "Preparing" is not shown. It is still a real status the shop
                // moves through — it just says nothing a customer can act on,
                // sitting between "accepted" and "ready".
                { label: 'Dispatched', desc: 'Ready for rider pickup.', status: 'dispatched' },
                { label: 'Out for Delivery', desc: 'Rider is on the way to your address.', status: 'out_for_delivery' },
                { label: 'Delivered', desc: 'Order successfully delivered.', status: 'delivered' }
              ].map((step, idx) => {
                /**
                 * Compare positions in the status sequence, not positions in
                 * this array.
                 *
                 * `idx <= currentIndex` silently tied the two lists together:
                 * dropping a row from the display shifted every index below it,
                 * and steps the order had not reached yet would have lit up
                 * green. Asking where the step's *status* sits means the two can
                 * differ freely.
                 */
                const stepIndex = statusSequence.indexOf(step.status);
                const isDone = stepIndex !== -1 && stepIndex <= currentIndex;
                const dbTimelineEntry = selectedOrder.timeline?.find(t => t.status === step.status);
                const timeText = dbTimelineEntry 
                  ? formatTime(dbTimelineEntry.timestamp)
                  : null;

                return (
                  <div key={idx} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                    {/* Timeline connector line */}
                    {idx < 5 && (
                      <div style={{ 
                        position: 'absolute', 
                        left: 9, 
                        top: 20, 
                        bottom: -22, 
                        width: 2, 
                        background: isDone && (idx < currentIndex) ? 'var(--primary)' : '#e2e8f0' 
                      }} />
                    )}
                    
                    {/* Dot */}
                    <div style={{ 
                      width: 20, 
                      height: 20, 
                      borderRadius: '50%', 
                      background: isDone ? 'var(--primary)' : '#fff', 
                      border: `2px solid ${isDone ? 'var(--primary)' : '#cbd5e1'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 10,
                      zIndex: 2,
                      fontWeight: 800
                    }}>
                      {isDone && '✓'}
                    </div>

                    <div>
                      <h4 style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: isDone ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {step.label}
                      </h4>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                        {step.desc} {timeText && `• ${timeText}`}
                      </p>
                    </div>
                  </div>
                );
              })
            )}

            {/*
              Return & Refund — a CONTINUATION of the same stepper above,
              never a separate widget. One mini-sequence per return on this
              order (usually one, but an order can have more than one item
              returned separately).
            */}
            {!isCancelled && Object.values(returnsByItem).flat().map((ret) => {
              if (['REJECTED', 'CANCELLED'].includes(ret.status)) {
                return (
                  <div key={ret._id} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#dc2626', border: '2px solid #dc2626',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, zIndex: 2, fontWeight: 800,
                    }}>
                      ✗
                    </div>
                    <div>
                      <h4 style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
                        {ret.status === 'REJECTED' ? 'Return Rejected' : 'Return Cancelled'} — {ret.productName}
                      </h4>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                        {ret.rejectionReason || `Return ${ret.returnNumber} did not proceed.`}
                      </p>
                    </div>
                  </div>
                );
              }

              const rawKey = returnTimelineKeyFor(ret);
              const normalizedKey = rawKey === 'AWAITING_RETURN' ? 'APPROVED' : rawKey;
              const returnCurrentIndex = RETURN_TIMELINE_STEPS.findIndex((s) => s.key === normalizedKey);

              return (
                <React.Fragment key={ret._id}>
                  <div style={{ margin: '4px 0 -6px 32px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Return — {ret.productName} ({ret.returnNumber})
                  </div>
                  {RETURN_TIMELINE_STEPS.map((step, idx) => {
                    const isDone = returnCurrentIndex !== -1 && idx <= returnCurrentIndex;
                    const isLast = idx === RETURN_TIMELINE_STEPS.length - 1;
                    return (
                      <div key={step.key} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                        {!isLast && (
                          <div style={{
                            position: 'absolute', left: 9, top: 20, bottom: -22, width: 2,
                            background: isDone && idx < returnCurrentIndex ? 'var(--primary)' : '#e2e8f0',
                          }} />
                        )}
                        <div style={{
                          width: 20, height: 20, borderRadius: '50%', background: isDone ? 'var(--primary)' : '#fff',
                          border: `2px solid ${isDone ? 'var(--primary)' : '#cbd5e1'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, zIndex: 2, fontWeight: 800,
                        }}>
                          {isDone && '✓'}
                        </div>
                        <div>
                          <h4 style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: isDone ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {step.label}
                          </h4>
                          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>{step.desc}</p>
                          {step.key === 'ASSIGNED' && (normalizedKey === 'ASSIGNED' || ret.pickup?.status === 'ASSIGNED') && (() => {
                            const otp = (returnPickupOtp?.returnId === ret._id ? returnPickupOtp.otp : null) || ret.pickup?.otp;
                            return otp ? (
                              <div style={{
                                background: '#f0fdf4',
                                padding: '10px 14px',
                                borderRadius: 10,
                                border: '1.5px dashed #16a34a',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                margin: '8px 0 4px',
                                maxWidth: 280,
                                boxSizing: 'border-box',
                                boxShadow: '0 2px 6px rgba(22,163,74,0.08)'
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 10, fontWeight: 800, color: '#15803d', letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.2 }}>
                                    PICKUP CODE
                                  </div>
                                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2, whiteSpace: 'nowrap' }}>
                                    Share code with rider
                                  </div>
                                </div>
                                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a', letterSpacing: 2, flexShrink: 0 }}>
                                  {otp}
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                                Waiting for the rider to request your pickup code…
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Address card */}
        <div className="profile-menu-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Shipping Address
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4, display: 'block', fontSize: 13 }}>
            {addrText}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
            Recipient: {displayAddr.name} • {displayAddr.phone}
          </span>
        </div>

        {currentStatus === 'delivered' && <DeliveryPartnerRating key={orderId} orderId={orderId}
          riderName={track?.rider?.name} deliveryRating={track?.deliveryRating}
          onRated={rating => setTrack(previous => ({ ...previous, deliveryRating: { ...previous?.deliveryRating, rating } }))} />}

        {/* Items Summary card */}
        <div className="profile-menu-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Items Summary
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {selectedOrder.items?.map((item, idx) => {
              const productId = productIdOf(item);
              const isReviewed = reviewedProductIds.has(productId);
              return (
                <div
                  key={idx}
                  style={{
                    padding: '10px 0',
                    borderBottom: idx < selectedOrder.items.length - 1 ? '1px solid #f1f5f9' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center', gap: 10 }}>
                    {item.image && (
                      <img src={item.image} alt={item.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>{item.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Qty: {item.qty} • ₹{item.price} each</span>
                    </div>
                    <strong style={{ color: 'var(--text-primary)' }}>₹{item.qty * item.price}</strong>
                  </div>

                  {/* Only a delivered order's items can be rated — there is
                      nothing to review about something not yet received. */}
                  {currentStatus === 'delivered' && (
                    <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                      {isReviewed ? (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: '#16a34a', backgroundColor: '#f0fdf4',
                          padding: '4px 10px', borderRadius: 20,
                        }}>
                          ✓ Reviewed
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            const pId = productIdOf(item);
                            if (pId && setReviewProductId) {
                              setReviewProductId(String(pId));
                            }
                          }}
                          style={{
                            backgroundColor: '#fff', border: '1.5px solid var(--primary)', color: 'var(--primary)',
                            borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                          }}
                        >
                          ⭐ Rate &amp; Review
                        </button>
                      )}
                    </div>
                  )}

                  {/* Return & Refund — server-authoritative; see refreshReturnData above. */}
                  {currentStatus === 'delivered' && (() => {
                    const existing = returnsByItem[item._id] || [];
                    const eligibility = returnEligibilityByItem[item._id];
                    return (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        {existing.map((ret) => (
                          <button
                            key={ret._id}
                            onClick={async () => {
                              setViewingReturn(ret);
                              // Refresh on open — the socket-only OTP push
                              // (return_pickup_otp_ready) can be missed by a
                              // reconnected/backgrounded tab; this is the
                              // fallback that picks it (and any pickup
                              // status change) back up from the server.
                              const grouped = await refreshReturnData();
                              const fresh = (grouped?.[item._id] || []).find((r) => r._id === ret._id);
                              if (fresh) setViewingReturn(fresh);
                            }}
                            style={{
                              fontSize: 11, fontWeight: 700,
                              color: ret.status === 'REJECTED' ? '#b91c1c' : ret.status === 'REFUNDED' ? '#16a34a' : '#92400e',
                              backgroundColor: ret.status === 'REJECTED' ? '#fef2f2' : ret.status === 'REFUNDED' ? '#f0fdf4' : '#fffbeb',
                              border: 'none', padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                            }}
                          >
                            {RETURN_STATUS_LABEL[ret.status] || ret.status} ({ret.quantity}) ›
                          </button>
                        ))}

                        {eligibility?.eligible && eligibility.maxReturnableQuantity > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                              Return available until {formatDate(eligibility.returnEligibleUntil)}
                            </span>
                            <button
                              onClick={() => openReturnModal(item)}
                              style={{
                                backgroundColor: '#fff', border: '1.5px solid #b45309', color: '#b45309',
                                borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                              }}
                            >
                              ↩ Return Item
                            </button>
                          </div>
                        )}
                        {eligibility && !eligibility.eligible && existing.length === 0 && (
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                            {eligibility.code === 'RETURN_WINDOW_EXPIRED' ? 'Return window expired' : 'Non-returnable'}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {/* Price Breakdown card */}
        <div className="profile-menu-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Bill Details
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
            <span style={{ color: 'var(--text-primary)' }}>₹{selectedOrder.pricing?.subtotal || 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Delivery Charge</span>
            <span style={{ color: 'var(--text-primary)' }}>₹{selectedOrder.pricing?.deliveryCharge || 0}</span>
          </div>
          {orderDiscountRows(selectedOrder.pricing).map(([title, amount]) => (
            <div key={title} style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981' }}>
              <span>{title}</span><span>-₹{amount.toFixed(2)}</span>
            </div>
          ))}
          {selectedOrder.pricing?.donationAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 700 }}>
              <span>{selectedOrder.pricing.donationTitle || 'Social Work Contribution'}</span>
              <span>+₹{selectedOrder.pricing.donationAmount}</span>
            </div>
          )}
          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14 }}>
            <span style={{ color: 'var(--text-primary)' }}>Total Amount</span>
            <span style={{ color: 'var(--text-primary)' }}>₹{selectedOrder.pricing?.totalAmount || 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
            <span>Payment Method</span>
            <span style={{ textTransform: 'uppercase' }}>{selectedOrder.paymentMethod}</span>
          </div>
        </div>
      </div>
      
      {/* Footer spacer */}
      <div style={{ height: 40 }} />

      {/* Rate & Review modal */}
      {reviewModalItem && (
        <ModalPortal
          className="user-action-modal"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px 12px 16px 12px',
            boxSizing: 'border-box',
          }}
          onClick={() => !submittingReview && setReviewModalItem(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 20,
              width: '100%',
              maxWidth: 440,
              maxHeight: '90%',
              overflowY: 'auto',
              padding: 18,
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
              boxSizing: 'border-box',
              scrollbarWidth: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {reviewModalItem.image && (
                  <img
                    src={reviewModalItem.image}
                    alt={reviewModalItem.name}
                    style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }}
                  />
                )}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Rate this item
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {reviewModalItem.name}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setReviewModalItem(null)}
                disabled={submittingReview}
                aria-label="Close"
                style={{ border: 'none', background: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', padding: 2, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <svg
                  key={i}
                  onClick={() => setReviewRating(i)}
                  role="button"
                  aria-label={`Rate ${i} star${i === 1 ? '' : 's'}`}
                  width="34" height="34" viewBox="0 0 24 24"
                  fill={i <= reviewRating ? '#f59e0b' : '#e2e8f0'}
                  stroke="none"
                  style={{ cursor: 'pointer' }}
                >
                  <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                </svg>
              ))}
            </div>

            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Write your experience with this item..."
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12,
                border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            {reviewFormError && (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#b91c1c' }}>{reviewFormError}</p>
            )}

            <div className="user-form-actions" style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => setReviewModalItem(null)}
                disabled={submittingReview}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid #cbd5e1',
                  background: '#fff', color: '#475569', fontSize: 13, fontWeight: 800,
                  cursor: submittingReview ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={submittingReview}
                style={{
                  flex: 2, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: submittingReview ? '#94a3b8' : 'var(--primary)', color: '#fff',
                  fontSize: 13, fontWeight: 900, cursor: submittingReview ? 'not-allowed' : 'pointer',
                }}
              >
                {submittingReview ? 'Submitting…' : 'Submit Review'}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Return Item modal */}
      {returnModalItem && (
        <ModalPortal
          className="user-action-modal"
          style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '16px 12px', boxSizing: 'border-box' }}
          onClick={() => !submittingReturn && setReturnModalItem(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 440, maxHeight: '90%', overflowY: 'auto', padding: 18, boxShadow: '0 8px 30px rgba(0,0,0,0.25)', boxSizing: 'border-box' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {returnModalItem.image && <img src={returnModalItem.image} alt={returnModalItem.name} style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }} />}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Return Item</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{returnModalItem.name}</div>
                </div>
              </div>
              <button onClick={() => setReturnModalItem(null)} disabled={submittingReturn} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', padding: 2, lineHeight: 1 }}>✕</button>
            </div>

            {returnEligibilityByItem[returnModalItem._id]?.eligible ? (
              <>
                <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Quantity (max {returnEligibilityByItem[returnModalItem._id]?.maxReturnableQuantity})
                </label>
                <input
                  type="number" min={1} max={returnEligibilityByItem[returnModalItem._id]?.maxReturnableQuantity}
                  value={returnQty}
                  onChange={(e) => setReturnQty(Math.max(1, Math.min(Number(e.target.value) || 1, returnEligibilityByItem[returnModalItem._id]?.maxReturnableQuantity)))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 13, marginBottom: 14 }}
                />

                <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Reason</label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 13, marginBottom: 14, fontFamily: 'inherit' }}
                >
                  {['DAMAGED', 'DEFECTIVE', 'WRONG_PRODUCT', 'WRONG_SIZE', 'NOT_AS_DESCRIBED', 'MISSING_PARTS', 'QUALITY_ISSUE', 'OTHER'].map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>

                <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Description{returnReason === 'OTHER' ? ' (required)' : ' (optional)'}
                </label>
                <textarea
                  value={returnDescription}
                  onChange={(e) => setReturnDescription(e.target.value)}
                  placeholder="Tell us what went wrong..."
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', marginBottom: 14 }}
                />

                <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Evidence photos (optional, up to 5)
                </label>
                <AttachmentUploader
                  files={returnFiles}
                  onAddFiles={(selected) => setReturnFiles((prev) => [...(prev || []), ...selected].slice(0, 5))}
                  onRemoveFile={(idxToRemove) => setReturnFiles((prev) => (prev || []).filter((_, idx) => idx !== idxToRemove))}
                  maxFiles={5}
                />

                {returnFormError && <p style={{ margin: '0 0 10px', fontSize: 12, color: '#b91c1c' }}>{returnFormError}</p>}

                <div className="user-form-actions" style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setReturnModalItem(null)} disabled={submittingReturn} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1.5px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 800, cursor: submittingReturn ? 'not-allowed' : 'pointer' }}>Cancel</button>
                  <button onClick={submitReturn} disabled={submittingReturn} style={{ flex: 2, padding: '12px 0', borderRadius: 12, border: 'none', background: submittingReturn ? '#94a3b8' : '#b45309', color: '#fff', fontSize: 13, fontWeight: 900, cursor: submittingReturn ? 'not-allowed' : 'pointer' }}>
                    {submittingReturn ? 'Submitting…' : 'Submit Return Request'}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: '#b91c1c' }}>{returnFormError || 'This item is no longer eligible for return.'}</p>
            )}
          </div>
        </ModalPortal>
      )}

      {/* Return detail / timeline modal */}
      {viewingReturn && (
        <ModalPortal
          style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '16px 12px', boxSizing: 'border-box' }}
          onClick={() => setViewingReturn(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 440, maxHeight: '90%', overflowY: 'auto', padding: 18, boxShadow: '0 8px 30px rgba(0,0,0,0.25)', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{viewingReturn.returnNumber}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{viewingReturn.productName} × {viewingReturn.quantity}</div>
              </div>
              <button onClick={() => setViewingReturn(null)} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer', padding: 2, lineHeight: 1 }}>✕</button>
            </div>

            <p style={{ fontSize: 12.5, margin: '0 0 6px' }}><b>Status:</b> {RETURN_STATUS_LABEL[viewingReturn.status] || viewingReturn.status}</p>
            {viewingReturn.pickup && viewingReturn.pickup.status !== 'NOT_ASSIGNED' && (
              <p style={{ fontSize: 12.5, margin: '0 0 6px' }}>
                <b>Pickup:</b> {{
                  ASSIGNED: 'Rider assigned — on the way to you',
                  PICKED_UP: 'Picked up — returning to seller',
                  DELIVERED_TO_SELLER: 'Delivered back to the seller',
                  CANCELLED: 'Pickup cancelled',
                }[viewingReturn.pickup.status] || viewingReturn.pickup.status}
                {viewingReturn.pickup.riderName ? ` (${viewingReturn.pickup.riderName})` : ''}
              </p>
            )}
            {viewingReturn.pickup?.status === 'ASSIGNED' && (() => {
              // Prefer the live socket push; fall back to whatever the
              // last refresh (open + 5s poll above) fetched from the
              // server — the socket can be missed by a reconnected tab,
              // the poll cannot.
              const otp = (returnPickupOtp?.returnId === viewingReturn._id ? returnPickupOtp.otp : null) || viewingReturn.pickup.otp;
              return otp ? (
                <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1.5px dashed var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 6px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>PICKUP CODE — SHARE WITH RIDER</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--primary)', letterSpacing: 3 }}>{otp}</div>
                </div>
              ) : (
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 6px' }}>Waiting for the rider to request your pickup code…</p>
              );
            })()}
            <p style={{ fontSize: 12.5, margin: '0 0 6px' }}><b>Reason:</b> {viewingReturn.reason?.replace(/_/g, ' ')}</p>
            {viewingReturn.customerDescription && <p style={{ fontSize: 12.5, margin: '0 0 6px' }}><b>Description:</b> {viewingReturn.customerDescription}</p>}
            {viewingReturn.rejectionReason && <p style={{ fontSize: 12.5, margin: '0 0 6px', color: '#b91c1c' }}><b>Rejection reason:</b> {viewingReturn.rejectionReason}</p>}
            {viewingReturn.refundAmount !== undefined && viewingReturn.refundAmount !== null && (
              <p style={{ fontSize: 12.5, margin: '0 0 6px' }}>
                <b>Refund:</b> ₹{viewingReturn.refundAmount} · {viewingReturn.refundDestination === 'wallet' ? 'Bulkimart Wallet' : viewingReturn.refundDestination === 'original_source' ? 'Original payment source' : 'Destination pending'}
                {viewingReturn.status === 'REFUNDED'
                  ? ` — completed${viewingReturn.refundedAt ? ` on ${new Date(viewingReturn.refundedAt).toLocaleDateString('en-IN')}` : ''}${viewingReturn.refundReference ? ` (Ref: ${viewingReturn.refundReference})` : ''}`
                  : ` — ${viewingReturn.refundStatus || 'pending'}`}
              </p>
            )}

            {viewingReturn.pickupMethod === 'SHIPROCKET' && <p>Shiprocket pickup: {viewingReturn.reverseBooking?.trackingState || viewingReturn.reverseBooking?.state}{viewingReturn.awbNumber ? ` · AWB ${viewingReturn.awbNumber}` : ''}</p>}
            {viewingReturn.attachments?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
                {viewingReturn.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer">
                    <img src={a.url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                  </a>
                ))}
              </div>
            )}

            <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Timeline</div>
              {(viewingReturn.history || []).map((h, i) => (
                <div key={i} style={{ fontSize: 12, marginBottom: 8, paddingLeft: 12, borderLeft: '2px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700 }}>{RETURN_STATUS_LABEL[h.toStatus] || h.toStatus}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatDate(h.timestamp)} · {formatTime(h.timestamp)}</div>
                  {h.comment && <div style={{ color: '#475569', fontSize: 11.5 }}>{h.comment}</div>}
                </div>
              ))}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default OrderTrackingPage;
