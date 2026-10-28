import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { parseReportQuery, overviewReport, customersReport, vendorsReport, deliveryReport, ordersReport, exportReport } from '../services/adminReports.service.js';

// Read-only admin reports. Routing applies auth, admin and manage_finance.
const handlers = { overview: overviewReport, customers: customersReport, vendors: vendorsReport, delivery: deliveryReport, orders: ordersReport };
const noStore = res => res.set('Cache-Control', 'no-store');

export const getReport = report => asyncHandler(async (req, res) => {
  const { report: _ignored, ...query } = req.query;
  const params = parseReportQuery(report, query);
  noStore(res);
  return ok(res, await handlers[report](params));
});

export const exportAdminReport = asyncHandler(async (req, res) => {
  const { report, ...query } = req.query;
  const params = parseReportQuery(typeof report === 'string' ? report : '', query);
  const { filename, csv } = await exportReport(report, params);
  noStore(res);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM so spreadsheet apps read ₹ and names in UTF-8.
  return res.send(`﻿${csv}`);
});
