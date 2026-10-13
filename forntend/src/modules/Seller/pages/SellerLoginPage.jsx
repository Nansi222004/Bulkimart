import React from 'react';
import { useSeller } from '../context/SellerContext';
import BrandLogo from '../../../components/BrandLogo';

/**
 * Seller sign-in.
 *
 * One number, one identity: the phone used during registration is the phone used
 * to sign in, forever. The same endpoint serves both cases —
 *   - existing seller  → signs in, lands on their dashboard or status screen
 *   - brand-new seller → account is created, lands on onboarding
 * so there is no separate "register" form to keep in sync.
 */
export const SellerLoginPage = ({ mode = 'login', onLoggedIn, onBack }) => {
  const {
    sellerPhone,
    setSellerPhone,
    otpSent,
    setOtpSent,
    otpCode,
    setOtpCode,
    otpTimer,
    setOtpTimer,
    sendOtp,
    verifyOtpAndLogin,
    notAMember,
    setNotAMember,
  } = useSeller();

  const [busy, setBusy] = React.useState(false);

  const changePhone = () => {
    setOtpSent(false);
    setOtpCode('');
    setOtpTimer(0);
    setSellerPhone('');
  };

  const handleSend = async () => {
    setBusy(true);
    await sendOtp();
    setBusy(false);
  };

  const handleVerify = async () => {
    setBusy(true);
    const res = await verifyOtpAndLogin();
    setBusy(false);
    if (res.ok) onLoggedIn?.();
  };

  // User is the base identity — a seller account is always an extension of
  // an existing Bulkimart Shopping App customer, never created fresh from this
  // screen. See auth.controller.js's requestSellerOTP/verifySellerOTP.
  if (notAMember) {
    return (
      <div className="seller-main-content">
        <div className="seller-header-row">
          <BrandLogo variant="compact" portal="Seller" />
        </div>

        <div className="onboarding-container">
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 14, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#fee2e2', color: '#dc2626', fontSize: 24, fontWeight: 900,
            }}>
              ✕
            </div>
          </div>

          <h3 className="onboarding-title" style={{ textAlign: 'center' }}>
            You are not a member of Bulkimart Shopping App
          </h3>
          <p className="onboarding-subtitle" style={{ textAlign: 'center' }}>
            Please download the Bulkimart Shopping App and create your account first.
            Selling on Bulkimart always starts from an existing shopper account —
            you'll be able to come straight back here afterwards.
          </p>

          <button
            className="primary-onboarding-btn"
            onClick={() => { window.location.href = '/'; }}
          >
            Open Bulkimart Shopping App
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              className="otp-resend-btn"
              onClick={() => { setNotAMember(false); setSellerPhone(''); }}
            >
              ← Try a different number
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="seller-main-content">
      <div className="seller-header-row">
        <BrandLogo variant="compact" portal="Seller" />
      </div>

      <div className="onboarding-container">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div
            style={{
              width: 54, height: 54, borderRadius: 14, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--primary, #15803d)', color: '#fff',
              fontSize: 20, fontWeight: 900, letterSpacing: 0.5,
            }}
          >
            NH
          </div>
        </div>

        <h3 className="onboarding-title" style={{ textAlign: 'center' }}>
          {mode === 'register' ? 'Verify Your Mobile Number' : 'Seller Sign In'}
        </h3>
        <p className="onboarding-subtitle" style={{ textAlign: 'center' }}>
          {mode === 'register'
            ? 'This number becomes your seller login. You will use it to sign in from now on.'
            : 'Enter the mobile number you registered your store with.'}
        </p>

        <div className="onboarding-form-group">
          <label className="onboarding-label">Mobile Number</label>
          <input
            type="tel"
            className="onboarding-input"
            placeholder="Enter 10-digit number"
            maxLength={10}
            value={sellerPhone}
            disabled={otpSent || busy}
            onChange={(e) => setSellerPhone(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter' && sellerPhone.length === 10) handleSend(); }}
          />
        </div>

        {!otpSent ? (
          <button
            className="primary-onboarding-btn"
            onClick={handleSend}
            disabled={sellerPhone.length !== 10 || busy}
          >
            {busy ? 'Sending…' : 'Send OTP'}
          </button>
        ) : (
          <>
            <div className="onboarding-form-group" style={{ marginTop: 12 }}>
              <label className="onboarding-label">Enter OTP</label>
              <input
                type="text"
                className="onboarding-input"
                placeholder="Enter the OTP code"
                maxLength={6}
                autoFocus
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length >= 4) handleVerify(); }}
              />
              {otpTimer > 0 ? (
                <span className="otp-countdown-lbl">Resend code in {otpTimer}s</span>
              ) : (
                <button className="otp-resend-btn" onClick={handleSend}>Resend Code</button>
              )}
            </div>

            <button
              className="primary-onboarding-btn"
              onClick={handleVerify}
              disabled={otpCode.length < 4 || busy}
            >
              {busy ? 'Verifying…' : (mode === 'register' ? 'Verify & Continue' : 'Sign In')}
            </button>
            <button type="button" className="otp-resend-btn" onClick={changePhone} disabled={busy}>
              Change mobile number
            </button>
          </>
        )}

        {mode === 'register' && (
          <p style={{ fontSize: 11, opacity: 0.65, textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
            After verification you will complete your store details and upload documents.
          </p>
        )}

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="otp-resend-btn" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default SellerLoginPage;
