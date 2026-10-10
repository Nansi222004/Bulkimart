import React, { useState } from 'react';
import { apiUrl } from '../utils/api';

const MockPhonePePage = () => {
  const params = new URLSearchParams(window.location.search);
  const merchantOrderId = params.get('merchantOrderId') || 'UNKNOWN';
  const amount = params.get('amount') || '0';
  const redirectUrl = params.get('redirectUrl') || '/profile';

  const [processing, setProcessing] = useState(false);

  const handleSimulatePayment = async (status) => {
    setProcessing(true);
    try {
      await fetch(apiUrl('/api/payments/mock-set-state'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantOrderId, state: status })
      });
    } catch (err) {
      console.error('Failed to set mock state:', err);
    } finally {
      // Redirect back to the handler URL (e.g. /api/wallet/topup/return/...)
      window.location.href = redirectUrl;
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#5f259f', // PhonePe Purple Accent
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: "'Outfit', sans-serif"
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '24px',
        maxWidth: '440px',
        width: '100%',
        padding: '32px 24px',
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0,0,0,0.25)'
      }}>
        {/* Header Branding */}
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          backgroundColor: '#5f259f',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
          fontWeight: '900',
          margin: '0 auto 16px auto',
          boxShadow: '0 4px 12px rgba(95, 37, 159, 0.3)'
        }}>
          पे
        </div>

        <span style={{
          fontSize: '11px',
          fontWeight: '800',
          color: '#5f259f',
          backgroundColor: '#f3e8ff',
          padding: '4px 12px',
          borderRadius: '20px',
          letterSpacing: '1px',
          textTransform: 'uppercase'
        }}>
          PhonePe Sandbox Simulator
        </span>

        <h2 style={{ margin: '16px 0 4px 0', fontSize: '28px', fontWeight: '900', color: '#0f172a' }}>
          ₹{Number(amount).toFixed(2)}
        </h2>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 24px 0' }}>
          Payment to Bulkimart • Txn Ref: <span style={{ fontFamily: 'monospace', fontWeight: '700' }}>{merchantOrderId}</span>
        </p>

        {/* Payment Options Simulation */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderRadius: '16px',
          padding: '16px',
          marginBottom: '24px',
          border: '1px solid #e2e8f0',
          textAlign: 'left'
        }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
            Simulated Payment Mode
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <span>PhonePe Instant UPI (Sandbox Test Account)</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={() => handleSimulatePayment('COMPLETED')}
            disabled={processing}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#1b7a37',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontWeight: '800',
              fontSize: '15px',
              cursor: processing ? 'wait' : 'pointer',
              boxShadow: '0 4px 12px rgba(27, 122, 55, 0.2)'
            }}
          >
            {processing ? 'Processing...' : `✓ Pay ₹${Number(amount).toFixed(2)} (Simulate Success)`}
          </button>

          <button
            onClick={() => handleSimulatePayment('FAILED')}
            disabled={processing}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              border: '1.5px solid #fecaca',
              borderRadius: '12px',
              fontWeight: '700',
              fontSize: '13.5px',
              cursor: processing ? 'wait' : 'pointer'
            }}
          >
            ✕ Fail / Cancel Payment
          </button>
        </div>

        <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '20px', margin: '20px 0 0 0' }}>
          This is a sandbox simulation environment. No actual money will be charged.
        </p>
      </div>
    </div>
  );
};

export default MockPhonePePage;
