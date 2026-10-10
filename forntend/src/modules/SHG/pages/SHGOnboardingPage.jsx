import React from 'react';
import { useSHG } from '../context/SHGContext';
import { LocationPicker } from '../../../components/LocationPicker';

export const SHGOnboardingPage = () => {
  const {
    setIsOnboarded,
    onboardingStep,
    setOnboardingStep,
    otpSent,
    otpCode,
    setOtpCode,
    otpTimer,
    sendOtp,
    aadhaarVerified,
    aadhaarVerifying,
    aadhaarNo,
    setAadhaarNo,
    verifyAadhaar,
    groupForm,
    setGroupForm,
    registrationForm,
    setRegistrationForm,
    uploadedDocs,
    handleDocUpload,
    handleDocDelete,
    applicationId,
    applicationDate,
    startOnboarding,
    submitGroupProfile,
    submitApplication,
    lookupAddress
  } = useSHG();

  return (
    <div className="shg-onboarding-wrapper">
      <div className="shg-onboarding-card">
        
        {/* Step Progress visual bar */}
        <div className="shg-progress-header">
          <span className="shg-step-label">Step {onboardingStep} of 7</span>
          <div className="shg-step-dots">
            {[1, 2, 3, 4, 5, 6, 7].map(step => (
              <div 
                key={step} 
                className={`shg-step-dot ${onboardingStep === step ? 'active' : onboardingStep > step ? 'completed' : ''}`} 
              />
            ))}
          </div>
        </div>

        {/* SCREEN 1: WELCOME */}
        {onboardingStep === 1 && (
          <>
            <div className="shg-member-badge">🌸 SHG Empowerment Onboarding</div>
            <h3 className="shg-onboarding-title">Onboard Your Self-Help Group</h3>
            <p className="shg-onboarding-subtitle">Connect with neighborhood buyers, sell organic farm produce, handwoven textiles or traditional crafts, and manage group profits collectively.</p>
            
            <div className="shg-pitch-row">
              <div className="shg-pitch-icon">✓</div>
              <div className="shg-pitch-text">
                <h4>NRLM/DAY-NRLM Linked Benefits</h4>
                <p>Reduced commissions, priority rankings, and direct federation support.</p>
              </div>
            </div>

            <div className="shg-pitch-row">
              <div className="shg-pitch-icon">✓</div>
              <div className="shg-pitch-text">
                <h4>Joint Bank Settlement</h4>
                <p>Weekly payouts directly to your registered SHG Group Bank Account.</p>
              </div>
            </div>

            <div className="shg-pitch-row">
              <div className="shg-pitch-icon">✓</div>
              <div className="shg-pitch-text">
                <h4>Collective Growth Panel</h4>
                <p>Register group members, track collective savings and sales contributions.</p>
              </div>
            </div>

            <button className="shg-primary-btn" style={{ marginTop: 20 }} onClick={startOnboarding}>
              Get Started
            </button>
          </>
        )}

        {/* SCREEN 2: MOBILE VERIFICATION */}
        {onboardingStep === 2 && (
          <>
            <h3 className="shg-onboarding-title">Verify Group Leader Mobile</h3>
            <p className="shg-onboarding-subtitle">Enter the mobile number of the SHG President or Secretary. A secure 6-digit OTP code will be sent.</p>

            <div className="shg-form-group">
              <label className="shg-label">Enter Mobile Number</label>
              <input 
                type="tel" 
                className="shg-input" 
                placeholder="Enter 10-digit number" 
                maxLength={10} 
              />
            </div>

            {!otpSent ? (
              <button className="shg-primary-btn" onClick={sendOtp}>
                Send OTP
              </button>
            ) : (
              <>
                <div className="shg-form-group" style={{ marginTop: 12 }}>
                  <label className="shg-label">Enter OTP Code</label>
                  <input 
                    type="text" 
                    className="shg-input" 
                    placeholder="Enter 6-digit code" 
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                  />
                  {otpTimer > 0 ? (
                    <div className="shg-otp-countdown">Resend code in {otpTimer}s</div>
                  ) : (
                    <button className="shg-otp-resend" onClick={sendOtp}>Resend Code</button>
                  )}
                </div>

                <button 
                  className="shg-primary-btn" 
                  onClick={() => setOnboardingStep(3)}
                  disabled={otpCode.length !== 6}
                >
                  Verify & Continue
                </button>
              </>
            )}
          </>
        )}

        {/* SCREEN 3: AADHAAR VERIFICATION */}
        {onboardingStep === 3 && (
          <>
            <h3 className="shg-onboarding-title">Leader Identity Verification</h3>
            <p className="shg-onboarding-subtitle">Verify the primary identity of the Group President using Aadhaar number for KYC validation.</p>

            <div className="shg-form-group">
              <label className="shg-label">Enter 12-digit Aadhaar Number</label>
              <input 
                type="text" 
                className="shg-input" 
                placeholder="0000 0000 0000" 
                maxLength={12} 
                value={aadhaarNo}
                onChange={(e) => setAadhaarNo(e.target.value)}
              />
            </div>

            {!aadhaarVerified ? (
              <button 
                className="shg-primary-btn" 
                onClick={verifyAadhaar}
                disabled={aadhaarNo.length !== 12 || aadhaarVerifying}
              >
                {aadhaarVerifying ? 'Verifying with UIDAI...' : 'Verify Aadhaar'}
              </button>
            ) : (
              <>
                <div className="shg-verified-row">
                  <div className="shg-verified-icon">✓</div>
                  <div className="shg-verified-text">Aadhaar Verified Successfully</div>
                </div>

                <button className="shg-primary-btn" style={{ marginTop: 12 }} onClick={() => setOnboardingStep(4)}>
                  Continue
                </button>
              </>
            )}
          </>
        )}

        {/* SCREEN 4: SHG GROUP PROFILE & ADDRESS */}
        {/* SCREEN 4: SHG PROFILE & ADDRESS */}
        {onboardingStep === 4 && (
          <>
            <h3 className="shg-onboarding-title">Self-Help Group Profile</h3>
            <p className="shg-onboarding-subtitle">Provide details about your group registration, members, and complete operational address.</p>

            <div className="shg-form-group">
              <label className="shg-label">SHG Group Name *</label>
              <input 
                type="text" 
                className="shg-input" 
                placeholder="e.g. Mahila Gram Udyog" 
                value={groupForm.groupName}
                onChange={(e) => setGroupForm({ ...groupForm, groupName: e.target.value })}
              />
            </div>

            <div className="shg-form-row">
              <div className="shg-form-group">
                <label className="shg-label">Group Leader Name *</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="e.g. Savita Devi" 
                  value={groupForm.leaderName}
                  onChange={(e) => setGroupForm({ ...groupForm, leaderName: e.target.value })}
                />
              </div>
              <div className="shg-form-group">
                <label className="shg-label">Formation Year</label>
                <input 
                  type="number" 
                  className="shg-input" 
                  placeholder="e.g. 2019" 
                  value={groupForm.formationYear}
                  onChange={(e) => setGroupForm({ ...groupForm, formationYear: e.target.value })}
                />
              </div>
            </div>

            <div className="shg-form-row">
              <div className="shg-form-group">
                <label className="shg-label">Total Members</label>
                <input 
                  type="number" 
                  className="shg-input" 
                  placeholder="e.g. 10" 
                  value={groupForm.totalMembers}
                  onChange={(e) => setGroupForm({ ...groupForm, totalMembers: e.target.value })}
                />
              </div>
              <div className="shg-form-group">
                <label className="shg-label">Primary Category *</label>
                <select 
                  className="shg-select"
                  value={groupForm.primaryCategory}
                  onChange={(e) => setGroupForm({ ...groupForm, primaryCategory: e.target.value })}
                >
                  <option value="Organic Foods & Groceries">Organic Foods</option>
                  <option value="Handwoven Textiles">Handwoven Textiles</option>
                  <option value="Traditional Crafts">Handicrafts</option>
                  <option value="Herbal Cosmetics">Cosmetics</option>
                </select>
              </div>
            </div>

            {/* Address Section via LocationPicker */}
            <div style={{ marginTop: 16, marginBottom: 12, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <h4 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Operational Address</h4>
              <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#64748b' }}>Used for pickup logistics, rider navigation, and verification</p>
            </div>

            <LocationPicker
              value={{
                address: groupForm.street,
                landmark: groupForm.landmark,
                city: groupForm.district,
                state: groupForm.state,
                pincode: groupForm.pincode,
                lat: groupForm.lat,
                lng: groupForm.lng
              }}
              onChange={(loc) =>
                setGroupForm({
                  ...groupForm,
                  street: loc.address ?? groupForm.street,
                  landmark: loc.landmark ?? groupForm.landmark,
                  district: loc.city ?? groupForm.district,
                  state: loc.state ?? groupForm.state,
                  pincode: loc.pincode ?? groupForm.pincode,
                  lat: loc.lat,
                  lng: loc.lng
                })
              }
              onLookup={lookupAddress}
              hideCoords={true}
              buttonLabel="Pin SHG Center on Map"
              addressLabel="Center Address"
            />

            <div className="shg-form-group" style={{ marginTop: 12 }}>
              <label className="shg-label">Block / Tehsil (Optional)</label>
              <input 
                type="text" 
                className="shg-input" 
                placeholder="e.g. Hazratganj" 
                value={groupForm.block}
                onChange={(e) => setGroupForm({ ...groupForm, block: e.target.value })}
              />
            </div>

            <button 
              className="shg-primary-btn" 
              onClick={submitGroupProfile}
              style={{ marginTop: 16 }}
              disabled={
                !groupForm.groupName || 
                !groupForm.leaderName || 
                (!groupForm.street && (groupForm.lat === undefined || groupForm.lat === null)) ||
                !/^\d{6}$/.test(groupForm.pincode || '')
              }
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 5: REGISTRATION & BANK DETAILS */}
        {onboardingStep === 5 && (
          <>
            <h3 className="shg-onboarding-title">NRLM & Bank Credentials</h3>
            <p className="shg-onboarding-subtitle">Supply verification codes and cooperative banking information for fund settlement.</p>

            <div className="shg-form-row">
              <div className="shg-form-group">
                <label className="shg-label">SHG Registration ID</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="e.g. SHG20249876" 
                  value={registrationForm.shgRegId}
                  onChange={(e) => setRegistrationForm({ ...registrationForm, shgRegId: e.target.value })}
                />
              </div>
              <div className="shg-form-group">
                <label className="shg-label">NRLM / DAY-NRLM ID</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="e.g. UP2019NRLM..." 
                  value={registrationForm.nrlmId}
                  onChange={(e) => setRegistrationForm({ ...registrationForm, nrlmId: e.target.value })}
                />
              </div>
            </div>

            <div className="shg-form-group">
              <label className="shg-label">SHG Joint Bank Account Number</label>
              <input 
                type="password" 
                className="shg-input" 
                placeholder="Group Account Number" 
                value={registrationForm.bankAccountNo}
                onChange={(e) => setRegistrationForm({ ...registrationForm, bankAccountNo: e.target.value })}
              />
            </div>

            <div className="shg-form-row">
              <div className="shg-form-group">
                <label className="shg-label">Bank Name</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="e.g. State Bank of India" 
                  value={registrationForm.bankName}
                  onChange={(e) => setRegistrationForm({ ...registrationForm, bankName: e.target.value })}
                />
              </div>
              <div className="shg-form-group">
                <label className="shg-label">IFSC Code</label>
                <input 
                  type="text" 
                  className="shg-input" 
                  placeholder="e.g. SBIN0001234" 
                  maxLength={11}
                  value={registrationForm.ifscCode}
                  onChange={(e) => setRegistrationForm({ ...registrationForm, ifscCode: e.target.value })}
                />
              </div>
            </div>

            <button 
              className="shg-primary-btn" 
              onClick={() => setOnboardingStep(6)}
              disabled={!registrationForm.shgRegId || !registrationForm.bankAccountNo || !registrationForm.ifscCode}
            >
              Continue
            </button>
          </>
        )}

        {/* SCREEN 6: DOCUMENT UPLOADS */}
        {onboardingStep === 6 && (
          <>
            <h3 className="shg-onboarding-title">Upload Verification Documents</h3>
            <p className="shg-onboarding-subtitle">Scan and upload formal certificates. Formats allowed: PDF, PNG, JPG (Max 5MB).</p>

            {/* SHG Certificate */}
            <div className={`shg-doc-row ${uploadedDocs.shgCertificate ? 'uploaded' : ''}`}>
              <input
                type="file"
                id="shgCert-file-input"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleDocUpload('shgCertificate', e.target.files?.[0])}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="shg-doc-icon">📄</div>
                <div className="shg-doc-info">
                  <h4>SHG Registration Cert <span className="shg-doc-required">*</span></h4>
                  <p>{uploadedDocs.shgCertificate ? uploadedDocs.shgCertificate.name : 'No file selected'}</p>
                </div>
              </div>
              {!uploadedDocs.shgCertificate ? (
                <label htmlFor="shgCert-file-input" className="shg-upload-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>Upload</label>
              ) : (
                <button type="button" className="shg-delete-btn" onClick={() => handleDocDelete('shgCertificate')}>Delete</button>
              )}
            </div>

            {/* NRLM Certificate */}
            <div className={`shg-doc-row ${uploadedDocs.nrlmCertificate ? 'uploaded' : ''}`}>
              <input
                type="file"
                id="nrlmCert-file-input"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleDocUpload('nrlmCertificate', e.target.files?.[0])}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="shg-doc-icon">📄</div>
                <div className="shg-doc-info">
                  <h4>NRLM Certificate Scan <span className="shg-doc-optional">(Optional)</span></h4>
                  <p>{uploadedDocs.nrlmCertificate ? uploadedDocs.nrlmCertificate.name : 'No file selected'}</p>
                </div>
              </div>
              {!uploadedDocs.nrlmCertificate ? (
                <label htmlFor="nrlmCert-file-input" className="shg-upload-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>Upload</label>
              ) : (
                <button type="button" className="shg-delete-btn" onClick={() => handleDocDelete('nrlmCertificate')}>Delete</button>
              )}
            </div>

            {/* Passbook Scan */}
            <div className={`shg-doc-row ${uploadedDocs.groupPassbook ? 'uploaded' : ''}`}>
              <input
                type="file"
                id="passbook-file-input"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => handleDocUpload('groupPassbook', e.target.files?.[0])}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="shg-doc-icon">📄</div>
                <div className="shg-doc-info">
                  <h4>Group Bank Passbook Scan <span className="shg-doc-required">*</span></h4>
                  <p>{uploadedDocs.groupPassbook ? uploadedDocs.groupPassbook.name : 'No file selected'}</p>
                </div>
              </div>
              {!uploadedDocs.groupPassbook ? (
                <label htmlFor="passbook-file-input" className="shg-upload-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>Upload</label>
              ) : (
                <button type="button" className="shg-delete-btn" onClick={() => handleDocDelete('groupPassbook')}>Delete</button>
              )}
            </div>

            <button 
              className="shg-primary-btn" 
              style={{ marginTop: 16 }}
              onClick={submitApplication}
              disabled={!uploadedDocs.shgCertificate || !uploadedDocs.groupPassbook}
            >
              Submit Application
            </button>
          </>
        )}

        {/* SCREEN 7: APPLICATION SUBMITTED */}
        {onboardingStep === 7 && (
          <>
            <div className="shg-status-box">
              <div className="shg-status-circle review">⏱</div>
              <h4 className="shg-status-title">Application Under Review</h4>
              <p className="shg-status-desc">Thank you! Your Cooperative Self-Help Group details are submitted and are currently being reviewed by the block administrative officer.</p>
            </div>

            <div className="shg-review-card">
              <div className="shg-review-card-head">
                <span className="shg-review-card-title">Registration Summary</span>
              </div>
              <div className="shg-review-row">
                <span className="shg-review-key">Application ID</span>
                <span className="shg-review-val">{applicationId}</span>
              </div>
              <div className="shg-review-row">
                <span className="shg-review-key">Submission Date</span>
                <span className="shg-review-val">{applicationDate}</span>
              </div>
              <div className="shg-review-row">
                <span className="shg-review-key">Status</span>
                <span className="shg-review-val" style={{ color: 'var(--shg-warning)' }}>Under Review</span>
              </div>
            </div>

            <button className="shg-primary-btn" style={{ backgroundColor: '#64748b' }} onClick={() => window.location.href = '/profile'}>
              Go Back to Profile
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SHGOnboardingPage;
