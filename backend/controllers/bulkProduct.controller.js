import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Seller from '../models/Seller.js';
import CategoryAttribute from '../models/CategoryAttribute.js';
import CatalogAttribute from '../models/CatalogAttribute.js';
import { httpError } from '../utils/response.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { mediaContext } from '../services/media.service.js';
import { recordStockMovements } from '../services/inventory.service.js';
import { resolveCategoryFields, categoryRequiresApproval } from '../services/catalogAttribute.service.js';
import { APPROVAL } from '../constants/enums.js';
import { JWT_SECRET, JWT_ALGORITHM } from '../config/jwt.js';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import { validateBulkRows } from '../services/bulkProductValidation.service.js';
import { parseSpreadsheet, generateBulkTemplateExcelJS } from '../utils/excelParser.js';

const TEMPLATE_PURPOSE = 'bulk-template';
const MODES = ['quick', 'grocery', 'ecommerce'];
/**
 * Categories a product may be filed under: system categories (Smart Buy, Hot Deals) are storefront tabs and are
 * left out; any sub-category Admin adds under one becomes a top-level choice, as in the seller form.
 */
const listableCategories = (list) => {
  const systemIds = new Set(list.filter((c) => c.isSystem).map((c) => String(c._id)));
  return list.filter((c) => !c.isSystem).map((c) => (c.parent && systemIds.has(String(c.parent)) ? { ...c, parent: null } : c));
};

// Image and file fields cannot be typed into a spreadsheet cell.
const SHEET_FIELD_TYPES = ['text', 'longtext', 'number', 'decimal', 'select', 'multiselect', 'date', 'boolean'];

/**
 * The Category Fields (Admin → Category Fields) used anywhere in this storefront, one template column each,
 * with where they are used / required so the seller knows which ones matter for their product.
 */
async function templateFieldColumns(categories) {
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const mappings = await CategoryAttribute.find({ category: { $in: categories.map((c) => c._id) }, isActive: { $ne: false } }).lean();
  if (!mappings.length) return [];
  const attributes = await CatalogAttribute.find({ _id: { $in: [...new Set(mappings.map((m) => String(m.attribute)))] }, isActive: true, fieldType: { $in: SHEET_FIELD_TYPES } }).lean();
  return attributes.map((a) => {
    const uses = mappings.filter((m) => String(m.attribute) === String(a._id));
    const names = (list) => [...new Set(list.map((m) => byId.get(String(m.category))?.name).filter(Boolean))];
    return {
      code: a.code, label: a.label, fieldType: a.fieldType, unit: a.unit || '', helpText: a.helpText || '',
      options: (a.options || []).filter((o) => o.isActive !== false).map((o) => o.label || o.value),
      isVariant: uses.some((m) => m.isVariant),
      usedIn: names(uses),
      requiredIn: names(uses.filter((m) => m.required)),
    };
  }).sort((x, y) => (y.requiredIn.length - x.requiredIn.length) || x.label.localeCompare(y.label));
}

async function sendTemplate(res, rawMode) {
  const mode = String(rawMode || 'ecommerce').toLowerCase();
  if (mode === 'shg') throw httpError(400, 'The SHG catalog has been retired');
  if (!MODES.includes(mode)) throw httpError(400, 'Choose Shop All or Quick Commerce.');
  const isQuick = mode === 'quick' || mode === 'grocery';
  const targetChannel = isQuick ? 'grocery' : 'ecommerce';

  // Active categories of this storefront (fall back to all active ones when none are typed yet).
  let categories = listableCategories(await Category.find({ isActive: true, type: targetChannel }).lean());
  if (!categories || categories.length === 0) categories = listableCategories(await Category.find({ isActive: true }).lean());

  // Header → main → sub, for the dependent drop-downs.
  const headerMap = new Map();
  categories.forEach((cat) => {
    if (!cat.parent) headerMap.set(String(cat._id), { headerId: String(cat._id), headerName: cat.name, mainMap: new Map() });
  });
  const mainToHeaderId = new Map();
  categories.forEach((cat) => {
    if (cat.parent && headerMap.has(String(cat.parent))) {
      headerMap.get(String(cat.parent)).mainMap.set(String(cat._id), { mainId: String(cat._id), mainName: cat.name, subCategories: [] });
      mainToHeaderId.set(String(cat._id), String(cat.parent));
    }
  });
  categories.forEach((cat) => {
    if (cat.parent && mainToHeaderId.has(String(cat.parent))) {
      const mainObj = headerMap.get(mainToHeaderId.get(String(cat.parent)))?.mainMap.get(String(cat.parent));
      if (mainObj && !mainObj.subCategories.includes(cat.name)) mainObj.subCategories.push(cat.name);
    }
  });

  const categoriesTree = [];
  const categoryHierarchy = [];
  headerMap.forEach((h) => {
    const mainList = [];
    h.mainMap.forEach((m) => {
      mainList.push({ mainName: m.mainName, mainId: m.mainId, subCategories: m.subCategories.length > 0 ? m.subCategories : ['General'] });
      (m.subCategories.length ? m.subCategories : ['General']).forEach((subName) => categoriesTree.push({ headerName: h.headerName, mainName: m.mainName, subName }));
    });
    if (mainList.length === 0) {
      mainList.push({ mainName: 'General', mainId: null, subCategories: ['General'] });
      categoriesTree.push({ headerName: h.headerName, mainName: 'General', subName: 'General' });
    }
    categoryHierarchy.push({ headerName: h.headerName, headerId: h.headerId, mainCategories: mainList });
  });

  const fieldColumns = await templateFieldColumns(categories);
  const excelBuffer = await generateBulkTemplateExcelJS(categoriesTree, mode, categoryHierarchy, fieldColumns);
  const filename = isQuick ? 'Bulkimart_Quick_Commerce_Bulk_Product_Template.xlsx' : 'Bulkimart_Ecommerce_Bulk_Product_Template.xlsx';

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(Buffer.from(excelBuffer));
}

