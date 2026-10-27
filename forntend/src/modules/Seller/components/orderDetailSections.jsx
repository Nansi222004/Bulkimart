import { feedback as ui } from '../../../utils/feedback';
import React from 'react';
import { sellerPricingRows } from '../utils/sellerOrderAmounts';
import { sellerTimeline } from '../utils/sellerTimeline';
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
    <section className="seller-detail-summary"><h2>Order & payment summary</h2>
      <p><strong>{order.orderNo}</strong><br /><small>Reference: {order._id}</small></p>
      <p>Placed: {date(order.placedAt)}<br />Status: {statusText(order.displayStatus || order.status)}<br />
        {order.channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}<br />Payment: {order.paymentMethod} · {order.paymentStatus}</p>
      {order.cancellationReason && <p>Cancellation/rejection reason: {order.cancellationReason}</p>}
      {order.customerInstructions && <p>Customer instructions: {order.customerInstructions}</p>}
      <dl>{sellerPricingRows(order).map(([label, value]) => <React.Fragment key={label}><dt className={label === 'Order total' ? 'seller-detail-pricing-total' : undefined}>{label}</dt><dd className={label === 'Order total' ? 'seller-detail-pricing-total' : undefined}>{label.toLowerCase().includes('discount') ? '−' : ''}{money(value)}</dd></React.Fragment>)}</dl>
      {!order.pricing && <p>Full basket pricing is withheld for multi-store orders.</p>}
    </section>
    <section className="seller-detail-customer"><h2>Customer & delivery address</h2><p><strong>{order.shippingAddress?.name || order.customer?.name || 'Not recorded'}</strong><br />{order.shippingAddress?.phone}</p>
      <address>{addressText(order.shippingAddress)}</address>
      {order.shippingAddress?.landmark && <p>Landmark: {order.shippingAddress.landmark}</p>}
      {order.shippingAddress?.instructions && <p>Delivery instructions: {order.shippingAddress.instructions}</p>}
      <button type="button" className="order-action-btn-sm" onClick={async () => {
        const scope = ui.captureScope();
        try { await navigator.clipboard.writeText(addressText(order.shippingAddress)); ui.notify('Delivery address copied', {scope}); }
        catch { ui.notify('Copy unavailable. Select the displayed address to copy it.', {type:'error',scope}); }
      }}>Copy delivery address</button>
    </section>
    <section className="seller-detail-items"><h2>Order items <span className="seller-detail-item-count">{order.items?.length || 0}</span></h2>{(order.items || []).map((item, index) => <article className="seller-detail-item" key={item.productId || index}>
      {item.image && <img src={item.image} alt="" />}
      <div><strong>{item.name}</strong><p>SKU: {item.sku || 'Not recorded'} · {item.variantName || item.unit || 'Standard item'}</p>
        <p>Quantity: {item.qty} · Unit price: {money(item.price)} · Line total: {money(item.lineTotal)}</p>
        {item.additionalMessage && <p>Customer message: {item.additionalMessage}</p>}</div>
    </article>)}</section>
    <section className="seller-detail-pickup"><h2>Store & pickup location</h2><p><strong>{order.store?.name || 'Not recorded'}</strong></p><address>{addressText(order.store?.pickupAddress)}</address><p>{order.store?.pickupAddress?.phone}</p>
      <p>Shiprocket pickup: {order.store?.pickupLocation || 'Not linked. Contact platform support to register and link your store pickup location.'}</p>
      <p>Provider eligibility is rechecked before shipment creation.</p>
    </section>
    <section className="seller-detail-manual"><h2>Bulkimart delivery</h2>{delivery ? <><p>Rider: {delivery.rider?.name || 'Name not recorded'}<br />Contact: {delivery.rider?.phone || 'Not recorded'}<br />Assignment status: {delivery.status}<br />Assigned: {date(delivery.assignedAt)}</p>
      {delivery.completedAt && <p>Completed: {date(delivery.completedAt)} · Delivery OTP verified: {delivery.otpVerified ? 'Yes' : 'No'}</p>}</>
      : <p>{order.fulfillment?.method === 'manual' ? 'Waiting for an eligible rider to accept. Sellers do not assign riders directly.' : 'Manual delivery not assigned.'}</p>}</section>
    <section className="seller-detail-courier"><h2>Courier shipment</h2>{shipment ? <><p>Provider: Shiprocket<br />Courier: {shipment.courier || 'Not assigned'}<br />Shipment: {shipment.shipmentId || 'Not created'}<br />AWB: {shipment.awb || 'Not assigned'}<br />Status: {shipment.status || 'Not recorded'}</p>
      <p>Registered pickup: {shipment.pickupLocation || order.store?.pickupLocation || 'Not recorded'}<br />{addressText(shipment.pickupAddress)}</p>
      <p>Destination: {addressText(order.shippingAddress)}</p>
      {shipment.package && <p>Parcel: {shipment.package.length} × {shipment.package.breadth} × {shipment.package.height} cm · {shipment.package.weight} kg</p>}
      <p>Created/requested: {date(shipment.requestedAt)}<br />Pickup scheduled: {date(shipment.pickupScheduledAt)}<br />Latest tracking: {shipment.webhookEvents?.at(-1)?.status || shipment.status} · {date(shipment.webhookEvents?.at(-1)?.receivedAt)}</p>
      <div className="seller-detail-links">{link(shipment.trackingUrl, 'Track shipment')}{link(shipment.labelUrl, 'Download label')}{link(shipment.invoiceUrl, 'Download invoice')}</div>
      {shipment.lastError && <p role="alert">{shipment.lastError}</p>}
      {shipment.status === 'reconciliation_required' && <p>Contact platform support to reconcile this order with Shiprocket before retrying. Shipment creation is locked.</p>}</> : <p>No courier shipment created.</p>}</section>
    <section className="seller-detail-timeline"><h2>Status timeline</h2><ol>{sellerTimeline(order.timeline).map((event, index, all) => {
      // A step that repeats the previous status (e.g. payment confirmed while the
      // order is still placed) is titled by its note, not a second "Order placed".
      const repeat = index > 0 && all[index - 1].status === event.status && event.note;
      return <li key={index}><strong>{repeat ? event.note : statusText(event.status)}</strong><time>{date(event.timestamp)}</time>{event.note && !repeat && <p>{event.note}</p>}</li>;
    })}</ol>{!order.timeline?.length && <p>No status updates recorded yet.</p>}</section>
  </div>;
}
