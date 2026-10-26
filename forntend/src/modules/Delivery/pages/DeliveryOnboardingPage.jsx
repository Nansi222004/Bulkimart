import React, { useState, useEffect, useRef } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import BrandLogo from '../../../components/BrandLogo';
import { LocationPicker } from '../../../components/LocationPicker';
import { submitDeliveryPayoutStep } from '../utils/onboarding';

/** What the server accepts, with labels a rider recognises. */
const VEHICLES = [
  { value: 'bicycle', icon: '🚲', name: 'Bicycle',       note: 'No licence needed' },
  { value: 'bike',    icon: '🏍️', name: 'Bike / Scooter', note: 'Licence required' },
  { value: 'auto',    icon: '🛺', name: 'Auto',           note: 'Licence required' },
  { value: 'car',     icon: '🚗', name: 'Car',            note: 'Licence required' },
];

const MAX_FILE_MB = 5;
const ACCEPTED = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * A real file picker, reading from the device.
 *
 * The size and type are checked here as well as on the server — not for
 * security, which is the server's job, but because a rider on mobile data
 * should not upload 8 MB before being told it was too big.
 */
export const FileField = ({ label, file, onPick, disabled, required }) => {
  const [problem, setProblem] = useState('');

  const handle = (e) => {
    const picked = e.target.files?.[0];
    setProblem('');
    if (!picked) return; // Cancelling never removes the previous document.

    if (!ACCEPTED.split(',').includes(picked.type)) {
      setProblem('Please choose a JPG, PNG, WEBP or PDF file.');
      e.target.value = '';
      return;
    }
    if (picked.size > MAX_FILE_MB * 1024 * 1024) {
      setProblem(`That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_MB} MB.`);
      e.target.value = '';
      return;
    }
    onPick(picked);
  };

  return (
    <div className="delivery-input-group">
      <label className="delivery-input-label">
        {label} {required && <span className="delivery-required">*</span>}
      </label>

      <label className={`delivery-file-picker ${file ? 'has-file' : ''}`}>
        <input
          type="file"
          aria-label={label}
          accept={ACCEPTED}
          onChange={handle}
          disabled={disabled}
          className="delivery-file-native"
        />
        <span className="delivery-file-icon">{file ? '✅' : '📁'}</span>
        <span className="delivery-file-text">
          {file ? file.name : 'Choose a photo or PDF from your device'}
        </span>
      </label>

      {file && (
        <p className="delivery-file-meta">{(file.size / 1024).toFixed(0)} KB · ready to upload</p>
      )}
      {problem && <p className="delivery-location-error" role="alert">{problem}</p>}
    </div>
  );
};

