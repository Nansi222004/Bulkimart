import Seller from '../models/Seller.js';
import User from '../models/User.js';
import { httpError } from '../utils/response.js';

// An eligibility version is a transactional decision, not a business-state
// change. Writes to the same Seller/User serialize suspension/deactivation
// against checkout; a losing checkout retries and rechecks both conditions.
export const fenceCheckoutSellers = async (sellerIds, session, wholesale = false) => {
  for (const sellerId of new Set(sellerIds.filter(Boolean).map(String))) {
    const filter = { _id: sellerId, status: 'approved' };
    if (wholesale) Object.assign(filter, { salesChannels: 'wholesale', 'wholesaleChannel.status': 'approved' });
    const locked = await Seller.updateOne(filter, { $inc: { __v: 1 } }, { session });
    if (!locked.matchedCount) throw httpError(409, 'Seller access changed. Review your basket.');
    const seller = await Seller.findById(sellerId).select('userId').session(session);
    const account = seller?.userId && await User.updateOne({ _id: seller.userId, isActive: true }, { $inc: { __v: 1 } }, { session });
    if (!account?.matchedCount) throw httpError(409, 'Seller account is unavailable. Review your basket.');
  }
};
