import React, { useRef, useEffect, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { LocationPicker } from '../../../components/LocationPicker';
import BrandLogo from '../../../components/BrandLogo';
import { sellerTypeLabelFromModes } from '../utils/onboardingDraft';

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
  } = useSeller();
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const totalSteps = 9;

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
          let signedInPhone = '';
          try { signedInPhone = JSON.parse(localStorage.getItem('userProfile') || '{}').phone || ''; } catch { /* ignore */ }

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
                  maxLength={10}
                  value={sellerPhone}
                  disabled={otpSent}
                  onChange={(e) => setSellerPhone(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              {!otpSent ? (
                <button className="primary-onboarding-btn" onClick={sendOtp} disabled={sellerPhone.length !== 10}>
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
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    />
                    {otpTimer > 0 ? (
                      <span className="otp-countdown-lbl">Resend code in {otpTimer}s</span>
                    ) : (
                      <button className="otp-resend-btn" onClick={sendOtp}>Resend Code</button>
                    )}
                  </div>

                  <button
                    className="primary-onboarding-btn"
                    onClick={async () => {
                      const res = await verifyOtpAndLogin();
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
                value={aadhaarNo}
                onChange={(e) => setAadhaarNo(e.target.value)}
              />
            </div>

            {!aadhaarVerified ? (
              <button 
                className="primary-onboarding-btn" 
                onClick={verifyAadhaar}
                disabled={aadhaarNo.length !== 12 || aadhaarVerifying}
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

                <button className="primary-onboarding-btn" style={{ marginTop: 20 }} onClick={() => setOnboardingStep(4)}>
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
              onClick={() => setOnboardingStep(5)}
              disabled={!bizForm.storeName.trim()}
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
                })
              }
              onLookup={lookupStoreAddress}
              buttonLabel="Pin my store location"
              addressLabel="Shop address"
            />

            <button
              className="primary-onboarding-btn"
              onClick={() => setOnboardingStep(6)}
              disabled={
                !(addressForm.lat !== undefined && addressForm.lng !== undefined) &&
                !(addressForm.street && /^\d{6}$/.test(addressForm.pincode || ''))
              }
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
              <label className="onboarding-label">Account Holder Name</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="Name as in bank passbook" 
                value={bankForm.holderName}
                onChange={(e) => setBankForm({ ...bankForm, holderName: e.target.value })}
              />
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Bank Name</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="e.g. HDFC Bank / SBI" 
                value={bankForm.bankName}
                onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
              />
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Bank Account Number</label>
              <input 
                type="password" 
                className="onboarding-input" 
                placeholder="Account Number" 
                value={bankForm.accountNumber}
                onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
              />
            </div>

            <div className="onboarding-form-group">
              <label className="onboarding-label">IFSC Code</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="e.g. HDFC0001234" 
                maxLength={11} 
                value={bankForm.ifscCode}
                onChange={(e) => setBankForm({ ...bankForm, ifscCode: e.target.value })}
              />
            </div>

            <button 
              className="primary-onboarding-btn" 
              onClick={() => setOnboardingStep(7)}
              disabled={!bankForm.holderName.trim() || !bankForm.bankName.trim() || !bankForm.accountNumber.trim() || !bankForm.ifscCode.trim()}
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
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
              />
            </div>

            <DocRow label="PAN Card Scan" docKey="pan"
              file={uploadedDocs.pan} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <DocRow label="Business Registration Certificate" hint="Optional" docKey="businessCert"
              file={uploadedDocs.businessCert} onPick={handleDocUpload} onDelete={handleDocDelete} />

            <button
              className="primary-onboarding-btn"
              style={{ marginTop: 24 }}
              onClick={() => setOnboardingStep(8)}
              disabled={!uploadedDocs.aadhaarFront || !uploadedDocs.aadhaarBack || !uploadedDocs.passbook || panNumber.length !== 10}
            >
              Continue to Review
            </button>
            {(!uploadedDocs.aadhaarFront || !uploadedDocs.aadhaarBack || !uploadedDocs.passbook || panNumber.length !== 10) && (
              <p style={{ fontSize: 11, opacity: 0.6, textAlign: 'center', marginTop: 8 }}>
                Aadhaar front &amp; back, passbook and a valid 10-character PAN are required.
              </p>
            )}
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
              <div className="review-item-row">
                <span className="review-item-key">Store Name</span>
                <span className="review-item-val">{bizForm.storeName}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Vendor Type</span>
                <span className="review-item-val">{sellerTypeLabelFromModes(selectedTypes)}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Category</span>
                <span className="review-item-val">{bizForm.category}</span>
              </div>
            </div>

            {/* Bank credentials Summary */}
            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Bank Details</h4>
                <button className="review-edit-btn" onClick={() => setOnboardingStep(6)}>Edit</button>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Bank Name</span>
                <span className="review-item-val">{bankForm.bankName}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Account Holder</span>
                <span className="review-item-val">{bankForm.holderName}</span>
              </div>
            </div>

            {/* Declaration Checkbox */}
            <label className="onboarding-label" style={{ display: 'flex', gap: 8, fontSize: 11, cursor: 'pointer', margin: '20px 0' }}>
              <input type="checkbox" checked={declarationAccepted} onChange={(event) => setDeclarationAccepted(event.target.checked)} />
              <span>I confirm that the information provided is correct.</span>
            </label>

            {submitError && (
              <div style={{ padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 11,
                            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
                {submitError}
              </div>
            )}

            <button
              className="primary-onboarding-btn"
              disabled={submitting || !declarationAccepted}
              onClick={async () => {
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
