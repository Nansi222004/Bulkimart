import { httpError } from '../utils/response.js';

export const requireFinancePermission = (req, res, next) => {
  const isSuperAdmin = req.userType === 'admin' && req.user?.role === 'superAdmin';
  const hasFinancePermission = req.userType === 'admin' && req.user?.permissions?.includes('manage_finance');
  if (!isSuperAdmin && !hasFinancePermission) return next(httpError(403, 'Explicit manage_finance permission is required'));
  next();
};
