import React, { useRef, useEffect, useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { LocationPicker } from '../../../components/LocationPicker';
import BrandLogo from '../../../components/BrandLogo';

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
    isNscSeller,
    setIsNscSeller,
    nhcPlans,
    nhcPlansLoading,
    nhcPlansError,
    fetchNhcPlans,
    selectedNhcPlan,
    setSelectedNhcPlan,
  } = useSeller();

  const [showPlanConfirmModal, setShowPlanConfirmModal] = useState(false);

  // Fetch NHC plans when seller reaches plan step or selects NHC seller type
  useEffect(() => {
    if (isNscSeller) {
      fetchNhcPlans();
    }
  }, [isNscSeller, fetchNhcPlans]);

  const totalSteps = isNscSeller ? 10 : 9;

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

        {/* SCREEN 1: INDIVIDUAL vs NHC ORGANISATION */}
        {onboardingStep === 1 && (
          <>
            <h3 className="onboarding-title" style={{ textAlign: 'center', marginBottom: 6 }}>How Are You Selling?</h3>
            <p className="onboarding-subtitle" style={{ textAlign: 'center', marginBottom: 24 }}>
              This decides whether your store is grouped under NHC Stores for shoppers browsing that section.
            </p>

            <div className="seller-type-cards-grid" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
              {/* Option 1: Individual Seller */}
              <div
                className={`seller-type-option-card ${!isNscSeller ? 'selected' : ''}`}
                onClick={() => setIsNscSeller(false)}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: !isNscSeller ? '2.5px solid var(--primary)' : '1.5px solid #e2e8f0',
                  backgroundColor: !isNscSeller ? 'var(--primary-light)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <div style={{ fontSize: 28 }}>🧑‍💼</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>Individual Seller</h4>
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Selling on your own, as a proprietor or an independent shop.</p>
                </div>
                <div className="seller-card-check" style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: !isNscSeller ? 'var(--primary)' : '#fff', borderColor: !isNscSeller ? 'var(--primary)' : '#cbd5e1' }}>
                  {!isNscSeller && <span style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</span>}
                </div>
              </div>

              {/* Option 2: NHC Organisation Seller */}
              <div
                className={`seller-type-option-card ${isNscSeller ? 'selected' : ''}`}
                onClick={() => setIsNscSeller(true)}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: isNscSeller ? '2.5px solid var(--primary)' : '1.5px solid #e2e8f0',
                  backgroundColor: isNscSeller ? 'var(--primary-light)' : '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <div style={{ fontSize: 28 }}>🏢</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: 13, fontWeight: '800', color: '#0f172a' }}>NHC Organization Seller</h4>
                  <p style={{ margin: '4px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Selling on behalf of an NHC organisation — featured under NHC Stores for shoppers.</p>
                </div>
                <div className="seller-card-check" style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isNscSeller ? 'var(--primary)' : '#fff', borderColor: isNscSeller ? 'var(--primary)' : '#cbd5e1' }}>
                  {isNscSeller && <span style={{ color: '#fff', fontSize: 10, fontWeight: 900 }}>✓</span>}
                </div>
              </div>
            </div>

            <button className="primary-onboarding-btn" onClick={() => setOnboardingStep(2)}>
              Continue
            </button>
          </>
        )}

        {/* SCREEN 2: CHOOSE SALES CHANNELS */}
        {onboardingStep === 2 && (
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

            <button className="primary-onboarding-btn" onClick={() => setOnboardingStep(3)}>
              Continue to Registration
            </button>
          </>
        )}

        {/* SCREEN 3: MOBILE VERIFICATION */}
        {onboardingStep === 3 && (() => {
          let signedInPhone = '';
          try { signedInPhone = JSON.parse(localStorage.getItem('userProfile') || '{}').phone || ''; } catch { /* ignore */ }

          if (signedInPhone) {
            return (
              <>
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

                <button className="primary-onboarding-btn" onClick={() => setOnboardingStep(4)}>
                  Continue
                </button>
              </>
            );
          }

          return (
            <>
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
                      if (res.ok) setOnboardingStep(4);
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
        {onboardingStep === 4 && (
          <>
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

                <button className="primary-onboarding-btn" style={{ marginTop: 20 }} onClick={() => setOnboardingStep(5)}>
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {/* SCREEN 5: BUSINESS / STORE DETAILS */}
        {onboardingStep === 5 && (
          <>
            <h3 className="onboarding-title">Business Profile Details</h3>
            <p className="onboarding-subtitle">Tell us about your store name and seller categorization.</p>

            <div className="onboarding-form-group">
              <label className="onboarding-label">Seller Classification</label>
              <input 
                type="text" 
                className="onboarding-input" 
                value={isNscSeller ? "NHC Organization Seller" : "General Vendor / Retailer"} 
                readOnly 
                disabled 
                style={{ backgroundColor: '#f8fafc', color: '#334155', cursor: 'not-allowed', fontWeight: '600' }}
              />
            </div>

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
              onClick={() => setOnboardingStep(6)}
              disabled={!bizForm.storeName}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 6: ADDRESS DETAILS */}
        {onboardingStep === 6 && (
          <>
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
              onClick={() => setOnboardingStep(7)}
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
        {onboardingStep === 7 && (
          <>
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
              onClick={() => setOnboardingStep(8)}
              disabled={!bankForm.holderName || !bankForm.accountNumber || !bankForm.ifscCode}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 8: DOCUMENT SCANS */}
        {onboardingStep === 8 && (
          <>
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
              onClick={() => setOnboardingStep(isNscSeller ? 9 : 9)}
              disabled={!uploadedDocs.aadhaarFront || !uploadedDocs.aadhaarBack || !uploadedDocs.passbook || panNumber.length !== 10}
            >
              {isNscSeller ? 'Continue to NHC Plan Selection' : 'Continue to Review'}
            </button>
            {(!uploadedDocs.aadhaarFront || !uploadedDocs.aadhaarBack || !uploadedDocs.passbook || panNumber.length !== 10) && (
              <p style={{ fontSize: 11, opacity: 0.6, textAlign: 'center', marginTop: 8 }}>
                Aadhaar front &amp; back, passbook and a valid 10-character PAN are required.
              </p>
            )}
          </>
        )}

        {/* SCREEN 9 (NHC BRANCH): NHC SELLER PLAN SELECTION */}
        {isNscSeller && onboardingStep === 9 && (
          <>
            <h3 className="onboarding-title" style={{ textAlign: 'center', marginBottom: 6 }}>Choose Your NHC Seller Plan</h3>
            <p className="onboarding-subtitle" style={{ textAlign: 'center', marginBottom: 24 }}>
              Select an NHC seller membership tier configured by NHC Administration.
            </p>

            {nhcPlansLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                Loading active NHC seller plans...
              </div>
            ) : nhcPlansError ? (
              <div style={{ padding: 16, borderRadius: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', textAlign: 'center', marginBottom: 20 }}>
                {nhcPlansError}
              </div>
            ) : nhcPlans.length === 0 ? (
              <div style={{ padding: 32, borderRadius: 16, backgroundColor: '#f8fafc', border: '1.5px dashed #cbd5e1', textAlign: 'center', marginBottom: 24 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 15, color: '#334155' }}>NHC seller plans are currently unavailable.</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Please contact NHC administration.</p>
              </div>
            ) : (
              <div className="nhc-plans-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginBottom: 28 }}>
                {nhcPlans.map((plan) => {
                  const isSelected = selectedNhcPlan?.id === plan.id || selectedNhcPlan?._id === plan._id;
                  const formattedAmount = Number(plan.amount).toLocaleString('en-IN');
                  return (
                    <div
                      key={plan.id || plan._id}
                      className={`nhc-plan-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedNhcPlan(plan)}
                      style={{
                        padding: '24px 20px',
                        borderRadius: 18,
                        border: isSelected ? '2.5px solid var(--primary, #15803d)' : '1.5px solid #e2e8f0',
                        backgroundColor: isSelected ? 'var(--primary-light, rgba(21,128,61,0.06))' : '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justify: 'space-between',
                        boxShadow: isSelected ? '0 10px 25px -5px rgba(21,128,61,0.2)' : '0 4px 12px rgba(0,0,0,0.03)',
                        transition: 'all 0.2s ease-in-out',
                        position: 'relative'
                      }}
                    >
                      {isSelected && (
                        <div style={{ position: 'absolute', top: 14, right: 14, backgroundColor: 'var(--primary, #15803d)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12 }}>
                          SELECTED ✓
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--primary, #15803d)', letterSpacing: 0.8, marginBottom: 4 }}>
                          {plan.planType || 'NHC PLAN'}
                        </div>
                        <h4 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                          {plan.name}
                        </h4>
                        <div style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', marginBottom: 12 }}>
                          ₹{formattedAmount}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginLeft: 4 }}>
                            {plan.currency || 'INR'}
                          </span>
                        </div>
                        {plan.description && (
                          <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                            {plan.description}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        style={{
                          marginTop: 20,
                          padding: '10px 16px',
                          borderRadius: 10,
                          border: 'none',
                          backgroundColor: isSelected ? 'var(--primary, #15803d)' : '#f1f5f9',
                          color: isSelected ? '#fff' : '#334155',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer',
                          width: '100%'
                        }}
                      >
                        {isSelected ? 'Selected' : `Select ${plan.name}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              className="primary-onboarding-btn"
              disabled={!selectedNhcPlan || nhcPlans.length === 0}
              onClick={() => setShowPlanConfirmModal(true)}
            >
              Continue to Review
            </button>

            {/* CONFIRMATION MODAL */}
            {showPlanConfirmModal && selectedNhcPlan && (
              <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20
              }}>
                <div style={{
                  backgroundColor: '#fff', borderRadius: 20, padding: 28, maxWidth: 420, width: '100%',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0', textAlign: 'center'
                }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                  <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
                    Confirm Plan Selection
                  </h3>
                  <p style={{ margin: '0 0 20px', fontSize: 12, color: '#64748b' }}>
                    You have selected:
                  </p>

                  <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: 14, border: '1px solid #e2e8f0', marginBottom: 24, textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>Selected Plan:</span>
                      <strong style={{ fontSize: 12, color: '#0f172a' }}>{selectedNhcPlan.name}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>Plan Amount:</span>
                      <strong style={{ fontSize: 14, color: 'var(--primary, #15803d)' }}>
                        ₹{Number(selectedNhcPlan.amount).toLocaleString('en-IN')}
                      </strong>
                    </div>
                  </div>

                  <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 24 }}>
                    Do you want to continue with this selection?
                  </p>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      style={{
                        flex: 1, padding: '12px 16px', borderRadius: 10, border: '1px solid #cbd5e1',
                        backgroundColor: '#fff', color: '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer'
                      }}
                      onClick={() => setShowPlanConfirmModal(false)}
                    >
                      Change Plan
                    </button>
                    <button
                      style={{
                        flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
                        backgroundColor: 'var(--primary, #15803d)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer'
                      }}
                      onClick={() => {
                        setShowPlanConfirmModal(false);
                        setOnboardingStep(10);
                      }}
                    >
                      Yes, Continue
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* SCREEN REVIEW & SUBMIT SUMMARY (Step 10 for NHC, Step 9 for Individual) */}
        {((isNscSeller && onboardingStep === 10) || (!isNscSeller && onboardingStep === 9)) && (
          <>
            <h3 className="onboarding-title">Review & Submit Summary</h3>
            <p className="onboarding-subtitle">Double-check your credentials before submitting for KYC check.</p>

            {/* NHC Plan Summary (If NHC Seller) */}
            {isNscSeller && selectedNhcPlan && (
              <div className="review-summary-card" style={{ border: '2px solid var(--primary, #15803d)', backgroundColor: 'var(--primary-light, rgba(21,128,61,0.05))' }}>
                <div className="review-card-header">
                  <h4 className="review-card-title" style={{ color: 'var(--primary, #15803d)' }}>Selected NHC Seller Plan</h4>
                  <button className="review-edit-btn" onClick={() => setOnboardingStep(9)}>Edit Plan</button>
                </div>
                <div className="review-item-row">
                  <span className="review-item-key">Plan Name</span>
                  <span className="review-item-val" style={{ fontWeight: 800 }}>{selectedNhcPlan.name}</span>
                </div>
                <div className="review-item-row">
                  <span className="review-item-key">Plan Amount</span>
                  <span className="review-item-val" style={{ fontWeight: 900, color: 'var(--primary, #15803d)', fontSize: 14 }}>
                    ₹{Number(selectedNhcPlan.amount).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            )}

            {/* Business Profile Summary */}
            <div className="review-summary-card">
              <div className="review-card-header">
                <h4 className="review-card-title">Business Information</h4>
                <button className="review-edit-btn" onClick={() => setOnboardingStep(5)}>Edit</button>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Seller Type</span>
                <span className="review-item-val">{isNscSeller ? 'NHC Organization' : 'Individual Seller'}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Store Name</span>
                <span className="review-item-val">{bizForm.storeName}</span>
              </div>
              <div className="review-item-row">
                <span className="review-item-key">Vendor Type</span>
                <span className="review-item-val">{bizForm.vendorType}</span>
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
                <button className="review-edit-btn" onClick={() => setOnboardingStep(7)}>Edit</button>
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
              <input type="checkbox" defaultChecked />
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
              disabled={submitting}
              onClick={async () => {
                const res = await submitSellerApplication();
                if (res.ok) {
                  setOnboardingStep(isNscSeller ? 11 : 10);
                  onSubmitted?.();
                }
              }}
            >
              {submitting ? 'Uploading documents…' : 'Submit for Verification'}
            </button>
          </>
        )}

        {/* SCREEN APPLICATION SUBMITTED STATUS (Step 11 for NHC, Step 10 for Individual) */}
        {((isNscSeller && onboardingStep === 11) || (!isNscSeller && onboardingStep === 10)) && (
          <>
            <div className="onboarding-status-box">
              <div className="status-icon-circle review">⏱</div>
              <h4 className="status-title">Application Under Review</h4>
              <p className="status-desc">Thank you! Your profile has been submitted and is currently being processed by our compliance team.</p>
            </div>

            <div className="review-summary-card">
              {/* NHC Plan Snapshot display */}
              {(submittedSeller?.nhcPlan || selectedNhcPlan) && (
                <>
                  <div className="review-item-row">
                    <span className="review-item-key">Selected Plan</span>
                    <span className="review-item-val" style={{ fontWeight: 800 }}>
                      {submittedSeller?.nhcPlan?.planName || selectedNhcPlan?.name}
                    </span>
                  </div>
                  <div className="review-item-row">
                    <span className="review-item-key">Plan Amount</span>
                    <span className="review-item-val" style={{ fontWeight: 800, color: 'var(--primary, #15803d)' }}>
                      ₹{Number(submittedSeller?.nhcPlan?.planAmount || selectedNhcPlan?.amount).toLocaleString('en-IN')}
                    </span>
                  </div>
                </>
              )}
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
