import React, { useEffect, useState } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import { DeliveryMap } from '../../../components/DeliveryMap';

/**
 * QUICK COMMERCE ONLY — a rider's view of reverse pickups (customer ->
 * rider -> seller) offered to or accepted by them. A new offer arrives in
 * real time via the `return_pickup_ping` socket event (handled globally in
 * routes/index.jsx's ReturnPickupPingModal, not here) — this page lists
 * pending offers and accepted pickups; each accepted pickup opens as its own
 * full page (/delivery/returns/<id>) with the map, stops and pickup code.
 * `fetchReturnPickups`'s own recurring poll (DeliveryContext) already keeps
 * this list fresh while the rider is online; this page only needs to ask for
 * the latest snapshot on mount.
 */
const DETAIL_PATH = /^\/delivery\/returns\/([a-f\d]{24})$/i;
const STATUS = {
  ASSIGNED: { label: 'Collect from customer', tone: 'pickup' },
  PICKED_UP: { label: 'Drop at seller', tone: 'drop' },
  DELIVERED_TO_SELLER: { label: 'Delivered to seller', tone: 'done' },
};
const statusOf = r => STATUS[r.pickup?.status] || { label: (r.pickup?.status || 'Assigned').replace(/_/g, ' ').toLowerCase(), tone: 'pickup' };

// The shell follows the URL on popstate, so the hardware back button returns to the list.
const openPickup = id => {
  window.history.pushState({ fromReturnList: true }, '', `/delivery/returns/${id}`);
  window.dispatchEvent(new Event('popstate'));
};
const closePickup = () => {
  if (window.history.state?.fromReturnList) { window.history.back(); return; }
  window.history.replaceState(null, '', '/delivery/returns');
  window.dispatchEvent(new Event('popstate'));
};

function stopsOf(r) {
  const customer = r.pickup?.deliveryId?.pickupLocation || r.orderId?.shippingAddress;
  const seller = r.pickup?.deliveryId?.dropLocation || r.sellerId?.storeDetails;
  const customerAddress = customer?.address || [customer?.line1, customer?.line2, customer?.city, customer?.state, customer?.pincode].filter(Boolean).join(', ');
  const sellerName = seller?.name || r.sellerId?.businessName || r.sellerId?.storeDetails?.name || 'Seller';
  const sellerAddress = seller?.address && seller?.city ? [seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', ') : seller?.address || [seller?.city, seller?.state, seller?.pincode].filter(Boolean).join(', ');
  const point = (place, name, address) => place?.lat !== undefined && place?.lng !== undefined
    ? { lat: Number(place.lat), lng: Number(place.lng), name, address }
    : address ? { name, address } : undefined;
  return {
    customerName: customer?.name || 'Customer', customerAddress, sellerName, sellerAddress,
    pickupPoint: point(customer, 'Customer', customerAddress), dropPoint: point(seller, sellerName, sellerAddress),
  };
}

function ProductLine({ r }) {
  return <div className="delivery-return-product">
    {r.productImage ? <img src={r.productImage} alt="" /> : <span className="delivery-return-product-placeholder" aria-hidden="true">↩</span>}
    <span><strong>{r.productName}</strong><small>Quantity {r.quantity}</small></span>
  </div>;
}

export function ReturnPickupDetail({ r, busy, onSendCode, onConfirm, riderLocation }) {
  const [code, setCode] = useState('');
  const status = statusOf(r), stops = stopsOf(r), pickedUp = r.pickup?.status === 'PICKED_UP';
  return <article className="delivery-return-detail" aria-labelledby="return-detail-title">
    <button type="button" className="delivery-return-back" onClick={closePickup}><span aria-hidden="true">←</span> All return pickups</button>
    <header className="delivery-return-detail-head">
      <div><span className="delivery-return-eyebrow">Return pickup</span><h2 id="return-detail-title">{r.returnNumber}</h2></div>
      <span className={`delivery-return-status is-${status.tone}`}>{status.label}</span>
    </header>
    <section className="delivery-return-panel"><ProductLine r={r} /></section>
    <ol className="delivery-return-stops">
      <li className={pickedUp ? 'is-done' : 'is-current'}>
        <span className="delivery-return-stop-label">1 · Pick up from customer</span>
        <strong>{stops.customerName}</strong><p>{stops.customerAddress || 'Address unavailable'}</p>
      </li>
      <li className={pickedUp ? 'is-current' : ''}>
        <span className="delivery-return-stop-label">2 · Drop at seller</span>
        <strong>{stops.sellerName}</strong><p>{stops.sellerAddress || 'Address unavailable'}</p>
      </li>
    </ol>
    {(stops.pickupPoint || stops.dropPoint) && <div className="delivery-return-map">
      <DeliveryMap pickup={stops.pickupPoint} drop={stops.dropPoint} rider={{ leg: pickedUp ? 'to_customer' : 'to_store', location: riderLocation }} height={260} showRiderCard={false} />
    </div>}
    {r.pickup?.status === 'ASSIGNED' && <section className="delivery-return-panel delivery-return-otp">
      <h3>Confirm the pickup</h3>
      <p>Ask the customer for their 4-digit pickup code. If they don't have it, send it to them.</p>
      <button type="button" className="delivery-return-secondary" disabled={busy} onClick={onSendCode}>Send pickup code to customer</button>
      <label>Customer's pickup code
        <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={4} placeholder="0000" value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          // Bring the field above the on-screen keyboard once it opens.
          onFocus={e => { const field = e.currentTarget; setTimeout(() => field.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300); }} />
      </label>
      <button type="button" className="delivery-return-primary" disabled={busy || code.length !== 4} onClick={() => onConfirm(code)}>Confirm pickup</button>
    </section>}
    {pickedUp && <p className="delivery-return-note">Picked up — drop this off with {stops.sellerName}. The seller will mark it received.</p>}
  </article>;
}

