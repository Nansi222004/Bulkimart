const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;

export const validateDeliveryPayoutStep = ({ form = {}, passbookFile, existingPassbookUrl }) => {
  const errors = {};
  const loc = form.location || {};
  const hasFix = loc.lat !== undefined && loc.lng !== undefined;

  if (!hasFix && !(String(loc.address || '').trim() && /^\d{6}$/.test(String(loc.pincode || '')))) {
    errors.location = 'Share your current location, or enter an address with a 6-digit pincode.';
  }

  const zones = String(form.zones || '').split(',').map((zone) => zone.trim()).filter(Boolean);
  if (!zones.length) errors.zones = 'Add at least one delivery pincode.';
  else if (zones.some((zone) => !/^\d{6}$/.test(zone))) errors.zones = 'Every delivery pincode must contain exactly 6 digits.';

  if (String(form.bankHolder || '').trim().length < 2) errors.bankHolder = 'Enter the account holder name shown by the bank.';
  if (String(form.bankName || '').trim().length < 2) errors.bankName = 'Enter the bank name.';
  if (!/^\d{6,18}$/.test(String(form.bankAccount || ''))) errors.bankAccount = 'Account number must contain 6 to 18 digits.';
  if (!IFSC_PATTERN.test(String(form.bankIfsc || '').trim().toUpperCase())) errors.bankIfsc = 'Enter a valid 11-character IFSC code.';
  if (form.upiId && !UPI_PATTERN.test(String(form.upiId).trim())) errors.upiId = 'Enter a valid UPI ID, such as name@bank.';
  if (!passbookFile && !existingPassbookUrl) errors.passbook = 'Upload a passbook page or cancelled cheque.';

  return { errors, zones };
};

export const submitDeliveryPayoutStep = async ({
  form,
  passbookFile,
  existingPassbookUrl,
  submit,
  lock,
}) => {
  const { errors, zones } = validateDeliveryPayoutStep({ form, passbookFile, existingPassbookUrl });
  if (Object.keys(errors).length) return { ok: false, code: 'VALIDATION', errors };
  if (lock.current) return { ok: false, code: 'IN_PROGRESS', message: 'Submission is already in progress.' };

  lock.current = true;
  try {
    const result = await submit({
      zones: zones.join(','),
      location: form.location,
      bank: {
        accountNo: form.bankAccount,
        ifsc: String(form.bankIfsc).trim().toUpperCase(),
        holderName: String(form.bankHolder).trim(),
        bankName: String(form.bankName).trim(),
        upiId: String(form.upiId || '').trim(),
      },
      passbookFile,
    });
    if (!result?.ok) return { ok: false, code: 'SUBMISSION_FAILED', message: result?.message || 'Could not save payout details.' };
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, code: 'SUBMISSION_FAILED', message: error?.message || 'Could not save payout details.' };
  } finally {
    lock.current = false;
  }
};
