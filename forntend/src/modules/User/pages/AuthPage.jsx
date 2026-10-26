import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import BrandLogo from '../../../components/BrandLogo';
import RegistrationTerms from '../../../components/RegistrationTerms';

const AuthPage = () => {
  const { sendOtp, verifyOtp, updateUserProfile, setActiveNav } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');

  // OTP flow steps: 'phone' or 'otp'
  const [step, setStep] = useState('phone');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [mockOtpHint, setMockOtpHint] = useState('');
  const [resendDeadline, setResendDeadline] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRequest = useRef(false);

  useEffect(() => {
    if (step !== 'otp' || !resendDeadline) return;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step, resendDeadline]);

  // Form states
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);

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
    if (otpRequest.current || isLoading || (step === 'otp' && Date.now() < resendDeadline)) return;
    if (!validatePhone()) return;

    otpRequest.current = true;
    setIsLoading(true);
    setErrors({});
    setSuccessMessage('');

    try {
      const result = await sendOtp(phone.trim(), isLogin);
      if (result.success) {
        setStep('otp');
        setEnteredOtp('');
        setResendDeadline(Date.now() + 30000);
        setResendSeconds(30);
        setSuccessMessage('OTP sent successfully to your mobile number.');
        setMockOtpHint(result.otp || '');
      } else {
        setErrors({ api: result.message || 'Failed to send OTP.' });
      }
    } catch (error) {
      setErrors({ api: error.message || 'Failed to send OTP.' });
    } finally {
      otpRequest.current = false;
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (isLoading) return;
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
        const updateResult = await updateUserProfile(name.trim(), email.trim());
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
    if (isLoading) return;
    setStep('phone');
    setEnteredOtp('');
    setMockOtpHint('');
    setResendDeadline(0);
    setResendSeconds(0);
    setErrors({});
    setSuccessMessage('');
  };

  return (
    <div className="auth-page-container">
      {/* Background blobs for organic visual texture */}
      <div className="auth-decoration" aria-hidden="true">
        <div className="auth-bg-blob blob-1"></div>
        <div className="auth-bg-blob blob-2"></div>
      </div>
      
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
              disabled={isLoading}
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
              disabled={isLoading}
              onClick={() => {
                setIsLogin(false);
                setErrors({});
                setPhone('');
                setName('');
                setEmail('');
                setAgreeTerms(false);
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
                <div className="auth-form-options">
                  <div className="auth-checkbox-label terms-checkbox">
                    <input
                      type="checkbox"
                      id="customer-registration-terms"
                      aria-label="I agree to the Terms & Conditions"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className={errors.terms ? 'has-error' : ''}
                    />
                    <span><label htmlFor="customer-registration-terms">I agree to the</label>{' '}<RegistrationTerms audience="user" /></span>
                  </div>
                  {errors.terms && <span className="auth-error-msg terms-error">{errors.terms}</span>}
                </div>
              </>
            )}

            <button type="submit" className="auth-submit-btn" disabled={isLoading}>
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
                className={`auth-otp-input${errors.otp ? ' has-error' : ''}`}
                required
              />
              {errors.otp && <span className="auth-error-msg" style={{ display: 'block' }}>{errors.otp}</span>}
            </div>

            <button type="submit" className="auth-submit-btn" disabled={isLoading}>
              {isLogin ? 'Verify & Sign In' : 'Verify & Register'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
              <button 
                type="button" 
                className="auth-link-btn" 
                onClick={handleBackToPhone}
                disabled={isLoading}
                style={{ color: '#94a3b8' }}
              >
                ← Back to Phone
              </button>
              <button 
                type="button" 
                className="auth-link-btn" 
                onClick={() => handleSendOTP()}
                disabled={isLoading || resendSeconds > 0}
              >
                {resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : 'Resend OTP'}
              </button>
            </div>
          </form>
        )}

        {/* Footer Guest Entry */}
        <div className="auth-guest-footer">
          <button 
            type="button" 
            className="auth-guest-btn" 
            onClick={() => setActiveNav('home')}
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
