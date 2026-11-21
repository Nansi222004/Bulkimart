import { httpError } from '../utils/response.js';

/**
 * Category and attribute configuration changes what every seller form and customer filter shows, so it is
 * limited to super admins, admins, and anyone given the explicit `manage_catalog` permission (PDF §10).
 * Moderators cannot change it unless granted that permission.
 */
export const requireCatalogPermission = (req, res, next) => {
  const admin = req.userType === 'admin' ? req.user : null;
  const allowed = admin && (admin.role === 'superAdmin' || admin.role === 'admin' || admin.permissions?.includes('manage_catalog'));
  if (!allowed) return next(httpError(403, 'Catalog configuration needs the manage_catalog permission'));
  next();
};
