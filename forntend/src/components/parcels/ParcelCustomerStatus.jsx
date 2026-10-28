import React from 'react';
import {parcelMoney} from './parcelApi';
export const parcelCustomerStatus = status => ({
  payment_pending:'Complete your payment',payment_failed:'Payment needs attention',
  searching_for_driver:'Finding your delivery partner',needs_admin_assignment:'We’re arranging your pickup',
  driver_assigned:'Your delivery partner is assigned',driver_arriving:'Your partner is on the way',
  arrived_at_pickup:'Your partner has arrived',picked_up:'Your parcel has been collected',in_transit:'Your parcel is on the way',
  arrived_at_dropoff:'Your parcel has arrived',delivered:'Parcel delivered',cancellation_review:'Cancellation is being reviewed',
  cancelled:'Booking cancelled',delivery_failed:'Your delivery needs assistance',
}[status] || 'Parcel delivery update');
const vehicleLabel={bicycle:'Bicycle',bike:'Bike',auto:'Auto',car:'Car'};
// Contact options are present only while the delivery is under way; the server omits them otherwise.
export function ParcelPartnerCard({partner:p,active}) {
  const vehicle=[vehicleLabel[p.vehicleType],p.vehicleNo].filter(Boolean).join(' · ');
  return <section className="parcel-card parcel-partner-card" aria-label="Your delivery partner">
    <span className="parcel-partner-avatar" aria-hidden="true">{p.avatar?<img src={p.avatar} alt=""/>:(p.name||'D').trim().charAt(0).toUpperCase()}</span>
    <div className="parcel-partner-info"><small>{active?'Your delivery partner':'Delivered by'}</small><strong>{p.name}</strong>{(vehicle||p.rating>0)&&<span>{vehicle}{vehicle&&p.rating>0?' · ':''}{p.rating>0?`★ ${Number(p.rating).toFixed(1)}`:''}</span>}</div>
    {p.phone&&<a className="parcel-partner-call" href={'tel:'+p.phone} aria-label={`Call ${p.name}`}>Call</a>}
  </section>;
}
export default function ParcelCustomerStatus({booking:b,justBooked}) {
  const unpaid=b.paymentMethod==='online'&&['payment_pending','payment_failed'].includes(b.status);
  return <>
    <section className="parcel-card parcel-customer-status">
      <div className="parcel-status-symbol" aria-hidden="true">{unpaid?'₹':b.status==='delivered'?'✓':'▣'}</div>
      <h2>{parcelCustomerStatus(b.status)}</h2>
      <p>{unpaid?'Finish payment securely with Razorpay to confirm your booking.':b.status==='searching_for_driver'?'Your request is with nearby delivery partners. We’ll update you when someone accepts.':b.status==='needs_admin_assignment'?'Our team is helping find an available delivery partner. You don’t need to book again.':b.status==='delivered'?'Your parcel has reached its destination.':'Follow your pickup and delivery updates here.'}</p>
      {justBooked&&!unpaid&&<p role="status" className="parcel-notice">Booking received. {b.paymentMethod==='online'?'Payment successful.':'Your pickup request is confirmed.'}</p>}
      <div className="parcel-payment-receipt"><strong>{parcelMoney(b.feePaise)}</strong><span>{b.paymentStatus==='paid'?'Paid online':b.paymentMethod==='pay_driver'?`Cash at ${b.cashCollectionPoint==='pickup'?'pickup':'delivery'}`:'Online payment'}</span></div>
      {b.pickupCode&&<p className="parcel-notice">Pickup code: <strong>{b.pickupCode}</strong>. Share only when your partner arrives.</p>}
      {b.deliveryCode&&<p className="parcel-notice">Delivery code: <strong>{b.deliveryCode}</strong>. Share only when your parcel arrives.</p>}
      {b.refund?.toWallet?<p className="parcel-notice parcel-refund-wallet" role="status"><strong>{parcelMoney(b.refund.refundedPaise)}</strong> refunded to your Bulkimart wallet.</p>
        :b.refund?.status==='confirmed'?<p className="parcel-notice" role="status">{parcelMoney(b.refund.refundedPaise)} refunded to your original payment method.</p>
        :b.refund?.status&&b.refund.status!=='none'?<p>Your refund is being processed.</p>
        :b.status==='cancelled'&&b.paymentMethod==='pay_driver'&&['collected_unreconciled'].includes(b.cash?.status)?<p>The cash you paid will be refunded to your Bulkimart wallet once it is deposited with us.</p>:null}
      <details className="parcel-booking-reference"><summary>Booking details</summary><p>{b.reference}</p><p>{b.service?.name||'Doorstep delivery'}{b.route?.distanceMetres>0?` · ${(b.route.distanceMetres/1000).toFixed(2)} km`:''}</p></details>
    </section>
    {b.partner&&<ParcelPartnerCard partner={b.partner} active={!!b.partner.phone}/>}
    <section className="parcel-card parcel-trip-addresses"><div><span>Pickup</span><p>{b.details.pickup.address}</p></div><div><span>Deliver to</span><p>{b.details.dropoff.address}</p></div></section>
  </>;
}
