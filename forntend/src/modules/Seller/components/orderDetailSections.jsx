import { feedback as ui } from '../../../utils/feedback';
import React from 'react';
const money = value => value == null ? 'Not recorded' : `₹${Number(value).toLocaleString('en-IN')}`;
const date = value => value ? new Date(value).toLocaleString('en-IN') : 'Not recorded';
const statusText = value => String(value || 'Not recorded').replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
export const addressText = address => address ? [...new Set([address.name, address.house, address.building, address.line1, address.address, address.line2, address.locality, address.city, address.state, address.pincode || address.pin_code].filter(Boolean))].join(', ') : 'Not recorded';
const link = (url, label) => {
  try { if (new URL(url).protocol === 'https:') return <a href={url} target="_blank" rel="noopener noreferrer">{label}</a>; } catch { /* Absent or invalid provider URL. */ }
  return null;
};
// Pure presentation, shared by direct-route and notification-opened details.
export function orderDetailSections(order) {
  const shipment = order.shiprocket;
  const delivery = order.deliveryAssignment;
  return <div className="seller-order-detail-sections">
    <section><h4>Order summary</h4>
      <p><strong>{order.orderNo}</strong><br /><small>Reference: {order._id}</small></p>
      <p>Placed: {date(order.placedAt)}<br />Status: {statusText(order.displayStatus || order.status)}<br />
        {order.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}<br />Payment: {order.paymentMethod} · {order.paymentStatus}</p>
      {order.cancellationReason && <p>Cancellation/rejection reason: {order.cancellationReason}</p>}
      {order.customerInstructions && <p>Customer instructions: {order.customerInstructions}</p>}
      <dl>{(order.pricing ? Object.entries(order.pricing).filter(([key]) => ['subtotal','discount','deliveryCharge','tax','taxAmount','totalAmount','tipAmount','coinDiscount'].includes(key)) : [['Seller items subtotal', order.subtotal]])
        .map(([key, value]) => <React.Fragment key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{money(value)}</dd></React.Fragment>)}</dl>
      {!order.pricing && <p>Full basket pricing is withheld for multi-store orders.</p>}
    </section>
    <section><h4>Customer and delivery address</h4><p>{order.shippingAddress?.name || order.customer?.name || 'Not recorded'}<br />{order.shippingAddress?.phone}</p>
      <address>{addressText(order.shippingAddress)}</address>
      {order.shippingAddress?.landmark && <p>Landmark: {order.shippingAddress.landmark}</p>}
      {order.shippingAddress?.instructions && <p>Delivery instructions: {order.shippingAddress.instructions}</p>}
      <button type="button" className="order-action-btn-sm" onClick={async () => {
        const scope = ui.captureScope();
        try { await navigator.clipboard.writeText(addressText(order.shippingAddress)); ui.notify('Delivery address copied', {scope}); }
        catch { ui.notify('Copy unavailable. Select the displayed address to copy it.', {type:'error',scope}); }
      }}>Copy delivery address</button>
    </section>
    <section><h4>Your items in this order</h4>{(order.items || []).map((item, index) => <article className="seller-detail-item" key={item.productId || index}>
      {item.image && <img src={item.image} alt="" />}
      <div><strong>{item.name}</strong><p>SKU: {item.sku || 'Not recorded'} · {item.variantName || item.unit || 'Standard item'}</p>
        <p>Quantity: {item.qty} · Unit price: {money(item.price)} · Line total: {money(item.lineTotal)}</p>
        {item.additionalMessage && <p>Customer message: {item.additionalMessage}</p>}</div>
    </article>)}</section>
    <section><h4>Store and pickup location</h4><p>{order.store?.name || 'Not recorded'}</p><address>{addressText(order.store?.pickupAddress)}</address><p>{order.store?.pickupAddress?.phone}</p>
      <p>Shiprocket pickup: {order.store?.pickupLocation || 'Not linked. Contact platform support to register and link your store pickup location.'}</p>
      <p>Provider eligibility is rechecked before shipment creation.</p>
    </section>
    <section><h4>Bulkimart delivery</h4>{delivery ? <><p>Rider: {delivery.rider?.name || 'Name not recorded'}<br />Contact: {delivery.rider?.phone || 'Not recorded'}<br />Assignment status: {delivery.status}<br />Assigned: {date(delivery.assignedAt)}</p>
      {delivery.completedAt && <p>Completed: {date(delivery.completedAt)} · Delivery OTP verified: {delivery.otpVerified ? 'Yes' : 'No'}</p>}</>
      : <p>{order.fulfillment?.method === 'manual' ? 'Waiting for an eligible rider to accept. Sellers do not assign riders directly.' : 'Manual delivery not assigned.'}</p>}</section>
    <section><h4>Courier shipment</h4>{shipment ? <><p>Provider: Shiprocket<br />Courier: {shipment.courier || 'Not assigned'}<br />Shipment: {shipment.shipmentId || 'Not created'}<br />AWB: {shipment.awb || 'Not assigned'}<br />Status: {shipment.status || 'Not recorded'}</p>
      <p>Registered pickup: {shipment.pickupLocation || order.store?.pickupLocation || 'Not recorded'}<br />{addressText(shipment.pickupAddress)}</p>
      <p>Destination: {addressText(order.shippingAddress)}</p>
      {shipment.package && <p>Parcel: {shipment.package.length} × {shipment.package.breadth} × {shipment.package.height} cm · {shipment.package.weight} kg</p>}
      <p>Created/requested: {date(shipment.requestedAt)}<br />Pickup scheduled: {date(shipment.pickupScheduledAt)}<br />Latest tracking: {shipment.webhookEvents?.at(-1)?.status || shipment.status} · {date(shipment.webhookEvents?.at(-1)?.receivedAt)}</p>
      <div className="seller-detail-links">{link(shipment.trackingUrl, 'Track shipment')}{link(shipment.labelUrl, 'Download label')}{link(shipment.invoiceUrl, 'Download invoice')}</div>
      {shipment.lastError && <p role="alert">{shipment.lastError}</p>}
      {shipment.status === 'reconciliation_required' && <p>Contact platform support to reconcile this order with Shiprocket before retrying. Shipment creation is locked.</p>}</> : <p>No courier shipment created.</p>}</section>
    <section><h4>Status timeline</h4><ol>{(order.timeline || []).map((event, index) => <li key={index}><strong>{event.status}</strong> · {date(event.timestamp)}<p>{event.note}</p></li>)}</ol></section>
  </div>;
}
