import { gstDecisionValid } from '../../../components/gst/gstApi';

export function sellerDocumentIssues({ uploadedDocs = {}, panNumber = '', gstDecision = {} }) {
  const issues = [];
  if (!uploadedDocs.aadhaarFront) issues.push('Upload Aadhaar front');
  if (!uploadedDocs.aadhaarBack) issues.push('Upload Aadhaar back');
  if (!uploadedDocs.passbook) issues.push('Upload bank passbook or cancelled cheque');
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber.trim())) issues.push('Enter a valid 10-character PAN (e.g. ABCPV1234K)');
  if (!gstDecisionValid(gstDecision)) issues.push(gstDecision.choice === 'assistance' ? 'Enter the GST assistance contact name and accept consent' : 'Complete your GST registration choice');
  return issues;
}

export function sellerBankErrors(bank = {}) {
  const errors = {};
  const holder = (bank.holderName || '').trim();
  const name = (bank.bankName || '').trim();
  if (!holder) errors.holderName = 'Account holder name is required.';
  else if (holder.length < 2 || holder.length > 100 || !/^[\p{L}\p{M}\d .\u2019'&()/-]+$/u.test(holder) || !/\p{L}/u.test(holder)) errors.holderName = 'Enter a valid account holder name as shown in your passbook.';
  if (!name) errors.bankName = 'Bank name is required.';
  else if (name.length < 2 || name.length > 100 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M}\d .\u2019'&()/-]+$/u.test(name)) errors.bankName = 'Enter a valid bank name.';
  if (!/^[0-9]{9,18}$/.test(bank.accountNumber || '')) errors.accountNumber = 'Enter a bank account number containing 9–18 digits.';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifscCode || '')) errors.ifscCode = 'Enter a valid 11-character IFSC (e.g. HDFC0001234).';
  return errors;
}

// Keep Continue checks and the final preflight on the same registration rules.
export function sellerStepIssues(step, { aadhaarNo = '', bizForm = {}, addressForm = {}, bankForm = {}, userProfile = {}, ...documents } = {}) {
  if (step === 3) return /^[0-9]{12}$/.test(aadhaarNo) ? [] : ['Enter a valid 12-digit Aadhaar number.'];
  if (step === 4) return bizForm.storeName?.trim() ? [] : ['Store name is required.'];
  if (step === 5) {
    const issues = [];
    const present = value => value !== undefined && value !== null && value !== '';
    const hasLat = present(addressForm.lat), hasLng = present(addressForm.lng);
    const lat = Number(addressForm.lat), lng = Number(addressForm.lng);
    const hasCoordinates = hasLat && hasLng && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    if ((hasLat || hasLng) && !hasCoordinates) issues.push('Pin a valid store location with both latitude and longitude.');
    if (!hasCoordinates && !addressForm.street?.trim()) issues.push('Enter your store street address or pin your store location.');
    if ((!hasCoordinates || addressForm.pincode) && !/^[0-9]{6}$/.test(addressForm.pincode || '')) issues.push('Enter a valid 6-digit pincode.');
    const email = bizForm.pickupEmail || userProfile?.email || '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Enter a valid pickup contact email.');
    return issues;
  }
  if (step === 6) return Object.values(sellerBankErrors(bankForm));
  if (step === 7) return sellerDocumentIssues(documents);
  return [];
}
