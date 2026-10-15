import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';

export const SellerOrderRingModal = ({ order, onAccept, onDecline }) => {
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes (120s) countdown timer
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onDecline(); // auto decline / timeout
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onDecline]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const token = localStorage.getItem('sellerToken');
      const res = await fetch(apiUrl(`/api/sellers/orders/${order.orderId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to accept order');
      
      onAccept(order.orderId);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error accepting order');
    } finally {
      setAccepting(false);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const itemsSubtotal = order.pricing?.subtotal !== undefined && order.pricing?.subtotal !== null
    ? order.pricing.subtotal
    : (order.items?.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.qty) || 1)), 0) || 0);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      fontFamily: "'Outfit', sans-serif"
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 24,
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
        border: '1.5px solid #e2e8f0',
        animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
      }}>
        {/* Header alert section */}
        <div style={{
          background: 'linear-gradient(135deg, #10b981, #059669)',
          padding: '20px 24px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'relative'
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#fff',
            animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite'
          }} />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            ⚡ New Incoming Order Request
          </span>
          <span style={{
            position: 'absolute',
            right: 24,
            fontSize: 12,
            fontWeight: 800,
            background: 'rgba(255, 255, 255, 0.2)',
            padding: '2px 8px',
            borderRadius: 12
          }}>
            {formatTime(timeLeft)}
          </span>
        </div>

        {/* Content detail section */}
        <div style={{ padding: 24 }}>
          {/* Order specs */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Order ID</span>
              <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>{order.orderNo}</strong>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Product Subtotal</span>
              <strong style={{ fontSize: 20, color: '#10b981', fontWeight: 900 }}>₹{itemsSubtotal}</strong>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '0 0 16px 0' }} />

          {/* Customer and Delivery info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Customer Name</span>
              <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{order.shippingAddress?.name}</strong>
            </div>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Delivery Address</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4, display: 'block' }}>
                {order.shippingAddress?.line1}, {order.shippingAddress?.city}
              </span>
            </div>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Payment Method</span>
              <strong style={{ fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                {order.paymentMethod === 'cod' ? '💵 Cash on Delivery' : '💳 Paid Online'}
              </strong>
            </div>
          </div>

          {/* Items checklist */}
          <div style={{
            background: '#f8fafc',
            borderRadius: 16,
            padding: 16,
            border: '1px solid #e2e8f0',
            maxHeight: 120,
            overflowY: 'auto',
            marginBottom: 24
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', marginBottom: 8 }}>
              Items Ordered ({order.items?.length})
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {order.items?.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.qty}x {item.name}</span>
                    <strong>₹{item.price}</strong>
                  </div>
                  <div style={{ fontSize: 11, color: item.additionalMessage ? '#1d4ed8' : '#94a3b8', fontStyle: item.additionalMessage ? 'italic' : 'normal', paddingLeft: 6, fontWeight: item.additionalMessage ? 600 : 400 }}>
                    📝 Customer Message: {item.additionalMessage ? `"${item.additionalMessage}"` : 'No additional message provided.'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={onDecline}
              disabled={accepting}
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 16,
                border: '1.5px solid #fecaca',
                background: '#fff',
                color: '#dc2626',
                fontWeight: 800,
                fontSize: 14,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              disabled={accepting}
              style={{
                flex: 2,
                padding: '12px 16px',
                borderRadius: 16,
                border: 'none',
                background: accepting ? '#6ee7b7' : 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                fontWeight: 800,
                fontSize: 14,
                cursor: accepting ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.2)'
              }}
            >
              {accepting ? 'Accepting...' : 'Accept Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SellerOrderRingModal;
