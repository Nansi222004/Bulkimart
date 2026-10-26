import React, { useRef, useEffect, useState } from 'react';
import GstDecision from '../../../components/gst/GstDecision';
import GstAssistance from '../../../components/gst/GstAssistance';
import { sellerDocumentIssues, sellerBankErrors, sellerStepIssues } from '../utils/onboardingValidation';
import { useSeller } from '../context/SellerContext';
import { LocationPicker } from '../../../components/LocationPicker';
import BrandLogo from '../../../components/BrandLogo';
import { sellerTypeLabelFromModes } from '../utils/onboardingDraft';
import { normalizePhoneInput } from '../utils/sellerAuth';

/** A real file picker — opens the device's storage and keeps the actual File. */
const DocRow = ({ label, hint, docKey, file, onPick, onDelete, required }) => {
  const inputRef = useRef(null);
  return (
    <div className="onboarding-doc-row">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { onPick(docKey, e.target.files?.[0]); e.target.value = ''; }}
      />
      <div className="onboarding-doc-left">
        <div className="onboarding-doc-info">
          <h4>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</h4>
          <p>{file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : (hint || 'No file selected')}</p>
        </div>
      </div>
      {!file ? (
        <button className="onboarding-upload-btn" onClick={() => inputRef.current?.click()}>Upload</button>
      ) : (
        <div className="onboarding-doc-actions">
          <button className="onboarding-doc-action-btn delete" onClick={() => onDelete(docKey)}>Delete</button>
        </div>
      )}
    </div>
  );
};

const StepBack = ({ step, onNavigate }) => (
  <button type="button" className="secondary-onboarding-btn" style={{ marginBottom: 14 }} onClick={() => onNavigate(step)}>
    Back
  </button>
);

