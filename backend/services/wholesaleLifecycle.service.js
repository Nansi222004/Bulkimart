import Seller from '../models/Seller.js';
import { httpError } from '../utils/response.js';

// Compare the version actually read. Legacy sellers may have no __v yet.
export const saveWholesaleTransition = async (seller, fields, expectedVersion) => {
  if (expectedVersion !== undefined && expectedVersion !== (seller.__v ?? 0)) throw httpError(409, 'Seller changed. Refresh before deciding Wholesale access.');
  const updated = await Seller.findOneAndUpdate({
    _id: seller._id, status: 'approved',
    __v: seller.__v == null ? { $in: [null, 0] } : seller.__v,
  }, { $set: fields, $inc: { __v: 1 } }, { returnDocument: 'after', runValidators: true });
  if (!updated) throw httpError(409, 'Seller changed. Refresh before updating Wholesale access.');
  return updated;
};
