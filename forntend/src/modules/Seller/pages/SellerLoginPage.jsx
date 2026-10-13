import React, { useState, useEffect } from 'react';
import { useSeller } from '../context/SellerContext';
import BrandLogo from '../../../components/BrandLogo';
import { apiUrl } from '../../../utils/api';

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

  // Registration states when user is not yet a member in Bulkimart
  const [regOtpSent, setRegOtpSent] = useState(false);
  const [regOtpCode, setRegOtpCode] = useState('');
  const [regBusy, setRegBusy] = useState(false);

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
    setNotAMember(false);
    setRegOtpSent(false);
    setRegOtpCode('');
  };

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

  // Instant Account Activation for brand-new users registering as sellers
  const handleQuickRegisterSend = async () => {
    const phone = (sellerPhone || '').trim();
    if (phone.length !== 10) {
      triggerToast?.('Please enter a valid 10-digit mobile number.');
      return;
    }
    setRegBusy(true);
    try {
      const res = await fetch(apiUrl('/api/auth/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send OTP');
      setRegOtpSent(true);
      triggerToast?.(data.otp ? `OTP sent. Test code: ${data.otp}` : 'OTP sent to your mobile number.');
    } catch (err) {
      triggerToast?.(err.message);
    } finally {
      setRegBusy(false);
    }
  };

  const handleQuickRegisterVerify = async () => {
    const phone = (sellerPhone || '').trim();
    if (!regOtpCode || regOtpCode.length < 4) {
      triggerToast?.('Please enter the OTP code.');
      return;
    }
    setRegBusy(true);
    try {
      const res = await fetch(apiUrl('/api/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp: regOtpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'OTP verification failed');

      if (data.token) {
        localStorage.setItem('userToken', data.token);
      }
      if (data.user) {
        localStorage.setItem('userProfile', JSON.stringify(data.user));
      }

      setNotAMember(false);
      triggerToast?.('Account created successfully! Starting store registration…');
      onLoggedIn?.();
    } catch (err) {
      triggerToast?.(err.message);
    } finally {
      setRegBusy(false);
    }
  };

  // When a non-member phone is entered, offer instant account creation right here
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
              background: '#ecfdf5', color: '#059669', fontSize: 24, fontWeight: 900,
            }}>
              🏪
            </div>
          </div>

          <h3 className="onboarding-title" style={{ textAlign: 'center' }}>
            New to Bulkimart?
          </h3>
          <p className="onboarding-subtitle" style={{ textAlign: 'center' }}>
            Mobile number <strong>{sellerPhone}</strong> is not registered yet. Activate your account now to start your store onboarding.
          </p>

          {!regOtpSent ? (
            <div style={{ marginTop: 20 }}>
              <button
                className="primary-onboarding-btn"
                onClick={handleQuickRegisterSend}
                disabled={regBusy}
              >
                {regBusy ? 'Sending OTP…' : '⚡ Activate Account & Register Store'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div className="onboarding-form-group">
                <label className="onboarding-label">Enter Verification OTP</label>
                <input
                  type="text"
                  className="onboarding-input"
                  placeholder="Enter OTP (Test: 1234)"
                  maxLength={6}
                  autoFocus
                  value={regOtpCode}
                  onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleQuickRegisterVerify(); }}
                />
              </div>

              <button
                className="primary-onboarding-btn"
                style={{ marginTop: 8 }}
                onClick={handleQuickRegisterVerify}
                disabled={regOtpCode.length < 4 || regBusy}
              >
                {regBusy ? 'Verifying…' : 'Verify & Open Store Registration'}
              </button>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button
              className="otp-resend-btn"
              onClick={() => { setNotAMember(false); setSellerPhone(''); setRegOtpSent(false); }}
            >
              ← Use a different mobile number
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isRegister = currentMode === 'register';

  return (
    <div className="seller-main-content">
      <div className="seller-header-row">
        <BrandLogo variant="compact" portal="Seller" />
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

        {/* Demo Helper in Sign In Mode */}
        {!isRegister && (
          <div style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '11px',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>Approved Demo Seller: </span>
              <code>9000000011</code>
            </div>
            <button
              type="button"
              onClick={() => { setSellerPhone('9000000011'); }}
              style={{
                background: '#e2e8f0',
                border: 'none',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                color: '#0f172a',
              }}
            >
              ⚡ Fill
            </button>
          </div>
        )}

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
            {busy ? 'Sending OTP…' : (isRegister ? 'Send OTP to Register' : 'Send OTP')}
          </button>
        ) : (
          <>
            <div className="onboarding-form-group" style={{ marginTop: 12 }}>
              <label className="onboarding-label">Enter OTP Code</label>
              <input
                type="text"
                className="onboarding-input"
                placeholder="Enter 4-digit code (e.g. 1234)"
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
              {busy ? 'Verifying…' : (isRegister ? 'Verify & Continue Registration' : 'Sign In')}
            </button>
            <button type="button" className="otp-resend-btn" onClick={changePhone} disabled={busy}>
              Change mobile number
            </button>
          </>
        )}

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
