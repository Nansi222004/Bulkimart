// Port of frontend/src/modules/Seller/utils/onboardingValidation.js and components/gst/gstApi.js::gstDecisionValid.
// The server re-validates every step; these give the same messages earlier.

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function gstDecisionValid(value = {}) {
  if (value.choice === 'has_gstin') return GSTIN_REGEX.test(value.gstin || '');
  return value.choice === 'without_gstin' || (value.choice === 'assistance' && value.consent === true
    && !!value.contactName?.trim() && value.contactName.length <= 100 && (value.message || '').length <= 2000);
}

export function sellerBankErrors(bank = {}) {
  const errors = {};
  const holder = (bank.holderName || '').trim();
  const name = (bank.bankName || '').trim();
  if (!holder) errors.holderName = 'Account holder name is required.';
  else if (holder.length < 2 || holder.length > 100 || !/^[\p{L}\p{M}\d .’'&()/-]+$/u.test(holder) || !/\p{L}/u.test(holder)) errors.holderName = 'Enter a valid account holder name as shown in your passbook.';
  if (!name) errors.bankName = 'Bank name is required.';
  else if (name.length < 2 || name.length > 100 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M}\d .’'&()/-]+$/u.test(name)) errors.bankName = 'Enter a valid bank name.';
  if (!/^[0-9]{9,18}$/.test(bank.accountNumber || '')) errors.accountNumber = 'Enter a bank account number containing 9–18 digits.';
  if (!IFSC_REGEX.test(bank.ifscCode || '')) errors.ifscCode = 'Enter a valid 11-character IFSC (e.g. HDFC0001234).';
  return errors;
}

export function sellerDocumentIssues({ docs = {}, panNumber = '', gst = {} }) {
  const issues = [];
  if (!docs.aadhaarFront) issues.push('Upload Aadhaar front');
  if (!docs.aadhaarBack) issues.push('Upload Aadhaar back');
  if (!docs.passbook) issues.push('Upload bank passbook or cancelled cheque');
  if (!PAN_REGEX.test(panNumber.trim())) issues.push('Enter a valid 10-character PAN (e.g. ABCPV1234K)');
  if (!gstDecisionValid(gst)) issues.push(gst.choice === 'assistance' ? 'Enter the GST assistance contact name and accept consent' : 'Complete your GST registration choice');
  return issues;
}

/**
 * Issues for one wizard section. Section ids follow the web screens:
 * 'channels' | 'identity' | 'business' | 'address' | 'bank' | 'documents'
 * The web also accepts a GPS pin instead of a street address; this app collects a typed address with pincode,
 * which the backend accepts as an alternative (submitStep1: "Pin your store on the map, or enter its 6-digit pincode").
 */
export function sectionIssues(section, r) {
  switch (section) {
    case 'channels': return r.channels.length ? [] : ['Choose at least one sales channel.'];
    case 'identity': return /^[0-9]{12}$/.test(r.aadhaarNo) ? [] : ['Enter a valid 12-digit Aadhaar number.'];
    case 'business': return r.biz.storeName?.trim() ? [] : ['Store name is required.'];
    case 'address': {
      const issues = [];
      if (!r.address.street?.trim()) issues.push('Enter your store street address.');
      if (!/^[0-9]{6}$/.test(r.address.pincode || '')) issues.push('Enter a valid 6-digit pincode.');
      const email = r.biz.pickupEmail || '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Enter a valid pickup contact email.');
      return issues;
    }
    case 'bank': return Object.values(sellerBankErrors(r.bank));
    case 'documents': return sellerDocumentIssues({ docs: r.docs, panNumber: r.panNumber, gst: r.gst });
    default: return [];
  }
}