export const ReturnPickupsPage = () => {
  const { returnPickups, fetchReturnPickups, acceptReturnPickup, declineReturnPickup, generateReturnPickupOtp, verifyReturnPickupOtp, riderLocation } = useDelivery();
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { fetchReturnPickups(); }, []);

  const act = async (fn, id, ...args) => {
    setBusyId(id);
    try { await fn(id, ...args); } finally { setBusyId(null); }
  };

  const pending = returnPickups?.pending || [];
  const active = returnPickups?.active || [];
  const history = returnPickups?.history || [];

  // One accepted pickup, full page. The shell re-renders on every URL change.
  const selectedId = window.location.pathname.match(DETAIL_PATH)?.[1];
  if (selectedId) {
    const selected = active.find(r => r._id === selectedId);
    if (selected) return <ReturnPickupDetail key={selected._id} r={selected} busy={busyId === selected._id} riderLocation={riderLocation}
      onSendCode={() => act(generateReturnPickupOtp, selected._id)} onConfirm={code => act(verifyReturnPickupOtp, selected._id, code)} />;
    const done = history.find(r => r._id === selectedId);
    return <div className="delivery-return-detail">
      <button type="button" className="delivery-return-back" onClick={closePickup}><span aria-hidden="true">←</span> All return pickups</button>
      <p className="delivery-return-empty" role="status">{!returnPickups ? 'Loading pickup…' : done ? `${done.returnNumber} has been delivered to the seller.` : 'This return pickup is no longer assigned to you.'}</p>
    </div>;
  }

  return (
    <div className="delivery-return-list">
      <h3 className="delivery-return-heading">New requests</h3>
      {pending.length === 0 ? (
        <p className="delivery-return-empty">No pending return pickup requests right now.</p>
      ) : pending.map((r) => (
        <div key={r._id} className="delivery-return-card is-offer">
          <div className="delivery-return-card-top"><strong>{r.returnNumber}</strong><span className="delivery-return-status is-offer">New request</span></div>
          <ProductLine r={r} />
          <div className="delivery-return-actions">
            <button type="button" className="delivery-return-primary" disabled={busyId === r._id} onClick={() => act(acceptReturnPickup, r._id)}>Accept</button>
            <button type="button" className="delivery-return-secondary" disabled={busyId === r._id} onClick={() => act(declineReturnPickup, r._id)}>Decline</button>
          </div>
        </div>
      ))}

      <h3 className="delivery-return-heading">Your active pickups</h3>
      {active.length === 0 ? (
        <p className="delivery-return-empty">Nothing assigned to you right now.</p>
      ) : active.map((r) => {
        const status = statusOf(r), stops = stopsOf(r);
        return (
          <button key={r._id} type="button" className="delivery-return-card is-link" onClick={() => openPickup(r._id)}>
            <span className="delivery-return-card-top"><strong>{r.returnNumber}</strong><span className={`delivery-return-status is-${status.tone}`}>{status.label}</span></span>
            <ProductLine r={r} />
            <span className="delivery-return-card-route">
              <span><small>Pick up</small>{stops.customerAddress || stops.customerName}</span>
              <span><small>Drop</small>{stops.sellerName}</span>
            </span>
            <span className="delivery-return-open">Open pickup <span aria-hidden="true">›</span></span>
          </button>
        );
      })}

      {/* Pickups already handed to the seller, with what each trip earned. */}
      <h3 className="delivery-return-heading">Completed pickups</h3>
      {history.length === 0 ? (
        <p className="delivery-return-empty">Return pickups you complete will appear here.</p>
      ) : history.map((r) => {
        const trip = r.pickup?.deliveryId;
        const doneAt = r.pickup?.sellerConfirmedReceivedAt || trip?.endTime || r.updatedAt;
        const earned = Number(trip?.partnerEarnings);
        return (
          <div key={r._id} className="delivery-return-card">
            <div className="delivery-return-card-top"><strong>{r.returnNumber}</strong><span className="delivery-return-status is-done">Delivered to seller</span></div>
            <p className="delivery-return-meta">{r.productName} × {r.quantity}</p>
            <p className="delivery-return-meta">
              To {r.sellerId?.businessName || r.sellerId?.storeDetails?.name || 'seller'}{doneAt ? ` · ${new Date(doneAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </p>
            <p className={`delivery-return-earned${Number.isFinite(earned) && earned > 0 ? '' : ' is-pending'}`}>
              {Number.isFinite(earned) ? `Earned ₹${earned.toFixed(2)}` : 'Earning pending'}
            </p>
          </div>
        );
      })}
    </div>
  );
};

export default ReturnPickupsPage;
