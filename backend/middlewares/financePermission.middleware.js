import { httpError } from '../utils/response.js';

export const requireFinancePermission = (req, res, next) => {
  if (req.userType !== 'admin' || !req.user?.permissions?.includes('manage_finance')) return next(httpError(403, 'Explicit manage_finance permission is required'));
  next();
};
