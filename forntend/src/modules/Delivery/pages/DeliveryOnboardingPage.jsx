import React, { useState, useEffect } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import BrandLogo from '../../../components/BrandLogo';
import { LocationPicker } from '../../../components/LocationPicker';

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
const FileField = ({ label, file, onPick, disabled, required }) => {
  const [problem, setProblem] = useState('');

  const handle = (e) => {
    const picked = e.target.files?.[0];
    setProblem('');
    if (!picked) { onPick(null); return; }

    if (!ACCEPTED.split(',').includes(picked.type)) {
      setProblem('Please choose a JPG, PNG, WEBP or PDF file.');
      onPick(null);
      return;
    }
    if (picked.size > MAX_FILE_MB * 1024 * 1024) {
      setProblem(`That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_MB} MB.`);
      onPick(null);
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
      {problem && <p className="delivery-location-error">{problem}</p>}
    </div>
  );
};

export const DeliveryOnboardingPage = () => {
  const {
    onboardingStep,
    setOnboardingStep,
    onboardingForm,
    setOnboardingForm,
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
  const [files, setFiles] = useState({ license: null, aadhaarFront: null, aadhaarBack: null, passbook: null });

  const set = (field, value) => setOnboardingForm((prev) => ({ ...prev, [field]: value }));
  const setFile = (key) => (file) => setFiles((prev) => ({ ...prev, [key]: file }));

  const needsLicence = onboardingForm.vehicleType && onboardingForm.vehicleType !== 'bicycle';

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
    const loc = onboardingForm.location || {};
    const hasFix = loc.lat !== undefined && loc.lng !== undefined;

    // Mirrors the server rule: a GPS fix stands alone, and so does a typed
    // address with a pincode. The server re-checks either way.
    if (!hasFix && !(loc.address && loc.pincode)) {
      triggerToast('Share your current location, or type your address with a pincode.');
      return;
    }
    if (loc.pincode && !/^\d{6}$/.test(loc.pincode)) {
      triggerToast('A pincode is 6 digits.');
      return;
    }

    const zones = (onboardingForm.zones || '').split(',').map((z) => z.trim()).filter(Boolean);
    if (zones.length === 0) { triggerToast('Add at least one pincode you can deliver to.'); return; }
    const badZone = zones.find((z) => !/^\d{6}$/.test(z));
    if (badZone) { triggerToast(`"${badZone}" is not a valid 6-digit pincode.`); return; }

    if (!onboardingForm.bankName || !onboardingForm.bankAccount || !onboardingForm.bankIfsc || !onboardingForm.bankHolder) {
      triggerToast('Please fill in all payout details.');
      return;
    }

    setBusy(true);
    const res = await submitServiceArea({
      zones: zones.join(','),
      location: loc,
      bank: {
        accountNo: onboardingForm.bankAccount,
        ifsc: onboardingForm.bankIfsc,
        holderName: onboardingForm.bankHolder,
        bankName: onboardingForm.bankName,
        upiId: onboardingForm.upiId,
      },
      passbookFile: files.passbook,
    });
    setBusy(false);

    if (!res.ok) { triggerToast(res.message); return; }
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
          <BrandLogo variant="compact" portal="Delivery" />
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

            <LocationPicker
              value={onboardingForm.location || {}}
              onChange={(loc) => set('location', loc)}
              onLookup={lookupAddress}
              disabled={busy}
              buttonLabel="Use my current location"
              addressLabel="Your address"
            />

            <div className="delivery-location-divider" style={{ margin: '20px 0 4px' }}>
              <span>Delivery pincodes</span>
            </div>
            <div className="delivery-input-group">
              <label className="delivery-input-label">
                Pincodes you can deliver to <span className="delivery-required">*</span>
              </label>
              <input
                type="text"
                className="delivery-text-input"
                placeholder="440010, 440012, 440015"
                value={onboardingForm.zones}
                disabled={busy}
                onChange={(e) => set('zones', e.target.value)}
              />
              <p className="delivery-file-meta">Separate them with commas.</p>
            </div>

            <div className="delivery-location-divider" style={{ margin: '20px 0 4px' }}>
              <span>Payout account</span>
            </div>
            <p className="delivery-step-desc">Earnings and tips go straight to this account.</p>

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
              />
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
              />
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
              />
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
              />
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
              />
            </div>

            <FileField
              label="Passbook or Cancelled Cheque"
              file={files.passbook}
              onPick={setFile('passbook')}
              disabled={busy}
            />

            <div className="delivery-btn-row">
              <button className="delivery-secondary-action-btn" onClick={() => setOnboardingStep(2)} disabled={busy}>
                Back
              </button>
              <button className="delivery-primary-action-btn" onClick={doStep3} disabled={busy}>
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