export const DeliveryOnboardingPage = () => {
  const {
    onboardingStep,
    setOnboardingStep,
    onboardingForm,
    setOnboardingForm,
    onboardingFiles: files,
    setOnboardingFiles: setFiles,
    onboardingNeedsFileReselection,
    riderName,
    riderStatus,
    riderRejection,
    riderProfile,
    submitVehicle,
    submitAadhaar,
    submitServiceArea,
    submitApplication,
    refreshRiderStatus,
    lookupAddress,
    triggerToast,
  } = useDelivery();

  const [busy, setBusy] = useState(false);
  const [stepErrors, setStepErrors] = useState({});
  const submissionLock = useRef(false);

  const set = (field, value) => setOnboardingForm((prev) => ({ ...prev, [field]: value }));
  const setFile = (key) => (file) => setFiles((prev) => ({ ...prev, [key]: file }));

  const needsLicence = onboardingForm.vehicleType && onboardingForm.vehicleType !== 'bicycle';

  useEffect(() => {
    const viewport = globalThis.document?.querySelector('.delivery-onboarding-viewport');
    if (viewport) viewport.scrollTop = 0;
  }, [onboardingStep]);

  // A submitted application has nothing left to fill in — show its state instead.
  useEffect(() => {
    if (riderStatus === 'pending' || riderStatus === 'rejected') setOnboardingStep(5);
  }, [riderStatus, setOnboardingStep]);

  // ---------------------------------------------------------------------------
  // Step handlers — each one saves to the server before moving on, so closing
  // the app mid-registration loses nothing.
  // ---------------------------------------------------------------------------

  const doStep1 = async () => {
    if (!onboardingForm.vehicleType) { triggerToast('Please select a vehicle type.'); return; }
    if (!onboardingForm.vehicleNumber) { triggerToast('Please enter your vehicle number.'); return; }
    if (needsLicence && !onboardingForm.dlNumber) { triggerToast('Please enter your licence number.'); return; }
    if (needsLicence && !files.license && !riderProfile?.drivingLicense?.url) {
      triggerToast('Please upload a photo of your driving licence.');
      return;
    }

    setBusy(true);
    const res = await submitVehicle({
      vehicleType: onboardingForm.vehicleType,
      vehicleNo: onboardingForm.vehicleNumber,
      licenseNo: onboardingForm.dlNumber,
      licenseExpiry: onboardingForm.dlExpiry,
      licenseFile: files.license,
    });
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }
    triggerToast('Vehicle details saved.');
    setOnboardingStep(2);
  };

  const doStep2 = async () => {
    if (!onboardingForm.aadhaarNumber && !files.aadhaarFront && !files.aadhaarBack
      && riderProfile?.aadhaar?.frontUrl && riderProfile?.aadhaar?.backUrl) {
      setOnboardingStep(3);
      return;
    }
    const digits = (onboardingForm.aadhaarNumber || '').replace(/\s/g, '');
    if (!/^\d{12}$/.test(digits)) { triggerToast('An Aadhaar number is 12 digits.'); return; }
    if (!files.aadhaarFront || !files.aadhaarBack) {
      triggerToast('Please upload both the front and back of your Aadhaar.');
      return;
    }

    setBusy(true);
    const res = await submitAadhaar({
      aadhaarNumber: digits,
      frontFile: files.aadhaarFront,
      backFile: files.aadhaarBack,
    });
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }
    triggerToast('Identity documents uploaded.');
    setOnboardingStep(3);
  };

  const doStep3 = async () => {
    if (submissionLock.current) return;
    setStepErrors({});
    setBusy(true);
    const res = await submitDeliveryPayoutStep({
      form: onboardingForm,
      passbookFile: files.passbook,
      existingPassbookUrl: riderProfile?.bankDetails?.passbookUrl,
      submit: submitServiceArea,
      lock: submissionLock,
    });
    setBusy(false);

    if (!res.ok) {
      if (res.code === 'VALIDATION') {
        setStepErrors(res.errors);
        triggerToast(Object.values(res.errors)[0]);
      } else if (res.code !== 'IN_PROGRESS') {
        setStepErrors({ form: res.message });
        triggerToast(res.message);
      }
      return;
    }
    triggerToast('Service area and payout details saved.');
    setOnboardingStep(4);
  };

  const doSubmit = async () => {
    setBusy(true);
    const res = await submitApplication();
    setBusy(false);
    if (!res.ok) { triggerToast(res.message); return; }
    triggerToast('Application submitted for verification.');
    setOnboardingStep(5);
  };

  const doRefresh = async () => {
    setBusy(true);
    const res = await refreshRiderStatus();
    setBusy(false);
    if (!res.ok) { triggerToast(res.message); return; }
    if (res.status === 'approved') triggerToast('You are approved! Welcome aboard.');
    else if (res.status === 'rejected') triggerToast('Your application needs changes.');
    else triggerToast('Still under review.');
  };

  const reopenForEdit = () => {
    setOnboardingStep(1);
    triggerToast('Update your details and submit again.');
  };

  return (
    <div className="delivery-onboarding-wrapper">
      <div className="delivery-onboarding-header">
        <div className="delivery-onboarding-brand">
          <BrandLogo audience="delivery" variant="compact" portal="Delivery" />
        </div>
        <p className="delivery-onboarding-sub">
          {riderName ? `Hello ${riderName.split(' ')[0]} — let's get you on the road` : 'Become a Delivery Partner'}
        </p>
      </div>

      {onboardingStep <= 4 && (
        <div className="delivery-step-indicator-row">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`delivery-step-dot ${onboardingStep === n ? 'active' : ''} ${onboardingStep > n ? 'completed' : ''}`}
            >
              {onboardingStep > n ? '✓' : n}
            </div>
          ))}
        </div>
      )}

      <div className="delivery-onboarding-card">

        {/* ---------------- STEP 1 — vehicle & licence ---------------- */}
        {onboardingStep === 1 && (
          <div className="delivery-onboarding-step-body">
            <h3 className="delivery-step-title">Your Vehicle</h3>
            <p className="delivery-step-desc">This decides how far your deliveries can reach.</p>

            <div className="delivery-vehicle-grid">
              {VEHICLES.map((v) => (
                <div
                  key={v.value}
                  className={`delivery-vehicle-card ${onboardingForm.vehicleType === v.value ? 'selected' : ''}`}
                  onClick={() => !busy && set('vehicleType', v.value)}
                >
                  <span className="delivery-vehicle-icon">{v.icon}</span>
                  <span className="delivery-vehicle-name">{v.name}</span>
                  <span className="delivery-vehicle-limit">{v.note}</span>
                </div>
              ))}
            </div>

            <div className="delivery-input-group">
              <label className="delivery-input-label">
                Vehicle Number <span className="delivery-required">*</span>
              </label>
              <input
                type="text"
                className="delivery-text-input"
                placeholder="e.g. MH31AB1234"
                value={onboardingForm.vehicleNumber}
                disabled={busy}
                onChange={(e) => set('vehicleNumber', e.target.value.toUpperCase())}
              />
            </div>

            {needsLicence && (
              <>
                <div className="delivery-input-group">
                  <label className="delivery-input-label">
                    Driving Licence Number <span className="delivery-required">*</span>
                  </label>
                  <input
                    type="text"
                    className="delivery-text-input"
                    placeholder="e.g. MH3120230001234"
                    value={onboardingForm.dlNumber}
                    disabled={busy}
                    onChange={(e) => set('dlNumber', e.target.value.toUpperCase())}
                  />
                </div>

                <div className="delivery-input-group">
                  <label className="delivery-input-label">Licence Expiry</label>
                  <input
                    type="date"
                    className="delivery-text-input"
                    value={onboardingForm.dlExpiry || ''}
                    disabled={busy}
                    onChange={(e) => set('dlExpiry', e.target.value)}
                  />
                </div>

                <FileField
                  label="Photo of your Driving Licence"
                  required
                  file={files.license}
                  onPick={setFile('license')}
                  disabled={busy}
                />
                {riderProfile?.drivingLicense?.url && !files.license && (
                  <p className="delivery-location-notice">
                    A licence photo is already on file. Choose a new one only if it has changed.
                  </p>
                )}
              </>
            )}

            {onboardingForm.vehicleType === 'bicycle' && (
              <p className="delivery-location-notice">
                A bicycle needs no driving licence — we will only verify your Aadhaar.
              </p>
            )}

            <button className="delivery-primary-action-btn" onClick={doStep1} disabled={busy}>
              {busy ? 'Saving…' : 'Continue to Documents'}
            </button>
          </div>
        )}

        {/* ---------------- STEP 2 — Aadhaar ---------------- */}
        {onboardingStep === 2 && (
          <div className="delivery-onboarding-step-body">
            <h3 className="delivery-step-title">Identity Verification</h3>
            <p className="delivery-step-desc">
              We store only the last four digits of your Aadhaar number, never the whole one.
            </p>
            {riderProfile?.aadhaar?.frontUrl && riderProfile?.aadhaar?.backUrl && <p className="delivery-location-notice">Your Aadhaar documents are already saved. Continue to keep them, or enter the number and select both files to replace them.</p>}

            <div className="delivery-input-group">
              <label className="delivery-input-label">
                Aadhaar Number <span className="delivery-required">*</span>
              </label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={12}
                className="delivery-text-input"
                placeholder="12 digits"
                value={onboardingForm.aadhaarNumber}
                disabled={busy}
                onChange={(e) => set('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </div>

            <FileField
              label="Aadhaar — Front"
              required
              file={files.aadhaarFront}
              onPick={setFile('aadhaarFront')}
              disabled={busy}
            />
            <FileField
              label="Aadhaar — Back"
              required
              file={files.aadhaarBack}
              onPick={setFile('aadhaarBack')}
              disabled={busy}
            />

            <div className="delivery-btn-row">
              <button className="delivery-secondary-action-btn" onClick={() => setOnboardingStep(1)} disabled={busy}>
                Back
              </button>
              <button className="delivery-primary-action-btn" onClick={doStep2} disabled={busy}>
                {busy ? 'Uploading…' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* ---------------- STEP 3 — location, area, payout ---------------- */}
        {onboardingStep === 3 && (
          <div className="delivery-onboarding-step-body">
            <h3 className="delivery-step-title">Where You Work & Get Paid</h3>
            <p className="delivery-step-desc">
              We use your base location to send you orders that start nearby.
            </p>

            {/* Section 1: Location */}
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0', marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📍</span> BASE LOCATION & ADDRESS
              </div>
              <LocationPicker
                value={onboardingForm.location || {}}
                onChange={(loc) => set('location', loc)}
                onLookup={lookupAddress}
                disabled={busy}
                buttonLabel="Use my current location"
                addressLabel="Your address"
              />
              {stepErrors.location && <p className="delivery-inline-error" role="alert">{stepErrors.location}</p>}
            </div>

            {/* Section 2: Coverage & Radius */}
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0', marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#073b78', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🛵</span> SERVICE COVERAGE & RADIUS
              </div>

              <div className="delivery-input-group" style={{ marginBottom: 14 }}>
                <label className="delivery-input-label">
                  Pincodes you can deliver to <span className="delivery-required">*</span>
                </label>
                <input
                  type="text"
                  className="delivery-text-input"
                  placeholder="e.g. 452001, 452010, 452015"
                  value={onboardingForm.zones}
                  disabled={busy}
                  onChange={(e) => set('zones', e.target.value)}
                  aria-invalid={Boolean(stepErrors.zones)}
                />
                <p className="delivery-file-meta">Separate multiple pincodes with commas.</p>
                {stepErrors.zones && <p className="delivery-inline-error" role="alert">{stepErrors.zones}</p>}
              </div>

              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  Preferred Delivery Radius <span className="delivery-required">*</span>
                </label>
                <p className="delivery-file-meta" style={{ marginTop: 2, marginBottom: 8 }}>
                  Maximum distance from your base location you are willing to travel for deliveries.
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="0.5"
                    className="delivery-text-input"
                    placeholder="e.g. 10"
                    style={{ flex: 1 }}
                    value={onboardingForm.deliveryRadius !== undefined ? onboardingForm.deliveryRadius : ''}
                    disabled={busy}
                    onChange={(e) => set('deliveryRadius', e.target.value)}
                    aria-invalid={Boolean(stepErrors.deliveryRadius)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#166534', padding: '10px 14px', background: '#dcfce7', borderRadius: 10, flexShrink: 0 }}>
                    KM
                  </span>
                </div>
                {/* Quick preset chips */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {[5, 10, 15, 20, 25].map((km) => (
                    <button
                      key={km}
                      type="button"
                      onClick={() => !busy && set('deliveryRadius', km)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: Number(onboardingForm.deliveryRadius) === km ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
                        background: Number(onboardingForm.deliveryRadius) === km ? '#ebfdf2' : '#ffffff',
                        color: Number(onboardingForm.deliveryRadius) === km ? '#15803d' : '#475569',
                      }}
                    >
                      {km} KM
                    </button>
                  ))}
                </div>
                {stepErrors.deliveryRadius && <p className="delivery-inline-error" role="alert">{stepErrors.deliveryRadius}</p>}
              </div>
            </div>

            {/* Section 3: Bank / Payout */}
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0', marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#6d28d9', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🏦</span> PAYOUT BANK ACCOUNT
              </div>
              <p className="delivery-step-desc" style={{ marginBottom: 14 }}>
                Earnings and tips go straight to this account.
              </p>

              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  Account Holder Name <span className="delivery-required">*</span>
                </label>
                <input
                  type="text"
                  className="delivery-text-input"
                  placeholder="Exactly as it appears at the bank"
                  value={onboardingForm.bankHolder || ''}
                  disabled={busy}
                  onChange={(e) => set('bankHolder', e.target.value)}
                  aria-invalid={Boolean(stepErrors.bankHolder)}
                />
                {stepErrors.bankHolder && <p className="delivery-inline-error" role="alert">{stepErrors.bankHolder}</p>}
              </div>

              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  Bank Name <span className="delivery-required">*</span>
                </label>
                <input
                  type="text"
                  className="delivery-text-input"
                  placeholder="e.g. State Bank of India"
                  value={onboardingForm.bankName}
                  disabled={busy}
                  onChange={(e) => set('bankName', e.target.value)}
                  aria-invalid={Boolean(stepErrors.bankName)}
                />
                {stepErrors.bankName && <p className="delivery-inline-error" role="alert">{stepErrors.bankName}</p>}
              </div>

              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  Account Number <span className="delivery-required">*</span>
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  className="delivery-text-input"
                  placeholder="Your account number"
                  value={onboardingForm.bankAccount}
                  disabled={busy}
                  onChange={(e) => set('bankAccount', e.target.value.replace(/\D/g, ''))}
                  aria-invalid={Boolean(stepErrors.bankAccount)}
                />
                {stepErrors.bankAccount && <p className="delivery-inline-error" role="alert">{stepErrors.bankAccount}</p>}
              </div>

              <div className="delivery-input-group">
                <label className="delivery-input-label">
                  IFSC Code <span className="delivery-required">*</span>
                </label>
                <input
                  type="text"
                  className="delivery-text-input"
                  placeholder="e.g. SBIN0001234"
                  value={onboardingForm.bankIfsc}
                  disabled={busy}
                  onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())}
                  aria-invalid={Boolean(stepErrors.bankIfsc)}
                />
                {stepErrors.bankIfsc && <p className="delivery-inline-error" role="alert">{stepErrors.bankIfsc}</p>}
              </div>

              <div className="delivery-input-group">
                <label className="delivery-input-label">UPI ID</label>
                <input
                  type="text"
                  className="delivery-text-input"
                  placeholder="Optional — e.g. name@upi"
                  value={onboardingForm.upiId || ''}
                  disabled={busy}
                  onChange={(e) => set('upiId', e.target.value)}
                  aria-invalid={Boolean(stepErrors.upiId)}
                />
                {stepErrors.upiId && <p className="delivery-inline-error" role="alert">{stepErrors.upiId}</p>}
              </div>

              <FileField
                label="Passbook or Cancelled Cheque"
                required
                file={files.passbook}
                onPick={setFile('passbook')}
                disabled={busy}
              />
              {riderProfile?.bankDetails?.passbookUrl && !files.passbook && (
                <p className="delivery-location-notice">A payout document is already on file. Select a new file only to replace it.</p>
              )}
              {stepErrors.passbook && <p className="delivery-inline-error" role="alert">{stepErrors.passbook}</p>}
              {onboardingNeedsFileReselection && !files.passbook && !riderProfile?.bankDetails?.passbookUrl && <p className="delivery-location-notice">Your form details were restored. Please reselect the passbook document after a page reload.</p>}
              {stepErrors.form && <p className="delivery-inline-error" role="alert">{stepErrors.form}</p>}
            </div>

            <div className="delivery-btn-row">
              <button type="button" className="delivery-secondary-action-btn" onClick={() => setOnboardingStep(2)} disabled={busy}>
                Back
              </button>
              <button type="button" className="delivery-primary-action-btn" onClick={doStep3} disabled={busy}>
                {busy ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* ---------------- STEP 4 — review & submit ---------------- */}
        {onboardingStep === 4 && (
          <div className="delivery-onboarding-step-body">
            <h3 className="delivery-step-title">Check & Submit</h3>
            <p className="delivery-step-desc">
              An admin verifies your licence and Aadhaar by hand before you can take orders.
            </p>

            <div className="delivery-onboarding-summary-box">
              <div className="delivery-summary-item">
                <span>Name:</span><strong>{riderName || '—'}</strong>
              </div>
              <div className="delivery-summary-item">
                <span>Vehicle:</span>
                <strong>
                  {VEHICLES.find((v) => v.value === onboardingForm.vehicleType)?.name || '—'}
                  {onboardingForm.vehicleNumber ? ` · ${onboardingForm.vehicleNumber}` : ''}
                </strong>
              </div>
              <div className="delivery-summary-item">
                <span>Aadhaar:</span>
                <strong>{riderProfile?.aadhaar?.number || 'Uploaded'}</strong>
              </div>
              <div className="delivery-summary-item">
                <span>Base location:</span>
                <strong>
                  {onboardingForm.location?.lat !== undefined
                    ? `GPS · ${Number(onboardingForm.location.lat).toFixed(4)}, ${Number(onboardingForm.location.lng).toFixed(4)}`
                    : onboardingForm.location?.pincode
                      ? `${onboardingForm.location.city || 'Address'} · ${onboardingForm.location.pincode}`
                      : '—'}
                </strong>
              </div>
              <div className="delivery-summary-item">
                <span>Delivers to:</span><strong>{onboardingForm.zones || '—'}</strong>
              </div>
              <div className="delivery-summary-item">
                <span>Delivery radius:</span>
                <strong>{onboardingForm.deliveryRadius ? `${onboardingForm.deliveryRadius} KM` : '10 KM'}</strong>
              </div>
              <div className="delivery-summary-item">
                <span>Payout:</span>
                <strong>
                  {onboardingForm.bankName || '—'}
                  {onboardingForm.bankAccount ? ` · ••••${onboardingForm.bankAccount.slice(-4)}` : ''}
                </strong>
              </div>
            </div>

            <div className="delivery-btn-row">
              <button className="delivery-secondary-action-btn" onClick={() => setOnboardingStep(3)} disabled={busy}>
                Back
              </button>
              <button className="delivery-primary-action-btn" onClick={doSubmit} disabled={busy}>
                {busy ? 'Submitting…' : 'Submit Application'}
              </button>
            </div>
          </div>
        )}

        {/* ---------------- STEP 5 — awaiting the admin ---------------- */}
        {onboardingStep === 5 && (
          <div className="delivery-onboarding-step-body" style={{ textAlign: 'center' }}>
            <div className="delivery-status-animation-box">
              <div className="delivery-status-pulse-ring" />
              <span className="delivery-status-icon">{riderStatus === 'rejected' ? '⚠️' : '📝'}</span>
            </div>

            {riderStatus === 'rejected' ? (
              <>
                <h3 className="delivery-step-title">Changes Needed</h3>
                <p className="delivery-step-desc" style={{ maxWidth: 320, margin: '8px auto 16px' }}>
                  {riderRejection || 'An admin asked for corrections to your application.'}
                </p>
                <button className="delivery-primary-action-btn" onClick={reopenForEdit}>
                  Update My Details
                </button>
              </>
            ) : (
              <>
                <h3 className="delivery-step-title">Application Under Review</h3>
                <p className="delivery-step-desc" style={{ maxWidth: 320, margin: '8px auto 16px' }}>
                  An admin is checking your documents. This usually takes up to 24 hours —
                  you can close the app and come back.
                </p>

                <div className="delivery-onboarding-summary-box">
                  <div className="delivery-summary-item">
                    <span>Status:</span>
                    <span className="delivery-badge-pending">{riderStatus || 'pending'}</span>
                  </div>
                  {riderProfile?.vehicleNo && (
                    <div className="delivery-summary-item">
                      <span>Vehicle:</span><strong>{riderProfile.vehicleNo}</strong>
                    </div>
                  )}
                </div>

                {/* No self-approval here. Only an admin can grant access, so all
                    this button does is ask the server what they decided. */}
                <button className="delivery-primary-action-btn" onClick={doRefresh} disabled={busy}>
                  {busy ? 'Checking…' : 'Check My Status'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeliveryOnboardingPage;