const reviewRow = (label, value) => (
  <div className="review-item-row" key={label} style={{ gap: 16 }}>
    <span className="review-item-key" style={{ flex: '0 1 40%', minWidth: 0 }}>{label}</span>
    <span className="review-item-val" style={{ flex: '1 1 60%', minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', textAlign: 'right' }}>{value || 'Not provided'}</span>
  </div>
);

export const OnboardingPage = ({ onSubmitted }) => {
  const {
    onboardingStep,
    setOnboardingStep,
    otpSent,
    otpCode,
    setOtpCode,
    otpTimer,
    sendOtp,
    sellerPhone,
    setSellerPhone,
    verifyOtpAndLogin,
    aadhaarVerified,
    aadhaarVerifying,
    aadhaarNo,
    setAadhaarNo,
    verifyAadhaar,
    bizForm,
    setBizForm,
    addressForm,
    lookupStoreAddress,
    setAddressForm,
    bankForm,
    setBankForm,
    uploadedDocs,
    handleDocUpload,
    handleDocDelete,
    panNumber,
    setPanNumber,
    gstDecision,
    setGstDecision,
    submitting,
    submitError,
    submitSellerApplication,
    submittedSeller,
    applicationId,
    applicationDate,
    selectedTypes,
    setSelectedTypes,
    activeMode,
    setActiveMode,
    userProfile,
    logoutSeller,
  } = useSeller();
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [attemptedSteps, setAttemptedSteps] = useState({});
  const [touchedBankFields, setTouchedBankFields] = useState({});
  const validationRef = useRef(null);

  const totalSteps = 9;
  const documentIssues = sellerDocumentIssues({ uploadedDocs, panNumber, gstDecision });
  const registration = { aadhaarNo, bizForm, addressForm, bankForm, uploadedDocs, panNumber, gstDecision, userProfile };
  const reviewIssues = [
    [3, 'Identity details'], [4, 'Business details'], [5, 'Store address'], [6, 'Bank details'],
  ].map(([step, label]) => ({ step, label, issues: sellerStepIssues(step, registration) })).filter(section => section.issues.length > 0);
  const stepIssues = sellerStepIssues(onboardingStep, registration);
  const bankErrors = sellerBankErrors(bankForm);
  const continueFromStep = (nextStep) => {
    setAttemptedSteps(previous => ({ ...previous, [onboardingStep]: true }));
    if (stepIssues.length === 0) setOnboardingStep(nextStep);
  };
  const bankFieldError = field => (attemptedSteps[6] || touchedBankFields[field]) && bankErrors[field];
  const bankInputProps = field => ({
    required: true,
    'aria-invalid': Boolean(bankFieldError(field)),
    'aria-describedby': bankFieldError(field) ? `bank-${field}-error` : undefined,
    onBlur: () => setTouchedBankFields(previous => ({ ...previous, [field]: true })),
  });
  const bankFieldMessage = field => bankFieldError(field) && <p id={`bank-${field}-error`} role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{bankFieldError(field)}</p>;
  useEffect(() => {
    if (attemptedSteps[onboardingStep]) validationRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [attemptedSteps, onboardingStep]);

  return (
    <div className="seller-main-content">
      {/* Header */}
      <div className="seller-header-row">
        <BrandLogo variant="compact" portal="Seller onboarding" />
      </div>

      <div className="onboarding-container">
        {/* Step Progress visual bar */}
        <div className="onboarding-progress-row">
          <span className="onboarding-step-label">Step {onboardingStep} of {totalSteps}</span>
          <div className="onboarding-dots">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map(step => (
              <div 
                key={step} 
                className={`onboarding-dot ${onboardingStep === step ? 'active' : onboardingStep > step ? 'completed' : ''}`} 
              />
            ))}
          </div>
        </div>

        {attemptedSteps[onboardingStep] && onboardingStep !== 6 && stepIssues.length > 0 && (
          <div ref={validationRef} role="alert" style={{ color: '#b91c1c', marginBottom: 16 }}>
            <p>Please complete this step before continuing:</p>
            <ul>{stepIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
          </div>
        )}

        {/* SCREEN 1: CHOOSE SALES CHANNELS */}
        {onboardingStep === 1 && (
          <>
            <h3 className="onboarding-title" style={{ textAlign: 'center', marginBottom: 6 }}>Select Your Sales Channels</h3>
            <p className="onboarding-subtitle" style={{ textAlign: 'center', marginBottom: 24 }}>Choose how you want to deliver and sell your products on Bulkimart.</p>
            
            <div className="seller-type-cards-grid" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
              {/* Option 1: E-Commerce */}
              <div 
                className={`seller-type-option-card ${selectedTypes.length === 1 && selectedTypes.includes('ecommerce') ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedTypes(['ecommerce']);
                  setActiveMode('ecommerce');
                }}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: selectedTypes.length === 1 && selectedTypes.includes('ecommerce') ? '2.5px solid var(--primary)' : '1.5px solid #e2e8f0',
                  backgroundColor: selectedTypes.length === 1 && selectedTypes.includes('ecommerce') ? 'var(--primary-light)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <div style={{ fontSize: 28 }}>📦</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>E-Commerce Seller</h4>
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Sell garments, handicrafts, packaged products with standard courier delivery across regions.</p>
                </div>
                <div className="seller-card-check" style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: selectedTypes.length === 1 && selectedTypes.includes('ecommerce') ? 'var(--primary)' : '#fff', borderColor: selectedTypes.length === 1 && selectedTypes.includes('ecommerce') ? 'var(--primary)' : '#cbd5e1' }}>
                  {selectedTypes.length === 1 && selectedTypes.includes('ecommerce') && <span style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</span>}
                </div>
              </div>

              {/* Option 2: Quick Commerce */}
              <div 
                className={`seller-type-option-card ${selectedTypes.length === 1 && selectedTypes.includes('quick') ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedTypes(['quick']);
                  setActiveMode('quick');
                }}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: selectedTypes.length === 1 && selectedTypes.includes('quick') ? '2.5px solid var(--primary)' : '1.5px solid #e2e8f0',
                  backgroundColor: selectedTypes.length === 1 && selectedTypes.includes('quick') ? 'var(--primary-light)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <div style={{ fontSize: 28 }}>⚡</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>Quick Commerce (Local)</h4>
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Sell groceries, daily essentials, or fresh organic food with instant 10-minute local neighborhood delivery.</p>
                </div>
                <div className="seller-card-check" style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: selectedTypes.length === 1 && selectedTypes.includes('quick') ? 'var(--primary)' : '#fff', borderColor: selectedTypes.length === 1 && selectedTypes.includes('quick') ? 'var(--primary)' : '#cbd5e1' }}>
                  {selectedTypes.length === 1 && selectedTypes.includes('quick') && <span style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</span>}
                </div>
              </div>

              {/* Option 3: Both (Hybrid) */}
              <div 
                className={`seller-type-option-card ${selectedTypes.length === 2 ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedTypes(['ecommerce', 'quick']);
                  setActiveMode('ecommerce');
                }}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: selectedTypes.length === 2 ? '2.5px solid var(--primary)' : '1.5px solid #e2e8f0',
                  backgroundColor: selectedTypes.length === 2 ? 'var(--primary-light)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <div style={{ fontSize: 28 }}>🤝</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>Hybrid (E-Commerce + Quick Commerce)</h4>
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Activate both channels. Sell standard nationwide catalog items and configure instant local delivery catalog.</p>
                </div>
                <div className="seller-card-check" style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: selectedTypes.length === 2 ? 'var(--primary)' : '#fff', borderColor: selectedTypes.length === 2 ? 'var(--primary)' : '#cbd5e1' }}>
                  {selectedTypes.length === 2 && <span style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</span>}
                </div>
              </div>
            </div>

            <button
              className="primary-onboarding-btn"
              onClick={() => setOnboardingStep(2)}
              disabled={!selectedTypes.length || selectedTypes.some((type) => !['ecommerce', 'quick'].includes(type))}
            >
              Continue to Registration
            </button>
          </>
        )}

        {/* SCREEN 2: MOBILE VERIFICATION */}
        {onboardingStep === 2 && (() => {
          const signedInPhone = userProfile?.phone || '';

          if (signedInPhone) {
            return (
              <>
                <StepBack step={1} onNavigate={setOnboardingStep} />
                <h3 className="onboarding-title">Mobile Number Verified</h3>
                <p className="onboarding-subtitle">
                  Your store will be registered against this number, and you will use it to sign in.
                </p>

                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px',
                    borderRadius: 14, margin: '18px 0',
                    border: '1.5px solid var(--primary, #15803d)',
                    background: 'var(--primary-light, rgba(21,128,61,0.07))',
                  }}
                >
                  <div style={{ fontSize: 22 }}>✅</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.4 }}>+91 {signedInPhone}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Verified via OTP</div>
                  </div>
                </div>

                <button className="primary-onboarding-btn" onClick={() => setOnboardingStep(3)}>
                  Continue
                </button>
                <button type="button" className="otp-resend-btn" onClick={logoutSeller}>
                  Use a different mobile number
                </button>
              </>
            );
          }

          return (
            <>
              <StepBack step={1} onNavigate={setOnboardingStep} />
              <h3 className="onboarding-title">Verify Mobile Number</h3>
              <p className="onboarding-subtitle">
                We will send a verification code to this number. You will use the same number to sign in later.
              </p>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Enter Mobile Number</label>
                <input
                  type="tel"
                  className="onboarding-input"
                  placeholder="Enter 10-digit number"
                  maxLength={18}
                  autoComplete="off"
                  value={sellerPhone}
                  disabled={otpSent}
                  onChange={(e) => setSellerPhone(normalizePhoneInput(e.target.value))}
                />
              </div>

              {!otpSent ? (
                <button type="button" className="primary-onboarding-btn" onClick={() => sendOtp('register')} disabled={sellerPhone.length !== 10}>
                  Send OTP
                </button>
              ) : (
                <>
                  <div className="onboarding-form-group" style={{ marginTop: 12 }}>
                    <label className="onboarding-label">Enter OTP Code</label>
                    <input
                      type="text"
                      className="onboarding-input"
                      placeholder="Enter the OTP code"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    />
                    {otpTimer > 0 ? (
                      <span className="otp-countdown-lbl">Resend code in {otpTimer}s</span>
                    ) : (
                      <button type="button" className="otp-resend-btn" onClick={() => sendOtp('register')}>Resend Code</button>
                    )}
                  </div>

                  <button
                    className="primary-onboarding-btn"
                    onClick={async () => {
                      const res = await verifyOtpAndLogin('register');
                      if (res.ok) setOnboardingStep(3);
                    }}
                    disabled={otpCode.length < 4}
                  >
                    Verify &amp; Continue
                  </button>
                </>
              )}
            </>
          );
        })()}

        {/* SCREEN 4: AADHAAR VERIFICATION */}
        {onboardingStep === 3 && (
          <>
            <StepBack step={2} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Identity Verification</h3>
            <p className="onboarding-subtitle">Please verify your Aadhaar card for KYC verification. Your business details are fully encrypted and secure.</p>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Enter 12-digit Aadhaar Number</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="0000 0000 0000" 
                maxLength={12} 
                autoComplete="off"
                value={aadhaarNo}
                onChange={(e) => setAadhaarNo(e.target.value)}
              />
            </div>

            {!aadhaarVerified ? (
              <button 
                className="primary-onboarding-btn" 
                onClick={() => {
                  setAttemptedSteps(previous => ({ ...previous, 3: true }));
                  if (stepIssues.length === 0) verifyAadhaar();
                }}
                disabled={aadhaarVerifying}
              >
                {aadhaarVerifying ? 'Verifying...' : 'Verify Aadhaar'}
              </button>
            ) : (
              <>
                <div className="onboarding-pitch-row" style={{ borderColor: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                  <div className="onboarding-pitch-icon" style={{ color: 'var(--primary)' }}>✓</div>
                  <div className="onboarding-pitch-text">
                    <h4>Aadhaar Verified</h4>
                    <p>Your biometric information matched successfully.</p>
                  </div>
                </div>

                <button className="primary-onboarding-btn" style={{ marginTop: 20 }} onClick={() => continueFromStep(4)}>
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {/* SCREEN 5: BUSINESS / STORE DETAILS */}
        {onboardingStep === 4 && (
          <>
            <StepBack step={3} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Business Profile Details</h3>
            <p className="onboarding-subtitle">Tell us about your store.</p>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Store Name</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="e.g. Sharma Kirana Store" 
                autoComplete="off"
                value={bizForm.storeName}
                onChange={(e) => setBizForm({ ...bizForm, storeName: e.target.value })}
              />
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Store Description</label>
              <textarea 
                className="onboarding-textarea" 
                placeholder="Short description of what products you manufacture..." 
                value={bizForm.description}
                onChange={(e) => setBizForm({ ...bizForm, description: e.target.value })}
              />
            </div>

            <button 
              className="primary-onboarding-btn" 
              onClick={() => continueFromStep(5)}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 6: ADDRESS DETAILS */}
        {onboardingStep === 5 && (
          <>
            <StepBack step={4} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Where Is Your Store?</h3>
            <p className="onboarding-subtitle">
              Standing at your shop? Tap the button and we will fill this in. Quick
              Commerce shows your products only to customers who are close enough
              for you to reach, so this location decides who can buy from you.
            </p>

            <LocationPicker
              value={{
                address: addressForm.street,
                landmark: addressForm.landmark,
                city: addressForm.district,
                state: addressForm.state,
                pincode: addressForm.pincode,
                lat: addressForm.lat,
                lng: addressForm.lng,
                accuracy: addressForm.accuracy,
                source: addressForm.source,
                formatted: addressForm.formatted,
              }}
              onChange={(loc) =>
                setAddressForm({
                  ...addressForm,
                  street: loc.address ?? '',
                  landmark: loc.landmark ?? '',
                  district: loc.city ?? '',
                  state: loc.state ?? addressForm.state,
                  pincode: loc.pincode ?? '',
                  lat: loc.lat,
                  lng: loc.lng,
                  accuracy: loc.accuracy,
                  source: loc.source,
                  formatted: loc.formatted ?? addressForm.formatted,
                })
              }
              onLookup={lookupStoreAddress}
              buttonLabel="Use current location (Pin my store)"
              addressLabel="Shop address"
            />
            <div className="onboarding-form-group seller-pickup-email">
              <label className="nh-loc-label" htmlFor="seller-pickup-email">Pickup contact email <span className="nh-loc-req">*</span></label>
              <input id="seller-pickup-email" className="nh-loc-input" type="email" maxLength={254} autoComplete="off" required
                aria-describedby="seller-pickup-email-hint" value={bizForm.pickupEmail || ''}
                onChange={event => setBizForm({ ...bizForm, pickupEmail: event.target.value })} placeholder="e.g. store@example.com" />
              <p id="seller-pickup-email-hint" className="seller-pickup-email-hint">Required to register your store’s Shiprocket pickup location.</p>
            </div>

            <button
              className="primary-onboarding-btn"
              onClick={() => continueFromStep(6)}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 7: BANK DETAILS */}
        {onboardingStep === 6 && (
          <>
            <StepBack step={5} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Bank Credentials</h3>
            <p className="onboarding-subtitle">Provide details where weekly sales balance transfers will occur.</p>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Account Holder Name *</label>
              <input 
                {...bankInputProps('holderName')}
                maxLength={100}
                type="text" 
                className="onboarding-input" 
                placeholder="Name as in bank passbook" 
                autoComplete="off"
                value={bankForm.holderName}
                onChange={(e) => setBankForm({ ...bankForm, holderName: e.target.value })}
              />
              {bankFieldMessage('holderName')}
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Bank Name *</label>
              <input 
                {...bankInputProps('bankName')}
                maxLength={100}
                type="text" 
                className="onboarding-input" 
                placeholder="e.g. HDFC Bank / SBI" 
                autoComplete="off"
                value={bankForm.bankName}
                onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
              />
              {bankFieldMessage('bankName')}
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Bank Account Number *</label>
              <input 
                {...bankInputProps('accountNumber')}
                inputMode="numeric"
                maxLength={18}
                type="password" 
                className="onboarding-input" 
                placeholder="Account Number" 
                autoComplete="off"
                value={bankForm.accountNumber}
                onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
              />
              {bankFieldMessage('accountNumber')}
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">IFSC Code *</label>
              <input 
                {...bankInputProps('ifscCode')}
                type="text" 
                className="onboarding-input" 
                placeholder="e.g. HDFC0001234" 
                maxLength={11} 
                autoComplete="off"
                value={bankForm.ifscCode}
                onChange={(e) => setBankForm({ ...bankForm, ifscCode: e.target.value.toUpperCase() })}
              />
              {bankFieldMessage('ifscCode')}
            </div>

            <button 
              className="primary-onboarding-btn" 
              onClick={() => continueFromStep(7)}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 8: DOCUMENT SCANS */}
        {onboardingStep === 7 && (
          <>
            <StepBack step={6} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Upload KYC Documents</h3>
            <p className="onboarding-subtitle">Attach clear scans or photos. JPG, PNG, WEBP or PDF, up to 5 MB each.</p>

            <DocRow label="Aadhaar — Front" docKey="aadhaarFront" required
              file={uploadedDocs.aadhaarFront} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <DocRow label="Aadhaar — Back" docKey="aadhaarBack" required
              file={uploadedDocs.aadhaarBack} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <DocRow label="Bank Passbook / Cancelled Cheque" docKey="passbook" required
              file={uploadedDocs.passbook} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <div className="onboarding-form-group" style={{ marginTop: 16 }}>
              <label className="onboarding-label">PAN Number <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                className="onboarding-input"
                placeholder="e.g. ABCPV1234K"
                maxLength={10}
                autoComplete="off"
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
              />
            </div>

            <DocRow label="PAN Card Scan" hint="Optional" docKey="pan"
              file={uploadedDocs.pan} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <DocRow label="Business Registration Certificate" hint="Optional" docKey="businessCert"
              file={uploadedDocs.businessCert} onPick={handleDocUpload} onDelete={handleDocDelete} />
            <GstDecision value={gstDecision || { choice: '' }} onChange={setGstDecision} />

            <button
              className="primary-onboarding-btn"
              style={{ marginTop: 24 }}
              onClick={() => continueFromStep(8)}
            >
              Continue to Review
            </button>
          </>
        )}


        {/* SCREEN REVIEW & SUBMIT SUMMARY */}
        {onboardingStep === 8 && (
          <>
            <StepBack step={7} onNavigate={setOnboardingStep} />
            <h3 className="onboarding-title">Review & Submit Summary</h3>
            <p className="onboarding-subtitle">Double-check your credentials before submitting for KYC check.</p>

            {/* Business Profile Summary */}
            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Business Information</h4>
                  <button className="review-edit-btn" onClick={() => setOnboardingStep(4)}>Edit</button>
              </div>
              {reviewRow('Store Name', bizForm.storeName)}
              {reviewRow('Vendor Type', sellerTypeLabelFromModes(selectedTypes))}
              {reviewRow('Category', bizForm.category)}
              {reviewRow('Store Description', bizForm.description)}
              {reviewRow('Mobile Number', userProfile?.phone || sellerPhone)}
            </div>

            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Store Address</h4>
                <button className="review-edit-btn" onClick={() => setOnboardingStep(5)}>Edit</button>
              </div>
              {reviewRow('Street Address', addressForm?.street)}
              {reviewRow('Landmark', addressForm?.landmark)}
              {reviewRow('City / District', addressForm?.district)}
              {reviewRow('State', addressForm?.state)}
              {reviewRow('Pincode', addressForm?.pincode)}
              {reviewRow('Pickup Contact Email', bizForm.pickupEmail || userProfile?.email)}
              {addressForm?.lat != null && addressForm?.lng != null && reviewRow('Store Map Pin', `${addressForm.lat}, ${addressForm.lng}`)}
            </div>

            {/* Bank credentials Summary */}
            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Bank Details</h4>
                <button className="review-edit-btn" onClick={() => setOnboardingStep(6)}>Edit</button>
              </div>
              {reviewRow('Bank Name', bankForm.bankName)}
              {reviewRow('Account Holder', bankForm.holderName)}
              {reviewRow('Account Number', bankForm.accountNumber)}
              {reviewRow('IFSC Code', bankForm.ifscCode)}
            </div>

            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Identity & KYC Documents</h4>
                <button className="review-edit-btn" onClick={() => setOnboardingStep(7)}>Edit</button>
              </div>
              {reviewRow('Aadhaar Number', aadhaarNo ? `XXXX-XXXX-${aadhaarNo.slice(-4)}` : '')}
              {reviewRow('PAN Number', panNumber)}
              {[
                ['Aadhaar Front', 'aadhaarFront'], ['Aadhaar Back', 'aadhaarBack'],
                ['Bank Passbook / Cheque', 'passbook'], ['PAN Card Scan (Optional)', 'pan'],
                ['Business Certificate (Optional)', 'businessCert'],
              ].map(([label, key]) => reviewRow(label, uploadedDocs[key]?.name || (uploadedDocs[key] ? 'Attached' : 'Not uploaded')))}
            </div>

            <div className="review-summary-card">
              <div className="review-card-header"><h4 className="review-card-title">GST registration</h4><button className="review-edit-btn" onClick={() => setOnboardingStep(7)}>Edit</button></div>
              <p>{gstDecision?.choice === 'assistance' ? 'GST assistance requested through Bulkimart. Your request will be submitted with this application and reviewed separately. You can complete registration now.' : gstDecision?.choice === 'has_gstin' ? `GSTIN supplied: ${gstDecision.gstin}` : 'Continuing without a GSTIN.'}</p>
              {gstDecision?.choice === 'assistance' && <>
                {reviewRow('Contact Person', gstDecision.contactName)}
                {reviewRow('Assistance Message', gstDecision.message)}
                {reviewRow('Consent', gstDecision.consent ? 'Accepted' : 'Not accepted')}
              </>}
            </div>

            {/* Declaration Checkbox */}
            <label className="onboarding-label" style={{ display: 'flex', gap: 8, fontSize: 11, cursor: 'pointer', margin: '20px 0' }}>
              <input type="checkbox" checked={declarationAccepted} onChange={(event) => setDeclarationAccepted(event.target.checked)} />
              <span>I confirm that the information provided is correct.</span>
            </label>

            {documentIssues.length > 0 && <div role="status"><p>Complete these items before submitting:</p><ul>{documentIssues.map(issue => <li key={issue}>{issue}</li>)}</ul><button type="button" className="secondary-onboarding-btn" onClick={() => setOnboardingStep(7)}>Complete documents and GST details</button></div>}
            {reviewIssues.length > 0 && <div role="alert" style={{ color: '#b91c1c', marginBottom: 16 }}>
              <p>Complete these details before submitting your application:</p>
              {reviewIssues.map(({ step, label, issues }) => <div key={step}>
                <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
                <button type="button" className="review-edit-btn" onClick={() => setOnboardingStep(step)}>{`Edit ${label.toLowerCase()}`}</button>
              </div>)}
            </div>}
            {submitError && (
              <div style={{ padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 11,
                            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                {submitError}
              </div>
            )}

            <button
              className="primary-onboarding-btn"
              disabled={submitting || !declarationAccepted || documentIssues.length > 0 || reviewIssues.length > 0}
              onClick={async () => {
                if (reviewIssues.length > 0 || documentIssues.length > 0) return;
                const res = await submitSellerApplication();
                if (res.ok) {
                  setOnboardingStep(9);
                  onSubmitted?.();
                }
              }}
            >
              {submitting ? 'Uploading documents…' : 'Submit for Verification'}
            </button>
          </>
        )}

        {/* SCREEN APPLICATION SUBMITTED STATUS */}
        {onboardingStep === 9 && (
          <>
            <GstAssistance />
            <div className="onboarding-status-box">
              <div className="status-icon-circle review">⏱</div>
              <h4 className="status-title">Application Under Review</h4>
              <p className="status-desc">Thank you! Your profile has been submitted and is currently being processed by our compliance team.</p>
            </div>

            <div className="review-summary-card">
              <div className="review-item-row">
                <span className="review-item-key">Store Name</span>
                <span className="review-item-val">{submittedSeller?.storeDetails?.name || bizForm.storeName}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Application ID</span>
                <span className="review-item-val">{submittedSeller?._id || applicationId}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Submission Date</span>
                <span className="review-item-val">{applicationDate}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Review Status</span>
                <span className="review-item-val" style={{ color: 'var(--warning, #eab308)' }}>Under Review</span>
              </div>
            </div>

            <button className="primary-onboarding-btn" onClick={() => onSubmitted?.()}>
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
