import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Seller from '../models/Seller.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { extractZip } from '../utils/zipExtractor.js';
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
  const excelFile = req.files?.excelFile?.[0];
  const zipFile = req.files?.zipFile?.[0];

  if (!excelFile) {
    res.status(400);
    throw new Error('Please upload the completed Excel or CSV template file.');
  }

  // 1. Unzip image archive if provided
  let imageZipMap = new Map();
  if (zipFile && zipFile.buffer) {
    try {
      imageZipMap = extractZip(zipFile.buffer);
      console.log(`[Bulk Upload] Successfully unzipped ${imageZipMap.size} images from archive.`);
    } catch (err) {
      console.warn('[Bulk Upload] Error unzipping image file:', err.message);
    }
  }

  // 2. Parse Spreadsheet rows
  let rows = [];
  try {
    rows = await parseSpreadsheet(excelFile.buffer, excelFile.originalname);
  } catch (err) {
    res.status(400);
    throw new Error(`Failed to parse Excel file: ${err.message}`);
  }

  if (!rows || rows.length === 0) {
    res.status(400);
    throw new Error('The uploaded Excel file contains no valid product rows.');
  }

  // Determine one of the supported Seller storefront channels.
  const reqMode = String(req.query.mode || req.body?.mode || '').toLowerCase();
  if (reqMode === 'shg' || req.user?.roleContext === 'shg') {
    throw new Error('The SHG catalog has been retired');
  }
  const isQuick = reqMode === 'quick' || req.user?.roleContext === 'grocery';

  const channelType = isQuick ? 'grocery' : 'ecommerce';

  let sellerId = undefined;
  sellerId = req.user?.sellerId;
  if (!sellerId && req.userType === 'user') {
    const sellerDoc = await Seller.findOne({ userId: req.user._id });
    if (sellerDoc) sellerId = sellerDoc._id;
  }
  if (!sellerId && req.userType !== 'admin') {
    throw new Error('Approved Seller account required to upload products');
  }

  // 3. Pre-fetch Categories from Database for lookup
  let allCategories = await Category.find({ isActive: true, type: channelType }).lean();
  if (!allCategories || allCategories.length === 0) {
    allCategories = await Category.find({ isActive: true }).lean();
  }

  const categoryNameMap = new Map();
  allCategories.forEach(c => {
    categoryNameMap.set(c.name.trim().toLowerCase(), c);
  });

  const successProducts = [];
  const errors = [];

  // 4. Row-by-Row Processing
  for (let idx = 0; idx < rows.length; idx++) {
    const rowNum = idx + 2; // Row 1 is header
    const row = rows[idx];

    const productName = (row['Product Name'] || row['product name'] || row['Name'] || '').trim();
    if (!productName || productName.startsWith('#')) {
      // Skip comment or empty rows
      continue;
    }

    const headerName = (row['Header Category'] || row['Header'] || '').trim().toLowerCase();
    const mainCategoryName = (row['Main Category'] || row['Category'] || '').trim().toLowerCase();
    const subCategoryName = (row['Sub Category'] || row['Subcategory'] || '').trim().toLowerCase();
    const brand = (row['Brand'] || '').trim();
    const variantName = (row['Variant Name'] || '').trim();
    const description = (row['Product Description'] || row['Description'] || productName).trim();
    const specifications = (row['Specifications'] || '').trim();

    // Validate Categories
    let categoryDoc = categoryNameMap.get(mainCategoryName) || categoryNameMap.get(headerName);
    let subCategoryDoc = categoryNameMap.get(subCategoryName);

    if (!categoryDoc) {
      // Find fallback default category if specified category not matched
      categoryDoc = allCategories.find(c => c.parent !== null) || allCategories[0];
    }

    if (!categoryDoc) {
      errors.push({ row: rowNum, name: productName, reason: `Invalid category '${mainCategoryName || headerName}'. Category must exist in system.` });
      continue;
    }

    // Parse Prices & Stock
    const price = parseFloat(
      row['Sell Price (\u20b9)'] || row['Price (\u20b9)'] || row['Price'] || row['price'] || '0'
    );
    const mrp = parseFloat(
      row['MRP Price (\u20b9)'] || row['MRP (\u20b9)'] || row['MRP'] || row['mrp'] || String(price)
    );

    if (isNaN(price) || price <= 0) {
      errors.push({ row: rowNum, name: productName, reason: `Sell Price must be a positive number. Found: "${row['Sell Price (\u20b9)'] || row['Price'] || ''}"` });
      continue;
    }
    if (!isNaN(mrp) && mrp < price) {
      errors.push({ row: rowNum, name: productName, reason: `MRP Price (${mrp}) must be greater than or equal to Sell Price (${price}). MRP is the original / crossed-out price.` });
      continue;
    }
    const stock = parseInt(row['Stock'] || row['stock'] || '100', 10);
    const unit = (row['Unit'] || 'piece').trim().toLowerCase();

    // Parse Search Tags
    const rawTags = row['Search Tags'] || row['Tags'] || '';
    const tags = String(rawTags).split(',').map(t => t.trim()).filter(Boolean);

    // Image Uploads / URLs
    const imageFields = [
      'Primary Image URL', 'Primary Image',
      'Front Image URL', 'Front Image',
      'Back Image URL', 'Back Image'
    ];
    const imageUrls = [];

    for (const field of imageFields) {
      const imgVal = (row[field] || '').trim();
      if (!imgVal) continue;

      if (imgVal.startsWith('http://') || imgVal.startsWith('https://')) {
        imageUrls.push(imgVal);
      } else if (imageZipMap.has(imgVal.toLowerCase())) {
        const imgBuffer = imageZipMap.get(imgVal.toLowerCase());
        try {
          const cloudUrl = await uploadToCloudinary(imgBuffer, 'products');
          if (cloudUrl) imageUrls.push(cloudUrl);
        } catch (uploadErr) {
          console.warn(`[Bulk Upload] Cloudinary upload failed for ${imgVal}:`, uploadErr.message);
        }
      }
    }

    // Build Product Document
    try {
      const newProduct = await Product.create({
        type: channelType,
        sellerId: sellerId || undefined,
        name: productName,
        brand: brand || undefined,
        variantName: variantName || undefined,
        description,
        specifications: specifications || undefined,
        category: categoryDoc._id,
        subCategory: subCategoryDoc ? subCategoryDoc._id : undefined,
        price,
        mrp,
        stock: isNaN(stock) ? 100 : stock,
        unit: ['kg', 'g', 'litre', 'ml', 'piece', 'dozen', 'pack'].includes(unit) ? unit : 'piece',
        tags,
        images: imageUrls.length > 0 ? imageUrls : ['https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=600'],
        isActive: true,
        status: 'approved'
      });

      successProducts.push({
        _id: newProduct._id,
        name: newProduct.name,
        price: newProduct.price,
        stock: newProduct.stock,
        imagesCount: imageUrls.length
      });
    } catch (createErr) {
      errors.push({ row: rowNum, name: productName, reason: createErr.message });
    }
  }

  res.status(200).json({
    success: true,
    totalRows: rows.filter(r => (r['Product Name'] || r['Name']) && !String(r['Product Name'] || r['Name']).startsWith('#')).length,
    successCount: successProducts.length,
    failedCount: errors.length,
    products: successProducts,
    errors
  });
});


