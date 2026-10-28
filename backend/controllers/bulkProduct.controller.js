import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Seller from '../models/Seller.js';
import { httpError } from '../utils/response.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import JSZip from 'jszip';
import { validateBulkRows } from '../services/bulkProductValidation.service.js';
import { parseSpreadsheet, generateBulkTemplateExcelJS, BULK_COLUMNS } from '../utils/excelParser.js';

/**
 * @desc    Get/Download Bulk Upload Template pre-populated with valid system categories & Excel Data Validation Dropdowns
 * @route   GET /api/products/bulk/template
 * @access  Private (Seller/Admin)
 */
export const downloadBulkTemplate = asyncHandler(async (req, res) => {
  const mode = String(req.query.mode || 'ecommerce').toLowerCase();
  const isQuick = mode === 'quick' || mode === 'grocery';
  if (mode === 'shg') throw new Error('The SHG catalog has been retired');

  // Determine channel type for category filter
  const targetChannel = isQuick ? 'grocery' : 'ecommerce';

  // Fetch active categories for the specified channel from database
  let categories = await Category.find({ isActive: true, type: targetChannel }).lean();

  // If no channel-specific categories exist, fall back to all active categories
  if (!categories || categories.length === 0) {
    categories = await Category.find({ isActive: true }).lean();
  }

  // Sort into headers, main categories, and subcategories
  const headerMap = new Map();
  categories.forEach(cat => {
    if (!cat.parent) {
      headerMap.set(String(cat._id), {
        headerId: String(cat._id),
        headerName: cat.name,
        mainMap: new Map()
      });
    }
  });

  const mainToHeaderId = new Map();
  categories.forEach(cat => {
    if (cat.parent && headerMap.has(String(cat.parent))) {
      const headerObj = headerMap.get(String(cat.parent));
      const mainObj = {
        mainId: String(cat._id),
        mainName: cat.name,
        subCategories: []
      };
      headerObj.mainMap.set(String(cat._id), mainObj);
      mainToHeaderId.set(String(cat._id), String(cat.parent));
    }
  });

  categories.forEach(cat => {
    if (cat.parent && mainToHeaderId.has(String(cat.parent))) {
      const headerId = mainToHeaderId.get(String(cat.parent));
      const headerObj = headerMap.get(headerId);
      if (headerObj && headerObj.mainMap.has(String(cat.parent))) {
        const mainObj = headerObj.mainMap.get(String(cat.parent));
        if (!mainObj.subCategories.includes(cat.name)) {
          mainObj.subCategories.push(cat.name);
        }
      }
    }
  });

  const categoriesTree = [];
  const categoryHierarchy = [];

  headerMap.forEach(h => {
    const mainList = [];
    h.mainMap.forEach(m => {
      mainList.push({
        mainName: m.mainName,
        mainId: m.mainId,
        subCategories: m.subCategories.length > 0 ? m.subCategories : ['General']
      });

      if (m.subCategories.length > 0) {
        m.subCategories.forEach(subName => {
          categoriesTree.push({
            headerName: h.headerName,
            mainName: m.mainName,
            subName: subName
          });
        });
      } else {
        categoriesTree.push({
          headerName: h.headerName,
          mainName: m.mainName,
          subName: 'General'
        });
      }
    });

    if (mainList.length === 0) {
      mainList.push({
        mainName: 'General',
        mainId: null,
        subCategories: ['General']
      });
      categoriesTree.push({
        headerName: h.headerName,
        mainName: 'General',
        subName: 'General'
      });
    }

    categoryHierarchy.push({
      headerName: h.headerName,
      headerId: h.headerId,
      mainCategories: mainList
    });
  });

  // Generate ExcelJS .xlsx Buffer with dependent dropdowns
  const excelBuffer = await generateBulkTemplateExcelJS(categoriesTree, mode, categoryHierarchy);

  const filename = isQuick
    ? 'Bulkimart_Quick_Commerce_Bulk_Product_Template.xlsx'
    : 'Bulkimart_Ecommerce_Bulk_Product_Template.xlsx';

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(excelBuffer);
});

/**
 * @desc    Process Bulk Upload (Excel + ZIP file)
 * @route   POST /api/products/bulk/upload
 * @access  Private (Seller/Admin)
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
        if (file.dir || !/\.(jpe?g|png|webp|gif|svg)$/i.test(file.name)) continue;
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
  if (!['quick', 'grocery', 'ecommerce'].includes(mode)) throw httpError(400, 'Choose Shop All or Quick Commerce.');
  const type = ['quick', 'grocery'].includes(mode) ? 'grocery' : 'ecommerce';
  const categories = await Category.find({ isActive: true, type }).lean();
  const { products, errors } = validateBulkRows(rows, categories, imageMap);
  if (errors.length) throw httpError(400, 'Product sheet validation failed. Fix the listed rows and upload again. No products were imported.', { errors });
  if (!products.length) throw httpError(400, 'The sheet contains only examples or comments. Add your product rows.');
  const created = [], importErrors = [];
  for (const product of products) {
    try {
      const images = [];
      for (const image of product.images) {
        if (/^https?:\/\//i.test(image)) images.push(image);
        else {
          const url = await uploadToCloudinary(imageMap.get(image.toLowerCase()), 'products');
          if (!url) throw Error('Image upload failed for ' + image);
          images.push(url);
        }
      }
      const row = await Product.create({ ...product.data, type, sellerId: seller?._id || req.user?.sellerId, images, isActive: true, status: 'approved' });
      created.push({ _id: row._id, name: row.name, price: row.price, stock: row.stock, imagesCount: images.length });
    } catch (error) { importErrors.push({ row: product.row, name: product.data.name, reason: error.message }); }
  }
  res.status(200).json({ success: true, totalRows: products.length, successCount: created.length, failedCount: importErrors.length, products: created, errors: importErrors });
});
