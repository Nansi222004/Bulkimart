import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bike, Package } from 'lucide-react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';

export default function ReturnPickupPanel({ r, onChange }) {
  const [options, setOptions] = useState(null), [loading, setLoading] = useState(true);
  const [method, setMethod] = useState(''), [riderId, setRiderId] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0), mounted = useRef(true), submitting = useRef(false);
  const load = useCallback(async () => {
    const epoch = ++generation.current, token = localStorage.getItem('sellerToken');
    const current = () => mounted.current && epoch === generation.current && token === localStorage.getItem('sellerToken');
    setLoading(true);
    try {
      const response = await boundedFetch(apiUrl(`/api/sellers/returns/${r._id}/pickup-options`), { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Could not load pickup options');
      if (current()) {
        setOptions(body.data);
        setRiderId(previous => body.data?.manual?.riders?.some(rider => rider.id === previous) ? previous : '');
      }
    } catch (error) { if (current()) { setOptions(null); setMessage(error.message); } }
    finally { if (current()) setLoading(false); }
  }, [r._id]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; };
  }, [load, r.status, r.pickupMethod, r.pickup?.status, r.pickup?.requestedRiderId, r.reverseBooking?.state]);
  const perform = async (action, payload) => {
    if (submitting.current) return;
    if (action === '' && (!method || loading || !options?.stateReady || method === 'MANUAL' && (!riderId || !options.manual?.available) || method === 'SHIPROCKET' && !options.shiprocket?.available)) return;
    submitting.current = true; setBusy(true); setMessage('');
    const token = localStorage.getItem('sellerToken');
    try {
      const response = await boundedFetch(apiUrl(`/api/sellers/returns/${r._id}/${action === 'mark-received' ? action : `pickup${action ? `/${action}` : ''}`}`), {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await response.json();
      if (!mounted.current || token !== localStorage.getItem('sellerToken')) return;
      setMessage(body.message || (response.ok ? 'Pickup updated' : 'Could not update pickup'));
      if (response.ok) { setMethod(''); setRiderId(''); }
      await Promise.all([onChange(), load()]);
    } catch {
      if (mounted.current && token === localStorage.getItem('sellerToken')) {
        setMessage('Could not confirm pickup; reload before retrying');
        // A timeout may follow a successful booking. Require a state refresh.
        setOptions(null);
      }
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  const waiting = r.pickupMethod === 'MANUAL' && r.pickup?.status === 'NOT_ASSIGNED';
  const canChoose = options?.stateReady && !busy;
  return <div className="seller-delivery-methods seller-return-pickup">
    <div className="seller-delivery-heading"><span className="seller-order-eyebrow">Return pickup</span><h2>Choose how to collect this return</h2></div>
    <p>The item travels from the customer back to your store. Send a request after choosing a pickup method.</p>
    {message && <p role="status">{message}</p>}
    <div className="seller-rider-heading">
      <span>{loading ? 'Checking pickup availability…' : options?.stateReason}</span>
      <button type="button" className="order-action-btn-sm" disabled={loading || busy} onClick={load}>Refresh availability</button>
    </div>
    {options?.stateReady && <>
      <div className="seller-delivery-choices">
        <button type="button" disabled={!canChoose} aria-pressed={method === 'MANUAL'} onClick={() => setMethod('MANUAL')}>
          <span className="seller-delivery-choice-icon"><Bike size={24} /></span><span><strong>Manual Delivery / Local Rider</strong><small>Choose an available delivery partner for the pickup.</small></span>
        </button>
        <button type="button" disabled={!canChoose || !options.shiprocket?.available} aria-pressed={method === 'SHIPROCKET'} onClick={() => setMethod('SHIPROCKET')}>
          <span className="seller-delivery-choice-icon"><Package size={24} /></span><span><strong>Shiprocket Reverse Pickup</strong><small>Book a courier to collect and return the package.</small></span>
        </button>
      </div>
      {method === 'MANUAL' && <div className="seller-delivery-panel">
        <div className="seller-rider-heading"><h3>Available delivery partners</h3><span>{options.manual?.eligibleRiderCount || 0} available</span></div>
        {options.manual?.riders?.length ? <div className="seller-rider-list">
          {options.manual.riders.map(rider => <button type="button" key={rider.id} className="seller-rider-card" aria-pressed={riderId === rider.id} disabled={busy} onClick={() => setRiderId(rider.id)}>
            <span className="seller-rider-avatar">{rider.name?.slice(0, 1)}</span><div><strong>{rider.name}</strong><span>{rider.contact}</span><small>{rider.availability}{Number.isFinite(rider.distanceKm) ? ` · ${rider.distanceKm.toFixed(1)} km from customer` : ''}</small></div><span className="seller-rider-active">{riderId === rider.id ? 'Selected' : 'On duty'}</span>
          </button>)}
        </div> : <div className="seller-rider-empty">{options.manual?.reason || 'No delivery partners available. Refresh availability or choose Shiprocket.'}</div>}
        <p>Only the selected partner receives this request. They must accept before pickup is assigned.</p>
      </div>}
      {method === 'SHIPROCKET' && <p>Confirm to book the courier. Refresh tracking if the booking needs confirmation before trying again.</p>}
      {method && <button type="button" className="primary-onboarding-btn" style={{ width: '100%', marginTop: 16 }} disabled={!canChoose || loading || method === 'MANUAL' && (!riderId || !options.manual?.available)}
        onClick={() => perform('', { pickupMethod: method, ...(method === 'MANUAL' ? { riderId } : {}) })}>{busy ? 'Sending…' : method === 'MANUAL' ? 'Request selected delivery partner' : 'Confirm Shiprocket pickup'}</button>}
    </>}
    {options?.pickup && <div className="seller-delivery-route">
      <div><span>Pickup from customer</span><p>{[options.pickup.line1, options.pickup.line2, options.pickup.city, options.pickup.pincode].filter(Boolean).join(', ')}</p></div><span>→</span>
      <div><span>Return to your store</span><p>{[options.drop?.name, options.drop?.address, options.drop?.city, options.drop?.pincode].filter(Boolean).join(', ')}</p></div>
    </div>}
    {waiting && <p>Waiting for the requested delivery partner to accept. <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => perform('cancel')}>Cancel rider request</button></p>}
    {r.pickupMethod === 'SHIPROCKET' && <div className="seller-delivery-panel">
      <p>{r.awbNumber ? `AWB: ${r.awbNumber}` : 'Booking confirmation pending'} · {r.reverseBooking?.trackingState || r.reverseBooking?.state}</p>
      {r.reverseBooking?.error && <p role="status">{r.reverseBooking.error}</p>}
      <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => perform('refresh')}>Refresh courier tracking</button>
      {r.reverseBooking?.state === 'booked' && (r.reverseBooking?.trackingRank || 0) < 2 && <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => perform('cancel')}>Request courier cancellation</button>}
    </div>}
    {(r.pickup?.status === 'PICKED_UP' || r.reverseBooking?.trackingState === 'DELIVERED' && r.pickup?.status !== 'DELIVERED_TO_SELLER') &&
      <button type="button" className="order-action-btn-sm" disabled={busy} onClick={() => perform('mark-received')}>Mark Received</button>}
  </div>;
}
