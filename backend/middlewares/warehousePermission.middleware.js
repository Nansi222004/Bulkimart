import { httpError } from '../utils/response.js';

/**
 * Warehouse operations (receiving, stock, adjustments, FBB order fulfilment and FBB returns) change physical
 * inventory and what customers can buy, so they need a super admin or the explicit `manage_warehouse`
 * permission. Money (FBB charges, billing, settlement) separately needs `manage_finance`.
 */
export const requireWarehousePermission = (req, res, next) => {
  const admin = req.userType === 'admin' ? req.user : null;
  if (!admin || !(admin.role === 'superAdmin' || admin.permissions?.includes('manage_warehouse'))) {
    return next(httpError(403, 'Warehouse operations need the manage_warehouse permission'));
  }
  next();
};