/**
 * @desc    Download the bulk template: live categories as dependent drop-downs, plus one column per Category Field
 * @route   GET /api/products/bulk/template?mode=
 * @access  Private (Seller/Admin)
 */
export const downloadBulkTemplate = asyncHandler(async (req, res) => sendTemplate(res, req.query.mode));

/**
 * @desc    A short-lived link that downloads the template without a login header, so the seller app can open it
 *          in the phone's browser (which saves it to Downloads). The token carries no account id, so the auth
 *          middleware rejects it as a login token.
 * @route   GET /api/products/bulk/template-link?mode=
 * @access  Private (Seller/Admin)
 */
export const getBulkTemplateLink = asyncHandler(async (req, res) => {
  const mode = String(req.query.mode || 'ecommerce').toLowerCase();
  if (!MODES.includes(mode)) throw httpError(400, 'Choose Shop All or Quick Commerce.');
  const token = jwt.sign({ purpose: TEMPLATE_PURPOSE, mode }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: '10m' });
  const path = `/api/products/bulk/template/download?token=${encodeURIComponent(token)}`;
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, path, url: `${req.protocol}://${req.get('host')}${path}`, expiresInSeconds: 600 });
});

/**
 * @route   GET /api/products/bulk/template/download?token=
 * @access  Public with a valid template link (10 minutes)
 */
export const downloadBulkTemplateWithLink = asyncHandler(async (req, res) => {
  let payload;
  try { payload = jwt.verify(String(req.query.token || ''), JWT_SECRET, { algorithms: [JWT_ALGORITHM] }); }
  catch { throw httpError(401, 'This download link has expired. Open Bulk upload in the app and tap Download template again.'); }
  if (!payload || payload.purpose !== TEMPLATE_PURPOSE || payload.id) throw httpError(401, 'Invalid download link');
  return sendTemplate(res, payload.mode);
});

/**
 * @desc    Process Bulk Upload (Excel + ZIP file)
 * @route   POST /api/products/bulk/upload
 * @access  Private (Seller/Admin)
 *
 * Same rules as the Add Product form (product.controller.js createProduct): category fields, at least one
 * image, admin approval for categories that require it, opening stock in the stock history. Rows with the
 * same Product Name in the same category become one product with several variants.
 */
