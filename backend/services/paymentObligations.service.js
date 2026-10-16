import { httpError } from '../utils/response.js';

export const razorpayAttempt = (payment, gatewayOrderId) => {
  const recorded = payment.gatewayAttempts?.find(attempt => attempt.gatewayOrderId === gatewayOrderId && attempt.provider === 'razorpay');
  if (recorded) return recorded;
  // Pending historical records have only the old gateway projection.
  if (payment.gateway?.provider === 'razorpay' && payment.gateway.orderId === gatewayOrderId) return {
    gatewayOrderId, orderId: payment.orderId, amountPaise: Math.round(payment.amount * 100), currency: 'INR', status: payment.status,
  };
  throw httpError(400, 'Razorpay attempt does not belong to this payment');
};

export const addRefundObligation = (payment, obligation) => {
  if (!Number.isSafeInteger(obligation.amountPaise) || obligation.amountPaise <= 0) throw httpError(400, 'Invalid refund obligation amount');
  if (!payment.refundObligations?.some(row => row.key === obligation.key)) {
    payment.refundObligations ||= [];
    payment.refundObligations.push({ ...obligation, currency: 'INR', status: 'pending', createdAt: new Date() });
  }
};

// The payment write serializes cancellation against capture, including while
// it is unpaid. The cancelled order remains the inventory-restoration guard.
export const coordinateOnlineCancellation = async (payment, order, session) => {
  if (payment.method !== 'online') return;
  payment.settlementRevision = (payment.settlementRevision || 0) + 1;
  if (['paid', 'partial_refund'].includes(payment.status)) {
    const capture = payment.captures?.find(row => row.disposition === 'settled');
    addRefundObligation(payment, {
      key: `CANCEL:${order._id}`, orderId: order._id,
      gatewayOrderId: capture?.gatewayOrderId || payment.gateway?.orderId,
      gatewayPaymentId: capture?.gatewayPaymentId || payment.gateway?.paymentId,
      amountPaise: Math.round((payment.groupRef ? order.pricing.totalAmount : payment.amount) * 100),
      reason: order.cancelReason || 'Order cancelled',
    });
  }
  await payment.save({ session });
};
