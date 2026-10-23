import express from 'express';
import rateLimit from 'express-rate-limit';
import { advertisingPilotCapabilities } from '../services/advertisingPolicy.service.js';
import { sponsoredCategoryPlacements } from '../services/advertisingServing.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { recordAdvertisingEvent, advertisingTelemetryConfig } from '../services/advertisingTelemetry.service.js';
export const advertisingPublicRouter = express.Router();
advertisingPublicRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
advertisingPublicRouter.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
advertisingPublicRouter.post('/events',express.json({limit:'4kb'}),asyncHandler(async(req,res)=>ok(res,await recordAdvertisingEvent(req.body))));
advertisingPublicRouter.get('/placements', asyncHandler(async (req, res) => {
  try {
    const rows = await sponsoredCategoryPlacements(req.query);
    return ok(res, rows, '', { mode: rows.some(r=>r.mode==='PAID_CATEGORY')?'SPONSORED_CATEGORY':'NON_BILLABLE_PILOT', billable: false, telemetryEnabled: advertisingTelemetryConfig().enabled,
      pilotEnabled: advertisingPilotCapabilities().pilotEnabled });
  } catch (error) {
    if (error.status === 400) throw error;
    // Do not expose database/provider details or interfere with organic APIs.
    return ok(res, [], '', { mode: 'NON_BILLABLE_PILOT', unavailable: true, billable: false, telemetryEnabled: false });
  }
}));
