import React, { useEffect, useState } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import { DeliveryMap } from '../../../components/DeliveryMap';

/**
 * QUICK COMMERCE ONLY — a rider's view of reverse pickups (customer ->
 * rider -> seller) offered to or accepted by them. A new offer arrives in
 * real time via the `return_pickup_ping` socket event (handled globally in
 * routes/index.jsx's ReturnPickupPingModal, not here) — this page is where
 * the rider manages an ALREADY-ACCEPTED pickup (live map, OTP, status) and
 * reviews anything still pending. `fetchReturnPickups`'s own recurring poll
 * (DeliveryContext) already keeps this list fresh while the rider is
 * online; this page only needs to ask for the latest snapshot on mount.
 */
export const ReturnPickupsPage = () => {
  const { returnPickups, fetchReturnPickups, acceptReturnPickup, declineReturnPickup, generateReturnPickupOtp, verifyReturnPickupOtp, riderLocation } = useDelivery();
  const [otpInputs, setOtpInputs] = useState({});
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { fetchReturnPickups(); }, []);

  const act = async (fn, id, ...args) => {
    setBusyId(id);
    try { await fn(id, ...args); } finally { setBusyId(null); }
  };

  const pending = returnPickups?.pending || [];
  const active = returnPickups?.active || [];

  return (
    <div style={{ padding: 16, paddingBottom: 90 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, margin: '0 0 12px' }}>Return Pickups</h2>

      <h3 style={{ fontSize: 12.5, fontWeight: 800, color: '#64748b', margin: '0 0 8px' }}>New requests</h3>
      {pending.length === 0 ? (
        <p style={{ fontSize: 12, color: '#94a3b8' }}>No pending return pickup requests right now.</p>
      ) : pending.map((r) => (
        <div key={r._id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>{r.returnNumber}</p>
          <p style={{ margin: '4px 0 10px', fontSize: 12 }}>{r.productName} × {r.quantity}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busyId === r._id} onClick={() => act(acceptReturnPickup, r._id)}
              style={{ flex: 1, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 8, padding: '8px 0', fontWeight: 800, fontSize: 12, cursor: busyId === r._id ? 'not-allowed' : 'pointer' }}>
              Accept
            </button>
            <button type="button" disabled={busyId === r._id} onClick={() => act(declineReturnPickup, r._id)}
              style={{ flex: 1, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 8, padding: '8px 0', fontWeight: 800, fontSize: 12, cursor: busyId === r._id ? 'not-allowed' : 'pointer' }}>
              Decline
            </button>
          </div>
        </div>
      ))}

      <h3 style={{ fontSize: 12.5, fontWeight: 800, color: '#64748b', margin: '18px 0 8px' }}>Your active pickups</h3>
      {active.length === 0 ? (
        <p style={{ fontSize: 12, color: '#94a3b8' }}>Nothing assigned to you right now.</p>
      ) : active.map((r) => {
        const customerAddr = r.pickup?.deliveryId?.pickupLocation || r.orderId?.shippingAddress;
        const sellerAddr = r.pickup?.deliveryId?.dropLocation || r.sellerId?.storeDetails;
        const isPickedUp = r.pickup?.status === 'PICKED_UP';

        const customerLat = customerAddr?.lat;
        const customerLng = customerAddr?.lng;
        const customerAddressText = customerAddr?.address || [customerAddr?.line1, customerAddr?.city, customerAddr?.state, customerAddr?.pincode].filter(Boolean).join(', ');

        const sellerLat = sellerAddr?.lat;
        const sellerLng = sellerAddr?.lng;
        const sellerAddressText = sellerAddr?.address || [sellerAddr?.address, sellerAddr?.city, sellerAddr?.state, sellerAddr?.pincode].filter(Boolean).join(', ') || sellerAddr?.name || r.sellerId?.businessName;

        const pickupPoint = (customerLat !== undefined && customerLng !== undefined)
          ? { lat: Number(customerLat), lng: Number(customerLng), name: 'Customer', address: customerAddressText }
          : customerAddressText ? { address: customerAddressText, name: 'Customer' } : undefined;

        const dropPoint = (sellerLat !== undefined && sellerLng !== undefined)
          ? { lat: Number(sellerLat), lng: Number(sellerLng), name: sellerAddr?.name || r.sellerId?.businessName || 'Seller', address: sellerAddressText }
          : sellerAddressText ? { address: sellerAddressText, name: sellerAddr?.name || r.sellerId?.businessName || 'Seller' } : undefined;

        return (
          <div key={r._id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>{r.returnNumber} — {r.pickup?.status?.replace(/_/g, ' ')}</p>
            <p style={{ margin: '4px 0 10px', fontSize: 12 }}>{r.productName} × {r.quantity}</p>
            <p style={{ margin: '0 0 10px', fontSize: 11.5, color: '#64748b' }}>
              Pickup: {customerAddr?.line1 || customerAddr?.address || '—'} · Drop: {sellerAddr?.name || r.sellerId?.businessName || sellerAddr?.address || '—'}
            </p>

            {(pickupPoint || dropPoint) && (
              <div style={{ marginBottom: 10 }}>
                <DeliveryMap
                  pickup={pickupPoint}
                  drop={dropPoint}
                  rider={{ leg: isPickedUp ? 'to_customer' : 'to_store', location: riderLocation }}
                  height={200}
                  showRiderCard={false}
                />
              </div>
            )}

            {r.pickup?.status === 'ASSIGNED' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" disabled={busyId === r._id} onClick={() => act(generateReturnPickupOtp, r._id)}
                  style={{ border: 'none', background: '#0ea5e9', color: '#fff', borderRadius: 8, padding: '8px 12px', fontWeight: 800, fontSize: 12, cursor: busyId === r._id ? 'not-allowed' : 'pointer' }}>
                  Send pickup code
                </button>
                <input
                  type="text" placeholder="Enter customer's code" value={otpInputs[r._id] || ''}
                  onChange={(e) => setOtpInputs((p) => ({ ...p, [r._id]: e.target.value }))}
                  style={{ flex: 1, minWidth: 120, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}
                />
                <button type="button" disabled={busyId === r._id || !otpInputs[r._id]} onClick={() => act(verifyReturnPickupOtp, r._id, otpInputs[r._id])}
                  style={{ border: 'none', background: '#16a34a', color: '#fff', borderRadius: 8, padding: '8px 12px', fontWeight: 800, fontSize: 12, cursor: (busyId === r._id || !otpInputs[r._id]) ? 'not-allowed' : 'pointer' }}>
                  Confirm pickup
                </button>
              </div>
            )}

            {isPickedUp && (
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#166534' }}>
                Picked up — drop this off with the seller. The seller will mark it received.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ReturnPickupsPage;