export const processBulkUpload = asyncHandler(async (req, res) => {
  const seller = req.seller || (req.userType !== 'admin' ? await Seller.findOne({ userId: req.user._id }) : null);
  if (req.userType !== 'admin' && (!seller || seller.status !== 'approved')) throw httpError(403, 'Approved seller account required');
  const excelFile = req.files?.excelFile?.[0], zipFile = req.files?.zipFile?.[0];
  if (!excelFile) throw httpError(400, 'Choose a completed .xlsx or .csv product sheet.');
  if (excelFile.buffer.length > 10 * 1024 * 1024) throw httpError(413, 'Product sheet must be 10 MB or smaller.');
  if (zipFile && (!/\.zip$/i.test(zipFile.originalname) || !zipFile.buffer.length)) throw httpError(400, 'Choose a non-empty .zip image archive.');
  const imageMap = new Map();
  if (zipFile) {
    try {
      const archive = await JSZip.loadAsync(zipFile.buffer, { checkCRC32: true });
      let bytes = 0;
      for (const file of Object.values(archive.files)) {
        // Skip folders and the hidden files macOS adds to ZIPs (__MACOSX/, ._photo.jpg).
        if (file.dir || /(^|\/)(__MACOSX\/|\._)/.test(file.name) || !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) continue;
        const buffer = await file.async('nodebuffer'); bytes += buffer.length;
        if (bytes > 100 * 1024 * 1024) throw Error('Extracted images exceed 100 MB.');
        imageMap.set(file.name.toLowerCase(), buffer); imageMap.set(file.name.split('/').pop().toLowerCase(), buffer);
      }
    } catch (error) { throw httpError(400, 'Could not read image ZIP. Upload a valid ZIP archive. ' + error.message); }
  }
  let rows;
  try { rows = await parseSpreadsheet(excelFile.buffer, excelFile.originalname); }
  catch (error) { throw httpError(400, error.message); }
  if (!rows.length) throw httpError(400, 'The product sheet contains no product rows. Fill in the latest template before uploading.');
  const mode = String(req.query.mode || req.body?.mode || 'ecommerce').toLowerCase();
  if (!MODES.includes(mode)) throw httpError(400, 'Choose Shop All or Quick Commerce.');
  const type = ['quick', 'grocery'].includes(mode) ? 'grocery' : 'ecommerce';
  const categories = listableCategories(await Category.find({ isActive: true, type }).lean());

  const fieldCache = new Map();
  const getFields = (categoryId, subCategoryId) => {
    const key = `${categoryId}:${subCategoryId || ''}`;
    if (!fieldCache.has(key)) fieldCache.set(key, resolveCategoryFields(categoryId, subCategoryId));
    return fieldCache.get(key);
  };
  const { products, errors } = await validateBulkRows(rows, categories, imageMap, { getFields });
  if (errors.length) throw httpError(400, 'Product sheet validation failed. Fix the listed rows and upload again. No products were imported.', { errors });
  if (!products.length) throw httpError(400, 'The sheet contains only examples or comments. Add your product rows.');

  const sellerId = seller?._id || req.user?.sellerId;
  const sellerName = seller ? (seller.storeDetails?.name || seller.businessName) : undefined;
  const folder = `products/${sellerId}`;
  const uploaded = new Map(); // one upload per image file, even when several rows use it
  const toUrl = async (image) => {
    if (/^https?:\/\//i.test(image)) return image;
    const key = image.toLowerCase();
    if (!uploaded.has(key)) {
      const url = await uploadToCloudinary(imageMap.get(key), folder, mediaContext(req));
      if (!url) throw Error('Image upload failed for ' + image);
      uploaded.set(key, url);
    }
    return uploaded.get(key);
  };

  const created = [], importErrors = [];
  let pendingCount = 0;
  for (const product of products) {
    try {
      const images = [];
      for (const image of product.images) images.push(await toUrl(image));
      const variants = [];
      for (const [i, variant] of product.data.variants.entries()) {
        const variantImages = [];
        for (const image of product.variantImages[i] || []) variantImages.push(await toUrl(image));
        variants.push({ ...variant, ...(variantImages.length ? { images: variantImages } : {}) });
      }
      // Categories where Admin switched on "Require admin approval" start in Pending review, as in the form.
      const needsApproval = await categoryRequiresApproval(product.data.category, product.data.subCategory);
      const row = await Product.create({
        ...product.data, variants, type, sellerId, ...(sellerName ? { sellerName } : {}), images,
        status: needsApproval ? APPROVAL.PENDING : APPROVAL.APPROVED,
        isActive: !needsApproval,
      });
      if (needsApproval) pendingCount += 1;
      await recordStockMovements((row.variants || []).map((v) => ({
        productId: row._id, variantId: v._id, variantName: v.name, delta: Number(v.stock) || 0, reason: 'product_created',
        actorType: req.userType === 'admin' ? 'admin' : 'seller', actorId: req.user._id,
      })));
      created.push({ _id: row._id, name: row.name, price: row.price, stock: row.stock, variantsCount: row.variants.length, imagesCount: images.length, status: row.status });
    } catch (error) { importErrors.push({ row: product.row, rows: product.rows, name: product.data.name, reason: error.message }); }
  }
  res.status(200).json({ success: true, totalRows: products.length, successCount: created.length, failedCount: importErrors.length, pendingCount, products: created, errors: importErrors });
});
