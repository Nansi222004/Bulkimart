import express from 'express';
import {
  getCategoryFields, getCategoryFilterOptions, listAttributes, createAttribute, updateAttribute, setAttributeStatus,
  getCategoryMappings, replaceCategoryMappings, setCategoryApproval, listCatalogAudit, uploadCatalogFileHandler,
} from '../controllers/catalogAttribute.controller.js';
import { protect, requireAdmin, requireRole, requireSellerSession } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { uploadCatalogFile } from '../middlewares/upload.middleware.js';
import { requireCatalogPermission } from '../middlewares/catalogPermission.middleware.js';

// Public: the fields a seller fills in for a category, and the customer filters for it.
export const catalogPublicRouter = express.Router();
catalogPublicRouter.get('/fields', getCategoryFields);
catalogPublicRouter.get('/filters', getCategoryFilterOptions);
// Seller: upload a file for an image/file field or a variant photo.
catalogPublicRouter.post('/uploads', protect, requireRole('seller'), requireSellerSession, requireApprovedSeller, uploadCatalogFile, uploadCatalogFileHandler);

// Admin: attribute library, category mappings and the change log.
export const catalogAdminRouter = express.Router();
catalogAdminRouter.use(protect, requireAdmin);
catalogAdminRouter.get('/attributes', listAttributes);
catalogAdminRouter.get('/categories/:id/attributes', getCategoryMappings);
catalogAdminRouter.get('/audit', listCatalogAudit);
catalogAdminRouter.post('/attributes', requireCatalogPermission, createAttribute);
catalogAdminRouter.put('/attributes/:id', requireCatalogPermission, updateAttribute);
catalogAdminRouter.patch('/attributes/:id/status', requireCatalogPermission, setAttributeStatus);
catalogAdminRouter.put('/categories/:id/attributes', requireCatalogPermission, replaceCategoryMappings);
catalogAdminRouter.patch('/categories/:id/approval', requireCatalogPermission, setCategoryApproval);
