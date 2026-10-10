import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import BrandLogo from '../../../components/BrandLogo';

const AuthPage = () => {
  const { sendOtp, verifyOtp, updateUserProfile, loginUser } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');

  // OTP flow steps: 'phone' or 'otp'
  const [step, setStep] = useState('phone');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [mockOtpHint, setMockOtpHint] = useState('');

  // Form states
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Referral Program — manual entry, for someone who was told a code
  // verbally/over text rather than via a `?ref=` link (UserContext only
  // auto-captures the link form). Pre-filled from whatever a link may
  // already have stashed, and kept in sync with that same localStorage key
  // so `verifyOtp` (which reads it at signup) sees this field's value too.
  const [referralCode, setReferralCode] = useState(() => {
    try { return localStorage.getItem('pendingReferralCode') || ''; } catch { return ''; }
  });

  useEffect(() => {
    try {
      if (referralCode.trim()) localStorage.setItem('pendingReferralCode', referralCode.trim().toUpperCase());
      else localStorage.removeItem('pendingReferralCode');
    } catch { /* best-effort only */ }
  }, [referralCode]);

  // Client-side phone validation
  const validatePhone = () => {
    const newErrors = {};
    if (!phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (phone.trim().length !== 10 || !/^\d+$/.test(phone)) {
      newErrors.phone = 'Phone number must be exactly 10 digits';
    }
    
    if (!isLogin) {
      if (!name.trim()) {
        newErrors.name = 'Full name is required';
      }
      if (!email.trim()) {
        newErrors.email = 'Email address is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newErrors.email = 'Invalid email address format';
      }
      if (!agreeTerms) {
        newErrors.terms = 'You must agree to the Terms & Conditions';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSendOTP = async (e) => {
    if (e) e.preventDefault();
    if (!validatePhone()) return;

    setIsLoading(true);
    setErrors({});
    setSuccessMessage('');

    const result = await sendOtp(phone.trim(), isLogin);
    setIsLoading(false);

    if (result.success) {
      setStep('otp');
      setSuccessMessage('OTP sent successfully to your mobile number.');
      if (result.otp) {
        // Mock mode: display OTP on UI for easy testing
        setMockOtpHint(result.otp);
      }
    } else {
      setErrors({ api: result.message || 'Failed to send OTP.' });
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!enteredOtp || enteredOtp.trim().length !== 4) {
      setErrors({ otp: 'Please enter a valid 4-digit OTP' });
      return;
    }

    setIsLoading(true);
    setErrors({});

    const result = await verifyOtp(phone.trim(), enteredOtp.trim(), isLogin, name.trim(), email.trim());
    
    if (result.success) {
      // If user was registering, update profile details in backend
      if (!isLogin && (name.trim() || email.trim())) {
        const updateResult = await updateUserProfile(name.trim(), email.trim(), false);
        if (!updateResult.success) {
          console.warn('Profile update failed:', updateResult.message);
        }
      }
      setIsLoading(false);
    } else {
      setIsLoading(false);
      setErrors({ otp: result.message || 'OTP verification failed' });
    }
  };

  const handleBackToPhone = () => {
    setStep('phone');
    setEnteredOtp('');
    setMockOtpHint('');
    setErrors({});
    setSuccessMessage('');
  };

  return (
    <div className="auth-page-container">
      {/* Background blobs for organic visual texture */}
      <div className="auth-bg-blob blob-1"></div>
      <div className="auth-bg-blob blob-2"></div>
      
      <div className="auth-card-wrapper">
        {/* Loading Overlay */}
        {isLoading && (
          <div className="auth-loading-overlay">
            <div className="auth-spinner"></div>
            <span className="auth-loading-text">
              {step === 'phone' ? 'Sending OTP...' : 'Verifying OTP...'}
            </span>
          </div>
        )}

        {/* Brand Header */}
        <div className="auth-brand-header">
          <BrandLogo className="auth-brand-logo" variant="full" transparent />
        </div>

        {/* Mode Slider Tab Selector - only show when in 'phone' entry step */}
        {step === 'phone' && (
          <div className="auth-tab-slider-container">
            <div className={`auth-tab-slider-bg is-login-${isLogin}`}></div>
            <button 
              type="button" 
              className={`auth-tab-btn ${isLogin ? 'active' : ''}`}
              onClick={() => {
                setIsLogin(true);
                setErrors({});
                setPhone('');
                setName('');
                setEmail('');
                setAgreeTerms(false);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${!isLogin ? 'active' : ''}`}
              onClick={() => {
                setIsLogin(false);
                setErrors({});
                setPhone('');
                setName('');
                setEmail('');
                setAgreeTerms(false);
                // Referral code is register-only — a Sign In has no signup
                // to attribute, so it's left alone rather than cleared here.
              }}
            >
              Register
            </button>
          </div>
        )}

        {/* Success / Status alerts */}
        {successMessage && (
          <div style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '10px',
            padding: '12px',
            color: '#34d399',
            fontSize: '13px',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            {successMessage}
          </div>
        )}

        {errors.api && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '12px',
            color: '#fca5a5',
            fontSize: '13px',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            {errors.api}
          </div>
        )}

        {/* Auth Form */}
        {step === 'phone' ? (
          <form onSubmit={handleSendOTP} className="auth-form-body">
            {!isLogin && (
              <>
                <div className="auth-input-group">
                  <label htmlFor="name">Full Name</label>
                  <input
                    type="text"
                    id="name"
                    placeholder="e.g. Rahul Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={errors.name ? 'has-error' : ''}
                    required
                  />
                  {errors.name && <span className="auth-error-msg">{errors.name}</span>}
                </div>

                <div className="auth-input-group">
                  <label htmlFor="email">Email Address</label>
                  <input
                    type="email"
                    id="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={errors.email ? 'has-error' : ''}
                    required
                  />
                  {errors.email && <span className="auth-error-msg">{errors.email}</span>}
                </div>
              </>
            )}

            <div className="auth-input-group">
              <label htmlFor="phone">Phone Number</label>
              <input
                type="tel"
                id="phone"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={errors.phone ? 'has-error' : ''}
                maxLength={10}
                required
              />
              {errors.phone && <span className="auth-error-msg">{errors.phone}</span>}
            </div>

            {!isLogin && (
              <>
                <div className="auth-input-group">
                  <label htmlFor="referralCode">Referral Code (optional)</label>
                  <input
                    type="text"
                    id="referralCode"
                    placeholder="e.g. NHA7K2Q9"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    maxLength={12}
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="auth-form-options">
                  <label className="auth-checkbox-label terms-checkbox">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className={errors.terms ? 'has-error' : ''}
                    />
                    I agree to the Terms & Conditions
                  </label>
                  {errors.terms && <span className="auth-error-msg terms-error">{errors.terms}</span>}
                </div>
              </>
            )}

            <button type="submit" className="auth-submit-btn">
              Send OTP Verification
            </button>
          </form>
        ) : (
          /* OTP Entry Step */
          <form onSubmit={handleVerifyOTP} className="auth-form-body">
            <div className="auth-input-group" style={{ textAlign: 'center' }}>
              <label>Enter 4-Digit OTP sent to +91 {phone}</label>
              
              <input
                type="text"
                maxLength={4}
                value={enteredOtp}
                onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                style={{
                  fontSize: '28px',
                  letterSpacing: '12px',
                  textAlign: 'center',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1.5px solid #334155',
                  backgroundColor: '#0f172a',
                  color: '#fff',
                  width: '180px',
                  margin: '16px auto',
                  display: 'block'
                }}
                className={errors.otp ? 'has-error' : ''}
                required
              />
              {errors.otp && <span className="auth-error-msg" style={{ display: 'block' }}>{errors.otp}</span>}
            </div>

            <button type="submit" className="auth-submit-btn">
              {isLogin ? 'Verify & Sign In' : 'Verify & Register'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
              <button 
                type="button" 
                className="auth-link-btn" 
                onClick={handleBackToPhone}
                style={{ color: '#94a3b8' }}
              >
                ← Back to Phone
              </button>
              <button 
                type="button" 
                className="auth-link-btn" 
                onClick={() => handleSendOTP()}
              >
                Resend OTP
              </button>
            </div>
          </form>
        )}

        {/* Separator Divider */}
        <div className="auth-divider-container">
          <div className="auth-divider-line"></div>
          <span className="auth-divider-text">Or Connect With</span>
          <div className="auth-divider-line"></div>
        </div>

        {/* Social Authentication Connect */}
        <div className="auth-social-row">
          <button 
            type="button" 
            onClick={() => {
              // Direct mock login for testing ease
              loginUser('social@example.com', 'social123');
            }} 
            className="auth-social-btn flex-1" 
            aria-label="Sign in with Google"
          >
            <svg className="social-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google
          </button>
        </div>

        {/* Footer Guest Entry */}
        <div className="auth-guest-footer">
          <button 
            type="button" 
            className="auth-guest-btn" 
            onClick={() => loginUser('guest@example.com', 'guest123')}
          >
            Continue as Guest
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
