import React, { useState, useEffect } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import BrandLogo from '../../../components/BrandLogo';
import RegistrationTerms from '../../../components/RegistrationTerms';

/**
 * Rider sign-in and registration.
 *
 * One number, one identity. The phone a rider registers with is the phone they
 * sign in with from then on, and it is the same account they would use to shop
 * — a person is a person, whichever side of the app they are on.
 *
 * Registration asks for a name as well; signing in does not, because the name
 * is already stored and re-asking invites two spellings of the same rider.
 */
export const DeliveryAuthPage = () => {
  const {
    sendRiderOtp, verifyRiderOtp, saveRiderName,
    phoneVerified, riderPhone, setOnboardingStep, triggerToast,
  } = useDelivery();

  const [mode, setMode] = useState('login');   // 'register' | 'login'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);

  // Resend countdown. Without it a rider taps "resend" repeatedly and burns
  // through the server's OTP rate limit in seconds.
  useEffect(() => {
    if (timer <= 0) return;
    const id = setTimeout(() => setTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  const isRegister = mode === 'register';
  const nameOk = !isRegister || name.trim().length >= 2;

  const handleSend = async () => {
    if (isRegister && !nameOk) {
      triggerToast('Please enter your full name.');
      return;
    }
    setBusy(true);
    const res = await sendRiderOtp(phone, mode);
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }
    setOtpSent(true);
    setTimer(30);
    triggerToast(res.message);
  };

  const handleVerify = async () => {
    setBusy(true);
    const res = await verifyRiderOtp(phone, otp, isRegister ? name.trim() : undefined, mode);
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }

    // Drop a returning rider back where they stopped rather than at step 1.
    if (res.status === 'approved') {
      triggerToast('Welcome back!');
    } else {
      setOnboardingStep(Math.min(res.step || 1, 4));
      triggerToast('Mobile number verified.');
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setOtpSent(false);
    setOtp('');
    setTimer(0);
  };

  const handleSaveName = async () => {
    setBusy(true);
    const res = await saveRiderName(name);
    setBusy(false);
    if (!res.ok) { triggerToast(res.message); return; }
    setOnboardingStep(Math.min(res.step || 1, 4));
    triggerToast('Welcome aboard!');
  };

  // Someone signed in as a shopper who now wants to deliver: the phone is
  // already verified, so asking for an OTP again would be pointless friction.
  // All that is missing is a name.
  if (phoneVerified) {
    return (
      <div className="auth-page-container delivery-auth-page">
        <div className="auth-decoration" aria-hidden="true">
          <div className="auth-bg-blob blob-1"></div>
          <div className="auth-bg-blob blob-2"></div>
        </div>

        <div className="auth-card-wrapper">
          {busy && (
            <div className="auth-loading-overlay">
              <div className="auth-spinner"></div>
              <span className="auth-loading-text">Saving name...</span>
            </div>
          )}

          <div className="auth-brand-header">
            <BrandLogo audience="delivery" className="auth-brand-logo" variant="full" />
            <span className="auth-portal-badge auth-portal-badge--delivery">Delivery Partner</span>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>One Last Thing</h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0, lineHeight: 1.45 }}>
              {riderPhone
                ? `${riderPhone} is verified. What should we call you?`
                : 'Your number is verified. What should we call you?'}
            </p>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) handleSaveName(); }} className="auth-form-body">
            <div className="auth-input-group">
              <label htmlFor="rider-verified-name">Full Name</label>
              <input
                type="text"
                id="rider-verified-name"
                placeholder="As printed on your ID"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length >= 2) handleSaveName(); }}
                required
              />
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={name.trim().length < 2 || busy}
            >
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </form>

          <div className="auth-guest-footer">
            <button
              type="button"
              className="auth-guest-btn"
              onClick={() => { window.location.href = '/'; }}
            >
              ← Back to store
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page-container delivery-auth-page">
      {/* Background blobs for organic visual texture */}
      <div className="auth-decoration" aria-hidden="true">
        <div className="auth-bg-blob blob-1"></div>
        <div className="auth-bg-blob blob-2"></div>
      </div>

      <div className="auth-card-wrapper">
        {/* Loading Overlay */}
        {busy && (
          <div className="auth-loading-overlay">
            <div className="auth-spinner"></div>
            <span className="auth-loading-text">
              {!otpSent ? 'Sending OTP...' : 'Verifying OTP...'}
            </span>
          </div>
        )}

        {/* Brand Header */}
        <div className="auth-brand-header">
          <BrandLogo audience="delivery" className="auth-brand-logo" variant="full" />
          <span className="auth-portal-badge auth-portal-badge--delivery">Delivery Partner</span>
        </div>

        {/* Sliding Tab Selector */}
        {!otpSent && (
          <div className="auth-tab-slider-container">
            <div className={`auth-tab-slider-bg is-login-${!isRegister}`}></div>
            <button
              type="button"
              className={`auth-tab-btn ${!isRegister ? 'active' : ''}`}
              onClick={() => switchMode('login')}
              disabled={busy}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${isRegister ? 'active' : ''}`}
              onClick={() => switchMode('register')}
              disabled={busy}
            >
              Register
            </button>
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="auth-form-body">
            {isRegister && (
              <div className="auth-input-group">
                <label htmlFor="rider-name">Full Name</label>
                <input
                  type="text"
                  id="rider-name"
                  placeholder="As printed on your ID"
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="auth-input-group">
              <label htmlFor="rider-phone">Phone Number</label>
              <input
                type="tel"
                id="rider-phone"
                placeholder="10-digit mobile number"
                maxLength={10}
                value={phone}
                disabled={busy}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={(e) => { if (e.key === 'Enter' && phone.length === 10) handleSend(); }}
                required
              />
            </div>

            {isRegister && <p className="registration-terms-note">Read our <RegistrationTerms audience="delivery" /> before registering.</p>}
            <button
              type="submit"
              className="auth-submit-btn"
              disabled={phone.length !== 10 || !nameOk || busy}
            >
              {busy ? 'Sending OTP…' : (isRegister ? 'Send OTP to Register' : 'Send OTP Verification')}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="auth-form-body">
            <div className="auth-input-group" style={{ textAlign: 'center' }}>
              <label>Enter OTP sent to +91 {phone}</label>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                className="auth-otp-input"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && otp) handleVerify(); }}
                required
              />
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={!otp || busy}
            >
              {busy ? 'Verifying…' : (isRegister ? 'Verify & Continue Registration' : 'Verify & Sign In')}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => { setOtpSent(false); setOtp(''); setTimer(0); }}
                style={{ color: '#94a3b8' }}
                disabled={busy}
              >
                ← Change Number
              </button>
              {timer > 0 ? (
                <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Resend in {timer}s</span>
              ) : (
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={handleSend}
                  disabled={busy}
                >
                  Resend OTP
                </button>
              )}
            </div>
          </form>
        )}

        {!otpSent && (
          <div className="auth-toggle-helper">
            {!isRegister ? (
              <span>
                New to Bulkimart Delivery?{' '}
                <button
                  type="button"
                  className="auth-link-btn highlight"
                  onClick={() => switchMode('register')}
                >
                  Register here
                </button>
              </span>
            ) : (
              <span>
                Already registered as a partner?{' '}
                <button
                  type="button"
                  className="auth-link-btn highlight"
                  onClick={() => switchMode('login')}
                >
                  Sign in here
                </button>
              </span>
            )}
          </div>
        )}

        {/* Exit Footer */}
        <div className="auth-guest-footer">
          <button
            type="button"
            className="auth-guest-btn"
            onClick={() => { window.location.href = '/'; }}
          >
            ← Back to store
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryAuthPage;
