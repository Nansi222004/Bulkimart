import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { getAdminFinancialMetrics } from '../services/adminDashboardMetrics.service.js';
import { getAdminOrderAnalytics } from '../services/adminDashboardAnalytics.service.js';
import { httpError } from '../utils/response.js';

export const getDashboardFinancialMetrics = asyncHandler(async (req,res) => {
  res.set('Cache-Control', 'no-store');
  return ok(res,await getAdminFinancialMetrics());
});

export const getDashboardOrderAnalytics = asyncHandler(async (req,res) => {
  res.set('Cache-Control', 'no-store');
  if (Object.keys(req.query).length) throw httpError(400, 'Order analytics supports all-time scope only');
  return ok(res,await getAdminOrderAnalytics());
});
