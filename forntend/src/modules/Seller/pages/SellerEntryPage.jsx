import React from 'react';
import BrandLogo from '../../../components/BrandLogo';

/**
 * Shown when a user taps "Become a Seller" without an active session.
 *
 * Someone who already registered must not be pushed through the 9-step wizard
 * again — they just sign in with their registered number. Someone new needs the
 * full registration. Both paths still go through OTP (the account is the
 * identity either way), but the intent changes what happens after sign-in.
 */
const OPTIONS = [
  {
    key: 'login',
    icon: '🔑',
    title: 'I already have a seller account',
    desc: 'Sign in with your registered mobile number to reach your dashboard or check your application status.',
    cta: 'Login',
  },
  {
    key: 'register',
    icon: '🏪',
    title: 'Register a new store',
    desc: 'First time selling on Bulkimart? Complete registration and submit your documents for verification.',
    cta: 'Register',
  },
];

export const SellerEntryPage = ({ onChoose }) => (
  <div className="seller-main-content">
    <div className="seller-header-row">
      <BrandLogo variant="compact" portal="Seller" />
    </div>

    <div className="onboarding-container">
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <div
          style={{
            width: 54, height: 54, borderRadius: 14, margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--primary, #15803d)', color: '#fff',
            fontSize: 20, fontWeight: 900, letterSpacing: 0.5,
          }}
        >
          BM
        </div>
      </div>

      <h3 className="onboarding-title" style={{ textAlign: 'center' }}>Sell on Bulkimart</h3>
      <p className="onboarding-subtitle" style={{ textAlign: 'center' }}>
        Choose how you would like to continue.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 22 }}>
        {OPTIONS.map((o) => (
          <div
            key={o.key}
            role="button"
            tabIndex={0}
            onClick={() => onChoose(o.key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChoose(o.key); }}
            style={{
              padding: '18px 20px',
              borderRadius: 16,
              border: '1.5px solid #e2e8f0',
              backgroundColor: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              transition: 'all 0.2s ease-in-out',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary, #15803d)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e2e8f0';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <div style={{ fontSize: 28 }}>{o.icon}</div>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{o.title}</h4>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>{o.desc}</p>
            </div>
            <span
              style={{
                fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                color: 'var(--primary, #15803d)',
              }}
            >
              {o.cta} →
            </span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button className="otp-resend-btn" onClick={() => { window.location.href = '/'; }}>
          ← Back to shopping
        </button>
      </div>
    </div>
  </div>
);

export default SellerEntryPage;
