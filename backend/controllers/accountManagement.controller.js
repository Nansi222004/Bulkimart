import mongoose from 'mongoose';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { httpError, ok } from '../utils/response.js';
import { executeAccountAction } from '../services/accountLifecycle.service.js';

const messages = {
  deleted: 'Account permanently deleted because no historical or financial references were found.',
  deactivated: 'Account deactivated and retained because historical references must be preserved.',
};

const handler = (category) => asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(400, `Invalid ${category} account identifier`);

  const result = await executeAccountAction({
    category,
    targetId: req.params.id,
    actorAdminId: req.user._id,
    source: 'admin',
  });
  if (!result) throw httpError(404, `${category === 'delivery' ? 'Delivery partner' : category} account not found`);
  if (result.outcome === 'skipped') {
    throw httpError(409, 'Account cannot be removed while active fulfillment or unresolved financial obligations exist.', {
      action: 'blocked', reasonCodes: result.reasonCodes,
    });
  }
  return ok(res, { action: result.outcome, reasonCodes: result.reasonCodes }, messages[result.outcome]);
});

export const deleteCustomerAccount = handler('customer');
export const deleteSellerAccount = handler('seller');
export const deleteDeliveryAccount = handler('delivery');
