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
      {b.refund?.status&&b.refund.status!=='none'&&<p>Refund: {b.refund.status.replaceAll('_',' ')}</p>}
      <details className="parcel-booking-reference"><summary>Booking details</summary><p>{b.reference}</p><p>{b.service?.name||'Doorstep delivery'}{b.route?.distanceMetres>0?` · ${(b.route.distanceMetres/1000).toFixed(2)} km`:''}</p></details>
    </section>
    <section className="parcel-card parcel-trip-addresses"><div><span>Pickup</span><p>{b.details.pickup.address}</p></div><div><span>Deliver to</span><p>{b.details.dropoff.address}</p></div></section>
  </>;
}
