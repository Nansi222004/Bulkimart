import express from 'express';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { fail } from '../services/serviceForms.service.js';
import { serviceUploadControls } from '../middlewares/serviceUpload.middleware.js';
import * as c from '../controllers/serviceManagement.controller.js';
export const serviceAdminPermission = (req, _res, next) => {
  if (req.user.role !== 'superAdmin' && !req.user.permissions?.includes('manage_services')) fail('Service management permission required', 403);
  next();
};
export function serviceRouter(isAdmin = false, uploads = serviceUploadControls) {
  const r = express.Router();
  r.use(protect);
  if (isAdmin) r.use(requireAdmin, serviceAdminPermission);
  else r.use((req, _res, next) => { if (req.userType !== 'user' || !req.user.roles?.includes('seller')) fail('Seller access required', 403); next(); }, requireApprovedSeller);
  r.use((req, _res, next) => { if (['POST', 'PUT'].includes(req.method) && !req.is('multipart/form-data') && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) fail('A valid request body is required'); next(); });
  r.get('/applications', asyncHandler(c.listApplications));
  r.get('/applications/:id', asyncHandler(c.getApplication));
  r.get('/applications/:id/files/:fileId', asyncHandler(c.downloadFile));
  r.post(`/applications/:id/${isAdmin ? 'transition' : 'respond'}`, uploads.limiter, asyncHandler(c.preflightApplicationUpload), uploads.handle(c.actOnApplication));
  r.get('/', asyncHandler(c.listServices));
  r.get('/:id', asyncHandler(c.getService));
  if (isAdmin) {
    r.post('/', asyncHandler(c.saveService));
    r.put('/:id', asyncHandler(c.saveService));
    r.post('/:id/publication', asyncHandler(c.publishService));
  } else r.post('/:id/applications', uploads.limiter, uploads.handle(c.submitApplication));
  r.use((error, _req, _res, next) => {
    if (error.name === 'VersionError') { error.status = 409; error.message = 'Record changed. Reload before continuing.'; }
    next(error);
  });
  return r;
}
export default serviceRouter();
