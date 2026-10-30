import React, { useState, useEffect } from 'react';
import { useSeller } from '../context/SellerContext';
import BrandLogo from '../../../components/BrandLogo';
import RegistrationTerms from '../../../components/RegistrationTerms';
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
  const [noSellerFound, setNoSellerFound] = useState(false);

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
    setNoSellerFound(false);
  };

  const changePhone = () => {
    setOtpSent(false);
    setOtpCode('');
    setOtpTimer(0);
    setSellerPhone('');
    setFormError('');
    setNoSellerFound(false);
  };

  const handleSend = async () => {
    setFormError('');
    setBusy(true);
    const result = await sendOtp(currentMode);
    setBusy(false);
    if (!result?.ok) {
      if (currentMode === 'login' && (result?.code === 'SELLER_NOT_FOUND' || result?.code === 'NOT_A_MEMBER')) {
        setNoSellerFound(true);
        return;
      }
      setFormError(result?.message || 'Could not send OTP.');
      if (result?.code === 'SELLER_EXISTS') setCurrentMode('login');
    }
  };

  const handleVerify = async () => {
    setFormError('');
    setBusy(true);
    const res = await verifyOtpAndLogin(currentMode);
    setBusy(false);
    if (res.ok) onLoggedIn?.(currentMode);
    else setFormError(res.message || 'OTP verification failed.');
  };

  const isRegister = currentMode === 'register';

  return (
    <div className="auth-page-container seller-auth-page">
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
          <BrandLogo audience="seller" className="auth-brand-logo" variant="full" />
          <span className="auth-portal-badge auth-portal-badge--seller">Seller Portal</span>
        </div>

        {noSellerFound ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>No Seller Account Found</h3>
            <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.5, margin: '0 0 20px 0' }}>
              This mobile number {sellerPhone ? `(${sellerPhone}) ` : ''}is not registered as a seller on Bulkimart yet.
            </p>
            <button
              type="button"
              className="auth-submit-btn"
              onClick={() => {
                setNoSellerFound(false);
                handleModeChange('register');
              }}
            >
              Register My Store
            </button>
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => {
                  setNoSellerFound(false);
                  changePhone();
                }}
              >
                Use a different number
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Sliding Tab Selector */}
            {!otpSent && (
              <div className="auth-tab-slider-container">
                <div className={`auth-tab-slider-bg is-login-${!isRegister}`}></div>
                <button
                  type="button"
                  className={`auth-tab-btn ${!isRegister ? 'active' : ''}`}
                  onClick={() => handleModeChange('login')}
                  disabled={busy}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`auth-tab-btn ${isRegister ? 'active' : ''}`}
                  onClick={() => handleModeChange('register')}
                  disabled={busy}
                >
                  Register
                </button>
              </div>
            )}

            {formError && (
              <div className="auth-error-banner" role="alert">
                {formError}
              </div>
            )}

            {!otpSent ? (
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="auth-form-body">
                {isRegister && (
                  <div className="auth-info-banner">
                    <span className="auth-info-title">🚀 3-Step Store Setup:</span>
                    <span className="auth-info-sub">1. Phone OTP &nbsp;➔&nbsp; 2. Store & Bank Info &nbsp;➔&nbsp; 3. KYC Docs</span>
                  </div>
                )}

                <div className="auth-input-group">
                  <label htmlFor="seller-phone">Phone Number</label>
                  <input
                    type="tel"
                    id="seller-phone"
                    placeholder="10-digit mobile number"
                    maxLength={10}
                    value={sellerPhone}
                    disabled={busy}
                    onChange={(e) => setSellerPhone(normalizePhoneInput(e.target.value))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && sellerPhone.length === 10) handleSend(); }}
                    required
                  />
                </div>

                {isRegister && <p className="registration-terms-note">Read our <RegistrationTerms audience="seller" /> before registering.</p>}
                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={sellerPhone.length !== 10 || busy}
                >
                  {busy ? 'Sending OTP…' : (isRegister ? 'Send OTP to Register' : 'Send OTP Verification')}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="auth-form-body">
                <div className="auth-input-group" style={{ textAlign: 'center' }}>
                  <label>Enter 4-Digit OTP sent to +91 {sellerPhone}</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="auth-otp-input"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length >= 4) handleVerify(); }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={otpCode.length < 4 || busy}
                >
                  {busy ? 'Verifying…' : (isRegister ? 'Verify & Continue Registration' : 'Verify & Sign In')}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={changePhone}
                    style={{ color: '#94a3b8' }}
                    disabled={busy}
                  >
                    ← Change Number
                  </button>
                  {otpTimer > 0 ? (
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Resend in {otpTimer}s</span>
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
                    Don't have a seller account?{' '}
                    <button
                      type="button"
                      className="auth-link-btn highlight"
                      onClick={() => handleModeChange('register')}
                    >
                      Register your store here
                    </button>
                  </span>
                ) : (
                  <span>
                    Already registered as a seller?{' '}
                    <button
                      type="button"
                      className="auth-link-btn highlight"
                      onClick={() => handleModeChange('login')}
                    >
                      Sign in here
                    </button>
                  </span>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default SellerLoginPage;
