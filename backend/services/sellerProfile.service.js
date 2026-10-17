import { httpError } from '../utils/response.js';

// Account identity and approval never pass through the store-profile editor.
export function parseStoreProfile(body) {
  for (const field of ['status', 'wholesaleChannel', 'salesChannels', 'userId', '_id', 'businessName', 'approvedAt', 'approvedBy', 'rejectionReason', 'bankDetails', 'aadhaar']) {
    if (Object.hasOwn(body, field)) throw httpError(400, `${field} cannot be changed through profile editing`);
  }
  const result = {};
  const limits = { name: 160, description: 2000, address: 500, phone: 16, email: 254, city: 100, state: 100, pincode: 6 };
  for (const [field, limit] of Object.entries(limits)) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') throw httpError(400, `${field} must be text`);
    const value = body[field].trim();
    if (value.length > limit) throw httpError(400, `${field} is too long (maximum ${limit} characters)`);
    if (field === 'name' && !value) throw httpError(400, 'Store name is required');
    if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw httpError(400, 'Enter a valid store email address');
    if (field === 'phone' && value && !/^(?:\+91)?[6-9]\d{9}$/.test(value)) throw httpError(400, 'Enter a valid 10-digit alternate mobile number');
    if (field === 'pincode' && value && !/^[1-9]\d{5}$/.test(value)) throw httpError(400, 'Enter a valid 6-digit pincode');
    result[`storeDetails.${field}`] = value;
  }
  if (body.version !== undefined && (!Number.isSafeInteger(Number(body.version)) || Number(body.version) < 0)) throw httpError(400, 'Invalid profile version');
  return result;
}
