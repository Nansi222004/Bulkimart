import React from 'react';
import { quickCommerceOrderRow } from '../utils/quickCommerceOrderDisplay';
import { orderDiscountRows } from '../../../utils/orderDiscounts';

const money = value => typeof value === 'number' && Number.isFinite(value) ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Not recorded';
const date = value => value ? new Date(value).toLocaleString('en-IN') : 'Not recorded';
const address = value => [...new Set([value?.line1, value?.line2, value?.address, value?.city, value?.state, value?.pincode].filter(Boolean))].join(', ') || 'Not recorded';
function Rows({ values }) {
  return <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
    {values.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value ?? 'Not recorded'}</dd></React.Fragment>)}
  </dl>;
}

export default function QuickCommerceOrderDetails({ order }) {
  const row = quickCommerceOrderRow(order), pricing = order.pricing || {};
  const rider = order.deliveryPartnerId, delivery = order.deliveryId;
  const discounts = orderDiscountRows(pricing);
  // Some historical orders have only couponDiscount, without a discount alias.
  if (!pricing.discountRepresentation && !pricing.discount && pricing.couponDiscount > 0) discounts.push(['Coupon discount', pricing.couponDiscount]);
  return <div className="admin-qcom-order-details">
    <section><h4>Order & payment</h4><Rows values={[
      ['Order ID', row.id], ['Reference', String(order._id)], ['Status', row.status], ['Placed on', date(order.createdAt)],
      ['Updated on', date(order.updatedAt)], ['Payment method', order.paymentMethod],
      ['Payment status', order.paymentId?.status || (order.paymentMethod === 'cod' ? 'Pay on delivery' : 'Not recorded')],
      ['Seller decision', order.vendorDecision?.status],
    ]} /></section>
    <section><h4>Customer & delivery address</h4><Rows values={[
      ['Customer', row.customer], ['Phone', order.shippingAddress?.phone || order.userId?.phone], ['Address', address(order.shippingAddress)],
      ['Landmark', order.shippingAddress?.landmark || order.shippingAddress?.placeName], ['Instructions', order.shippingAddress?.instructions],
    ]} />{order.shippingAddress?.landmarkImage && <img src={order.shippingAddress.landmarkImage} alt="Customer landmark" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} />}</section>
    <section><h4>Items & stores</h4>{(order.items || []).map((item, index) => <article key={item._id || index} style={{ borderBottom: '1px solid var(--sa-border)', padding: '8px 0' }}>
      <strong>{item.name}</strong><Rows values={[
        ['Store', item.sellerId?.storeDetails?.name || item.sellerId?.businessName], ['SKU / variant', item.sku || item.variantName],
        ['Quantity', item.qty], ['Unit price', money(item.price)], ['Line total', money(typeof item.price === 'number' && typeof item.qty === 'number' ? item.price * item.qty : undefined)],
        ['Customer message', item.additionalMessage],
      ]} />
    </article>)}</section>
    <section><h4>Payment summary</h4><Rows values={[
      ['Items subtotal', money(pricing.subtotal)], ...discounts.map(([label, amount]) => [label, `−${money(amount)}`]),
      ['Delivery charge', money(pricing.deliveryCharge)],
      ...(pricing.tipAmount > 0 ? [['Tip', money(pricing.tipAmount)]] : []),
      ['Total Amount', row.amount],
    ]} /></section>
    <section><h4>Delivery partner & progress</h4><Rows values={[
      ['Store / hub', row.hub], ['Rider', row.rider], ['Rider phone', rider?.userId?.phone],
      ['Vehicle', [rider?.vehicleType, rider?.vehicleNo].filter(Boolean).join(' ') || 'Not recorded'],
      ['Delivery status', delivery?.status], ['Promised by', date(order.delivery?.promisedBy)],
      ['Started on', date(delivery?.startTime)], ['Completed on', date(delivery?.endTime)],
      ['Delivery OTP verified', delivery?.otpVerified == null ? 'Not recorded' : delivery.otpVerified ? 'Yes' : 'No'],
    ]} /></section>
    {(order.cancelReason || order.vendorDecision?.reason) && <p>Cancellation / rejection reason: {order.cancelReason || order.vendorDecision.reason}</p>}
    <section><h4>Status timeline</h4>{order.timeline?.length ? <ol>{order.timeline.map((event, index) => <li key={index}>{event.status} · {date(event.timestamp || event.at || event.createdAt)}{event.note ? ` · ${event.note}` : ''}</li>)}</ol> : <p>No status timeline recorded.</p>}</section>
  </div>;
}
