import React, { useState, useEffect } from 'react';
import { useSHG } from '../context/SHGContext';
import { apiUrl } from '../../../utils/api';
import BrandLogo from '../../../components/BrandLogo';

export const SHGLoginPage = () => {
  const { triggerToast } = useSHG();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone'); // 'phone' or 'otp'
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const [mockOtp, setMockOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [notAMember, setNotAMember] = useState(false);
  const [notShgEligible, setNotShgEligible] = useState(false);

  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => setTimer(prev => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    if (!phone.trim() || phone.trim().length !== 10) {
      triggerToast('Please enter a valid 10-digit mobile number', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/shg/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.meta?.code === 'NOT_A_MEMBER') {
          setNotAMember(true);
          return;
        }
        if (data.meta?.code === 'NOT_SHG_ELIGIBLE') {
          setNotShgEligible(true);
          return;
        }
        throw new Error(data.message || 'Failed to send verification code');
      }

      setStep('otp');
      setTimer(30);
      if (data.otp) {
        setMockOtp(data.otp);
      }
      if (data.phone) {
        setMaskedPhone(data.phone.slice(-4));
      } else {
        setMaskedPhone(phone.trim().slice(-4));
      }
      triggerToast('Verification OTP code sent to group leader phone.');
    } catch (err) {
      triggerToast(err.message || 'Failed to send OTP', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 4) {
      triggerToast('Please enter 4-digit verification code', 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/shg/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), otp: otp.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.meta?.code === 'NOT_A_MEMBER') {
          setNotAMember(true);
          return;
        }
        if (data.meta?.code === 'NOT_SHG_ELIGIBLE') {
          setNotShgEligible(true);
          return;
        }
        throw new Error(data.message || 'Verification failed');
      }

      // Store auth session
      if (data.token) {
        localStorage.setItem('userToken', data.token);
      }
      if (data.user) {
        localStorage.setItem('userProfile', JSON.stringify(data.user));
        // Redirect to dashboard
        triggerToast('Logged in successfully!');
        window.location.href = '/shg';
      }
    } catch (err) {
      triggerToast(err.message || 'OTP verification failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  // User is the base identity — SHG onboarding is always an extension of an
  // existing Bulkimart Shopping App customer who has also opted into SHG
  // membership, never created fresh from this screen. See
  // auth.controller.js's requestShgOTP/verifyShgOTP.
  if (notAMember) {
    return (
      <div className="shg-onboarding-wrapper">
        <div className="shg-onboarding-card">
          <div className="shg-member-badge">🌸 SHG Collective Portal</div>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 14, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#fee2e2', color: '#dc2626', fontSize: 24, fontWeight: 900,
            }}>
              ✕
            </div>
          </div>
          <h3 className="shg-onboarding-title" style={{ textAlign: 'center' }}>
            You are not a member of Bulkimart Shopping App
          </h3>
          <p className="shg-onboarding-subtitle" style={{ textAlign: 'center' }}>
            Please open the Bulkimart Shopping App and create your account first.
            SHG onboarding always starts from an existing shopper account —
            you'll be able to come straight back here afterwards.
          </p>
          <button className="shg-primary-btn" onClick={() => { window.location.href = '/'; }}>
            Open Bulkimart Shopping App
          </button>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              className="shg-otp-resend"
              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => { setNotAMember(false); setPhone(''); }}
            >
              ← Try a different number
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notShgEligible) {
    return (
      <div className="shg-onboarding-wrapper">
        <div className="shg-onboarding-card">
          <div className="shg-member-badge">🌸 SHG Collective Portal</div>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 14, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#fef3c7', color: '#b45309', fontSize: 24, fontWeight: 900,
            }}>
              !
            </div>
          </div>
          <h3 className="shg-onboarding-title" style={{ textAlign: 'center' }}>
            Your account isn't marked as an SHG member
          </h3>
          <p className="shg-onboarding-subtitle" style={{ textAlign: 'center' }}>
            Open the Bulkimart Shopping App, go to your Profile, and answer "Yes" to the
            Self-Help Group question first. Once that's saved, come back here to continue.
          </p>
          <button className="shg-primary-btn" onClick={() => { window.location.href = '/'; }}>
            Go to Bulkimart Shopping App
          </button>
          <div style={{ marginTop: '16px', textAlign: 'center' }}>
            <button
              className="shg-otp-resend"
              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
              onClick={() => { setNotShgEligible(false); setPhone(''); }}
            >
              ← Try a different number
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shg-onboarding-wrapper">
      <div className="shg-onboarding-card">
        <BrandLogo variant="compact" portal="SHG" />
        <div className="shg-member-badge">🌸 SHG Collective Portal</div>

        {step === 'phone' ? (
          <form onSubmit={handleSendOtp}>
            <h3 className="shg-onboarding-title">Cooperative Portal Login</h3>
            <p className="shg-onboarding-subtitle">
              Enter your registered mobile number to verify group leader credentials and log in.
            </p>

            <div className="shg-form-group">
              <label className="shg-label">Registered Mobile Number</label>
              <input
                type="tel"
                className="shg-input"
                placeholder="Enter 10-digit number"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                disabled={loading}
                required
              />
            </div>

            <button 
              type="submit" 
              className="shg-primary-btn" 
              disabled={loading || phone.trim().length !== 10}
            >
              {loading ? 'Sending Code...' : 'Verify Mobile Number'}
            </button>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <a href="/login" style={{ color: 'var(--shg-primary)', fontSize: '14px', textDecoration: 'none', fontWeight: '500' }}>
                Go Back to Personal Portal
              </a>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <h3 className="shg-onboarding-title">Enter Verification Code</h3>
            <p className="shg-onboarding-subtitle">
              A secure 4-digit code has been sent to the registered mobile number ending in **{maskedPhone || 'XXXX'}**.
            </p>

            {mockOtp && (
              <div style={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '8px',
                padding: '10px',
                color: '#3b82f6',
                fontSize: '13px',
                marginBottom: '15px',
                textAlign: 'center'
              }}>
                Development Mock OTP: <strong>{mockOtp}</strong>
              </div>
            )}

            <div className="shg-form-group">
              <label className="shg-label">Verification OTP</label>
              <input
                type="text"
                className="shg-input"
                placeholder="Enter 4-digit code"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <button 
              type="submit" 
              className="shg-primary-btn" 
              disabled={loading || otp.length !== 4}
            >
              {loading ? 'Authenticating...' : 'Login to Store Panel'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
              <button 
                type="button" 
                className="shg-otp-resend" 
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                onClick={() => setStep('phone')}
              >
                ← Back
              </button>

              {timer > 0 ? (
                <span className="shg-otp-countdown" style={{ fontSize: '13px', color: '#666' }}>Resend in {timer}s</span>
              ) : (
                <button 
                  type="button" 
                  className="shg-otp-resend"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--shg-primary)', fontWeight: '500' }}
                  onClick={handleSendOtp}
                >
                  Resend Code
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default SHGLoginPage;
