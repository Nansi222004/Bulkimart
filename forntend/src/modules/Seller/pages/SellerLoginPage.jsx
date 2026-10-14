import React, { useState, useEffect } from 'react';
import { useSeller } from '../context/SellerContext';
import BrandLogo from '../../../components/BrandLogo';
import { apiUrl } from '../../../utils/api';
import { normalizePhoneInput, safeErrorMessage } from '../utils/sellerAuth';

/**
 * Seller sign-in and store registration entry.
 *
 * One number, one identity: the phone used during registration is the phone used
 * to sign in, forever. Supports:
 *   - "Sign In" mode: for existing sellers to enter their dashboard
 *   - "Register Store" mode: for new merchants to verify phone and start store onboarding
 */
export const SellerLoginPage = ({ mode = 'login', onLoggedIn, onBack, onToggleMode }) => {
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
    triggerToast,
  } = useSeller();

  const [currentMode, setCurrentMode] = useState(mode || 'login');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (mode && mode !== currentMode) {
      setCurrentMode(mode);
    }
  }, [mode]);

  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    onToggleMode?.(newMode);
    setOtpSent(false);
    setOtpCode('');
    setOtpTimer(0);
    setSellerPhone('');
    setFormError('');
  };

  const changePhone = () => {
    setOtpSent(false);
    setOtpCode('');
    setOtpTimer(0);
    setSellerPhone('');
  };

  const handleSend = async () => {
    setFormError('');
    setBusy(true);
    const result = await sendOtp(currentMode);
    setBusy(false);
    if (!result?.ok) {
      setFormError(result?.message || 'Could not send OTP.');
      if (result?.code === 'SELLER_EXISTS') setCurrentMode('login');
      if (result?.code === 'SELLER_NOT_FOUND' || result?.code === 'NOT_A_MEMBER') setCurrentMode('register');
    }
  };

  const handleVerify = async () => {
    setFormError('');
    setBusy(true);
    const res = await verifyOtpAndLogin(currentMode);
    setBusy(false);
    if (res.ok) onLoggedIn?.();
    else setFormError(res.message || 'OTP verification failed.');
  };

  const isRegister = currentMode === 'register';

  return (
    <div className="seller-main-content seller-auth-page">
      <div className="seller-header-row">
        <BrandLogo className="seller-auth-logo" variant="compact" portal="Seller" transparent />
      </div>

      <div className="onboarding-container">
        {/* Mode Switcher Tabs */}
        <div style={{
          display: 'flex',
          backgroundColor: '#f1f5f9',
          borderRadius: '12px',
          padding: '4px',
          marginBottom: '20px',
          border: '1px solid #e2e8f0',
        }}>
          <button
            type="button"
            onClick={() => handleModeChange('login')}
            style={{
              flex: 1,
              padding: '9px 14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: '700',
              cursor: 'pointer',
              backgroundColor: !isRegister ? '#ffffff' : 'transparent',
              color: !isRegister ? '#0f172a' : '#64748b',
              boxShadow: !isRegister ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            🔑 Sign In
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('register')}
            style={{
              flex: 1,
              padding: '9px 14px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '13px',
              fontWeight: '700',
              cursor: 'pointer',
              backgroundColor: isRegister ? '#ffffff' : 'transparent',
              color: isRegister ? '#0f172a' : '#64748b',
              boxShadow: isRegister ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            🏪 Register Store
          </button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div
            style={{
              width: 52, height: 52, borderRadius: 14, margin: '0 auto 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isRegister ? '#059669' : 'var(--primary, #15803d)', color: '#fff',
              fontSize: 20, fontWeight: 900, letterSpacing: 0.5,
            }}
          >
            {isRegister ? '🏪' : 'BM'}
          </div>
        </div>

        <h3 className="onboarding-title" style={{ textAlign: 'center' }}>
          {isRegister ? 'Register Your Store' : 'Seller Sign In'}
        </h3>
        <p className="onboarding-subtitle" style={{ textAlign: 'center' }}>
          {isRegister
            ? 'Enter your mobile number to begin seller onboarding and register your store.'
            : 'Enter the mobile number you registered your store with.'}
        </p>
        {formError && <div className="seller-auth-error" role="alert">{formError}</div>}

        {/* Informational banner in Register mode */}
        {isRegister && (
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '16px',
            fontSize: '11px',
            color: '#166534',
            lineHeight: 1.5,
          }}>
            <strong>🚀 3-Step Store Setup:</strong>
            <div style={{ marginTop: '4px', color: '#15803d' }}>
              1. Phone OTP Verification &nbsp;➔&nbsp; 2. Store & Bank Info &nbsp;➔&nbsp; 3. KYC Docs
            </div>
          </div>
        )}

        <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (!otpSent) handleSend(); else handleVerify(); }}>
          <div className="onboarding-form-group">
            <label className="onboarding-label">Mobile Number</label>
            <input
              type="tel"
              className="onboarding-input"
              placeholder="Enter 10-digit number"
              maxLength={18}
              autoComplete="off"
              value={sellerPhone}
              disabled={otpSent || busy}
              onChange={(e) => setSellerPhone(normalizePhoneInput(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter' && sellerPhone.length === 10) handleSend(); }}
            />
          </div>

          {!otpSent ? (
            <button
              type="submit"
              className="primary-onboarding-btn"
              disabled={sellerPhone.length !== 10 || busy}
            >
              {busy ? 'Sending OTP…' : (isRegister ? 'Send OTP to Register' : 'Send OTP')}
            </button>
          ) : (
            <>
              <div className="onboarding-form-group" style={{ marginTop: 12 }}>
                <label className="onboarding-label">Enter OTP Code</label>
                <input
                  type="text"
                  className="onboarding-input"
                  placeholder="Enter 4-digit code"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length >= 4) handleVerify(); }}
                />
                {otpTimer > 0 ? (
                  <span className="otp-countdown-lbl">Resend code in {otpTimer}s</span>
                ) : (
                  <button type="button" className="otp-resend-btn" onClick={handleSend}>Resend Code</button>
                )}
              </div>

              <button
                type="submit"
                className="primary-onboarding-btn"
                disabled={otpCode.length < 4 || busy}
              >
                {busy ? 'Verifying…' : (isRegister ? 'Verify & Continue Registration' : 'Sign In')}
              </button>
              <button type="button" className="otp-resend-btn" onClick={changePhone} disabled={busy}>
                Change mobile number
              </button>
            </>
          )}
        </form>

        {/* Toggle mode helper links */}
        <div style={{ textAlign: 'center', marginTop: 18, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          {!isRegister ? (
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Don't have a seller account?{' '}
              <button
                type="button"
                onClick={() => handleModeChange('register')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#15803d',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Register your store here
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Already registered as a seller?{' '}
              <button
                type="button"
                onClick={() => handleModeChange('login')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#15803d',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Sign in here
              </button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button className="otp-resend-btn" onClick={onBack || (() => { window.location.href = '/'; })}>
            ← Back to store
          </button>
        </div>
      </div>
    </div>
  );
};

export default SellerLoginPage;
