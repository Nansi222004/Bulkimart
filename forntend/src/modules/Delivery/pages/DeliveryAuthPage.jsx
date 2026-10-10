import React, { useState, useEffect } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import BrandLogo from '../../../components/BrandLogo';

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

  const [mode, setMode] = useState('register');   // 'register' | 'login'
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
    const res = await sendRiderOtp(phone);
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }
    setOtpSent(true);
    setTimer(30);
    triggerToast(res.message);
  };

  const handleVerify = async () => {
    setBusy(true);
    const res = await verifyRiderOtp(phone, otp, isRegister ? name.trim() : undefined);
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
      <div className="delivery-onboarding-wrapper">
        <div className="delivery-onboarding-header">
          <div className="delivery-onboarding-brand">
            <BrandLogo variant="compact" portal="Delivery" />
          </div>
          <p className="delivery-onboarding-sub">Become a Delivery Partner</p>
        </div>

        <div className="delivery-onboarding-card">
          <div className="delivery-onboarding-step-body">
            <h3 className="delivery-step-title">One Last Thing</h3>
            <p className="delivery-step-desc">
              {riderPhone
                ? `${riderPhone} is verified. What should we call you?`
                : 'Your number is verified. What should we call you?'}
            </p>

            <div className="delivery-input-group">
              <label className="delivery-input-label">
                Full Name <span className="delivery-required">*</span>
              </label>
              <input
                type="text"
                className="delivery-text-input"
                placeholder="As printed on your ID"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim().length >= 2) handleSaveName(); }}
              />
            </div>

            <button
              className="delivery-primary-action-btn"
              onClick={handleSaveName}
              disabled={name.trim().length < 2 || busy}
            >
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="delivery-onboarding-wrapper">
      <div className="delivery-onboarding-header">
        <div className="delivery-onboarding-brand">
          <BrandLogo variant="compact" portal="Delivery" />
        </div>
        <p className="delivery-onboarding-sub">
          {isRegister ? 'Become a Delivery Partner' : 'Welcome back, partner'}
        </p>
      </div>

      <div className="delivery-onboarding-card">
        <div className="delivery-onboarding-step-body">
          <div className="delivery-auth-tabs">
            <button
              type="button"
              className={`delivery-auth-tab ${isRegister ? 'active' : ''}`}
              onClick={() => switchMode('register')}
              disabled={busy}
            >
              Register
            </button>
            <button
              type="button"
              className={`delivery-auth-tab ${!isRegister ? 'active' : ''}`}
              onClick={() => switchMode('login')}
              disabled={busy}
            >
              Sign in
            </button>
          </div>

          <h3 className="delivery-step-title">
            {isRegister ? 'Your Details' : 'Sign In'}
          </h3>
          <p className="delivery-step-desc">
            {isRegister
              ? 'This number becomes your login. You will use it every time you sign in.'
              : 'Enter the mobile number you registered with.'}
          </p>

          {isRegister && (
            <div className="delivery-input-group">
              <label className="delivery-input-label">
                Full Name <span className="delivery-required">*</span>
              </label>
              <input
                type="text"
                className="delivery-text-input"
                placeholder="As printed on your ID"
                value={name}
                disabled={otpSent || busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          <div className="delivery-input-group">
            <label className="delivery-input-label">
              Mobile Number <span className="delivery-required">*</span>
            </label>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              className="delivery-text-input"
              placeholder="10-digit number"
              value={phone}
              disabled={otpSent || busy}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onKeyDown={(e) => { if (e.key === 'Enter' && phone.length === 10) handleSend(); }}
            />
          </div>

          {!otpSent ? (
            <button
              className="delivery-primary-action-btn"
              onClick={handleSend}
              disabled={phone.length !== 10 || !nameOk || busy}
            >
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          ) : (
            <>
              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  Enter OTP sent to {phone}
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={6}
                  className="delivery-text-input delivery-otp-input"
                  placeholder="••••"
                  value={otp}
                  disabled={busy}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && otp) handleVerify(); }}
                />
              </div>

              <button
                className="delivery-primary-action-btn"
                onClick={handleVerify}
                disabled={!otp || busy}
              >
                {busy ? 'Verifying…' : 'Verify & Continue'}
              </button>

              <div className="delivery-auth-footer">
                <button
                  type="button"
                  className="delivery-link-btn"
                  onClick={() => { setOtpSent(false); setOtp(''); setTimer(0); }}
                  disabled={busy}
                >
                  Change number
                </button>
                <button
                  type="button"
                  className="delivery-link-btn"
                  onClick={handleSend}
                  disabled={timer > 0 || busy}
                >
                  {timer > 0 ? `Resend in ${timer}s` : 'Resend OTP'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeliveryAuthPage;
