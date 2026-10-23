import React from 'react';
import GstAssistance from '../../../components/gst/GstAssistance';

/**
 * Blocks the seller panel until an admin has approved the account.
 *
 * Completing registration is NOT the same as being approved — a submitted
 * application must only show its own status, never dashboard features.
 * The backend enforces this too (middlewares/vendor.middleware.js); this screen
 * exists so the seller sees a clear explanation instead of failed requests.
 */

const SHELL = {
  minHeight: '70vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const CARD = {
  maxWidth: 420,
  width: '100%',
  textAlign: 'center',
  padding: '32px 24px',
  borderRadius: 16,
  border: '1px solid rgba(148,163,184,0.25)',
  background: 'rgba(148,163,184,0.06)',
};

const STATES = {
  pending: {
    icon: '⏳',
    tone: '#f59e0b',
    title: 'Application under review',
    body: 'Your seller application has been submitted successfully. Our team is verifying your documents — this usually takes 24–48 hours.',
    note: 'You will be able to add products and access your dashboard as soon as it is approved.',
  },
  under_review: {
    icon: '🔎',
    tone: '#f59e0b',
    title: 'Verification in progress',
    body: 'An administrator is currently reviewing your documents.',
    note: 'No action is needed from you right now.',
  },
  rejected: {
    icon: '⚠️',
    tone: '#ef4444',
    title: 'Application rejected',
    body: 'Unfortunately your seller application was not approved.',
    note: 'Please correct the issue below and submit again.',
  },
  suspended: {
    icon: '🚫',
    tone: '#ef4444',
    title: 'Account suspended',
    body: 'Your seller account has been suspended by an administrator.',
    note: 'Please contact support for assistance.',
  },
};

export const SellerStatusGate = ({ status, storeName, rejectionReason, onRetry, onExit }) => {
  const s = STATES[status] || STATES.pending;

  return (
    <div style={SHELL}>
      <div style={CARD}>
        <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 12 }}>{s.icon}</div>

        {storeName && (
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{storeName}</div>
        )}

        <GstAssistance />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 10px', color: s.tone }}>
          {s.title}
        </h2>

        <p style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.85, margin: '0 0 10px' }}>{s.body}</p>

        {rejectionReason && (
          <div
            style={{
              margin: '12px 0',
              padding: 12,
              borderRadius: 10,
              textAlign: 'left',
              fontSize: 12,
              lineHeight: 1.5,
              border: `1px solid ${s.tone}55`,
              background: `${s.tone}14`,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>Reason</strong>
            {rejectionReason}
          </div>
        )}

        <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 20px' }}>{s.note}</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '9px 18px', borderRadius: 9, fontWeight: 800, fontSize: 12,
                border: '1px solid rgba(148,163,184,0.35)', background: 'transparent',
                color: 'inherit', cursor: 'pointer',
              }}
            >
              Check status again
            </button>
          )}
          {onExit && (
            <button
              onClick={onExit}
              style={{
                padding: '9px 18px', borderRadius: 9, fontWeight: 800, fontSize: 12,
                border: 'none', background: '#10b981', color: '#062e24', cursor: 'pointer',
              }}
            >
              Back to shopping
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerStatusGate;
