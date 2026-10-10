import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Sibling of SellerOrderRingModal — same 2-minute countdown/accept/decline
 * shape, for a new subscription request instead of a new order. The real
 * deadline is enforced server-side by subscriptionAcceptSweeper.service.js;
 * this countdown is the on-screen mirror of it, same relationship the order
 * modal already has with its own sweeper.
 */
export const SubscriptionRequestRingModal = ({ request, onAccept, onDecline }) => {
  const secondsLeft = () => Math.max(0, Math.round((new Date(request.acceptBy).getTime() - Date.now()) / 1000));
  const [timeLeft, setTimeLeft] = useState(secondsLeft());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDecline();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onDecline]);

  const respond = async (path, after) => {
    setBusy(true);
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(apiUrl(`/api/subscriptions/${request.subscriptionId}/${path}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not respond to this request');
      after();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Error responding to subscription request');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = () => respond('seller-accept', onAccept);
  const handleDecline = () => respond('seller-decline', onDecline);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const freqLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[request.frequency] || request.frequency;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      fontFamily: "'Outfit', sans-serif",
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, width: '100%', maxWidth: 420,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden', border: '1.5px solid #e2e8f0', animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #6366f1, #4338ca)', padding: '20px 24px', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12, position: 'relative',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            🔁 New Subscription Request
          </span>
          <span style={{
            position: 'absolute', right: 24, fontSize: 12, fontWeight: 800,
            background: 'rgba(255, 255, 255, 0.2)', padding: '2px 8px', borderRadius: 12,
          }}>
            {formatTime(timeLeft)}
          </span>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Plan</span>
              <strong style={{ fontSize: 16, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                {freqLabel} — {request.deliveries} deliveries
              </strong>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Plan Value</span>
              <strong style={{ fontSize: 20, color: '#4338ca', fontWeight: 900 }}>₹{request.finalAmount}</strong>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '0 0 16px 0' }} />

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
            A customer wants to subscribe to recurring deliveries from your store. Accepting commits you to
            fulfilling every scheduled delivery — you'll get a reminder to pack each one ahead of time.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={handleDecline}
              disabled={busy}
              style={{
                flex: 1, padding: '12px 16px', borderRadius: 16, border: '1.5px solid #fecaca',
                background: '#fff', color: '#dc2626', fontWeight: 800, fontSize: 14,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              disabled={busy}
              style={{
                flex: 2, padding: '12px 16px', borderRadius: 16, border: 'none',
                background: busy ? '#a5b4fc' : 'linear-gradient(135deg, #6366f1, #4338ca)',
                color: '#fff', fontWeight: 800, fontSize: 14,
                cursor: busy ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 6px -1px rgba(67, 56, 202, 0.2)',
              }}
            >
              {busy ? 'Please wait…' : 'Accept Subscription'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequestRingModal;
