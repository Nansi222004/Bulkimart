import ExcelJS from 'exceljs';
import { extractZip } from './zipExtractor.js';

/**
 * Expected columns for Bulk Listing Template
 */
export const BULK_COLUMNS = [
  'Header Category',
  'Main Category',
  'Sub Category',
  'Brand',
  'Product Name',
  'Variant Name',
  'Unit',
  'Pack Size',
  'Product Description',
  'Specifications',
  'Search Tags',
  'Primary Image URL',
  'Front Image URL',
  'Back Image URL',
  'Sell Price (₹)',
  'MRP Price (₹)',
  'Stock'
];

/**
 * Generates formatted Excel (.xlsx) template with styled headers & Data Validation Dropdowns
 *
 * @param {Array<Object>} categoriesTree - Pre-fetched categories from MongoDB
 * @returns {Promise<Buffer>} Excel buffer
 */
export async function generateBulkTemplateExcelJS(categoriesTree = [], mode = 'ecommerce', categoryHierarchy = []) {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Main Product Template
  const worksheet = workbook.addWorksheet('Product Template');

  // Sheet 2: Hidden Reference Sheet for Dropdowns
  const refSheet = workbook.addWorksheet('CategoriesRef');
  refSheet.state = 'hidden';

  const toExcelDefinedName = (name) => {
    if (!name) return '_General';
    let s = String(name).trim().replace(/[^a-zA-Z0-9]/g, '_');
    if (/^[0-9]/.test(s)) s = '_' + s;
    return s;
  };

  const getColumnLetter = (colIndex) => {
    let temp = '';
    let letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(65 + temp) + letter;
      colIndex = Math.floor((colIndex - temp - 1) / 26);
    }
    return letter;
  };

  // Build structured hierarchy if not supplied
  let hierarchy = categoryHierarchy;
  if (!hierarchy || hierarchy.length === 0) {
    const hMap = new Map();
    categoriesTree.forEach(row => {
      const hName = row.headerName || 'General';
      const mName = row.mainName || 'General';
      const sName = row.subName || 'General';
      if (!hMap.has(hName)) hMap.set(hName, new Map());
      const mMap = hMap.get(hName);
      if (!mMap.has(mName)) mMap.set(mName, new Set());
      mMap.get(mName).add(sName);
    });

    hierarchy = [];
    hMap.forEach((mMap, hName) => {
      const mainCategories = [];
      mMap.forEach((subSet, mName) => {
        mainCategories.push({
          mainName: mName,
          subCategories: Array.from(subSet)
        });
      });
      hierarchy.push({
        headerName: hName,
        mainCategories
      });
    });
  }

  // Column A: Header Categories List
  const headerNames = hierarchy.map(h => h.headerName).filter(Boolean);
  if (headerNames.length === 0) headerNames.push('General');

  headerNames.forEach((hName, idx) => {
    refSheet.getCell(`A${idx + 1}`).value = hName;
  });

  const registeredDefinedNames = new Set();
  const headerListFormula = `CategoriesRef!$A$1:$A$${headerNames.length}`;

  try {
    workbook.definedNames.add(headerListFormula, 'HeaderCategories');
    registeredDefinedNames.add('HeaderCategories');
  } catch (e) {
    console.warn('[ExcelJS] Could not add HeaderCategories defined name:', e.message);
  }

  let refColIdx = 2; // Column B onwards in CategoriesRef

  // Write Main Categories per Header & add Defined Names
  hierarchy.forEach(hItem => {
    const hDefinedName = toExcelDefinedName(hItem.headerName);
    if (!registeredDefinedNames.has(hDefinedName)) {
      const mainList = (hItem.mainCategories || []).map(m => m.mainName).filter(Boolean);
      if (mainList.length === 0) mainList.push('General');

      const colLetter = getColumnLetter(refColIdx);
      mainList.forEach((mName, rIdx) => {
        refSheet.getCell(`${colLetter}${rIdx + 1}`).value = mName;
      });

      const rangeFormula = `CategoriesRef!$${colLetter}$1:$${colLetter}$${mainList.length}`;
      try {
        workbook.definedNames.add(rangeFormula, hDefinedName);
        registeredDefinedNames.add(hDefinedName);
      } catch (e) {
        console.warn(`[ExcelJS] Could not add defined name ${hDefinedName}:`, e.message);
      }

      refColIdx++;
    }
  });

  // Write Sub Categories per Main Category & add Defined Names
  hierarchy.forEach(hItem => {
    (hItem.mainCategories || []).forEach(mItem => {
      const mDefinedName = toExcelDefinedName(mItem.mainName);
      if (!registeredDefinedNames.has(mDefinedName)) {
        const subList = (mItem.subCategories || []).filter(Boolean);
        if (subList.length === 0) subList.push('General');

        const colLetter = getColumnLetter(refColIdx);
        subList.forEach((sName, rIdx) => {
          refSheet.getCell(`${colLetter}${rIdx + 1}`).value = sName;
        });

        const rangeFormula = `CategoriesRef!$${colLetter}$1:$${colLetter}$${subList.length}`;
        try {
          workbook.definedNames.add(rangeFormula, mDefinedName);
          registeredDefinedNames.add(mDefinedName);
        } catch (e) {
          console.warn(`[ExcelJS] Could not add defined name ${mDefinedName}:`, e.message);
        }

        refColIdx++;
      }
    });
  });

  // Define Columns & Widths
  const columnsList = [
    { header: 'Header Category', key: 'headerCategory', width: 22 },
    { header: 'Main Category', key: 'mainCategory', width: 22 },
    { header: 'Sub Category', key: 'subCategory', width: 22 },
    { header: 'Brand', key: 'brand', width: 18 },
    { header: 'Product Name', key: 'productName', width: 32 },
    { header: 'Variant Name', key: 'variantName', width: 18 },
    { header: 'Unit', key: 'unit', width: 12 },
    { header: 'Pack Size', key: 'packSize', width: 14 },
    { header: 'Product Description', key: 'productDescription', width: 38 },
    { header: 'Specifications', key: 'specifications', width: 32 },
    { header: 'Search Tags', key: 'searchTags', width: 32 },
    { header: 'Primary Image URL', key: 'primaryImageUrl', width: 38 },
    { header: 'Front Image URL', key: 'frontImageUrl', width: 38 },
    { header: 'Back Image URL', key: 'backImageUrl', width: 38 },
    { header: 'Sell Price (₹)', key: 'sellPrice', width: 16 },
    { header: 'MRP Price (₹)', key: 'mrpPrice', width: 16 },
    { header: 'Stock', key: 'stock', width: 14 },
  ];
  worksheet.columns = columnsList;

  // Mode Banner Styling
  const modeStr = String(mode).toLowerCase();
  const isQuick = modeStr === 'quick' || modeStr === 'grocery';

  const modeTitle = isQuick
    ? '⚡ QUICK COMMERCE BULK PRODUCT UPLOAD TEMPLATE'
    : '🛒 E-COMMERCE BULK PRODUCT UPLOAD TEMPLATE';
  const bannerColor = isQuick ? 'FF047857' : 'FF1E4E78'; // Emerald for Quick, Navy Blue for E-Commerce

  // Insert Row 1: Mode Title Banner (Merged A1:P1)
  worksheet.mergeCells('A1:P1');
  const bannerCell = worksheet.getCell('A1');
  bannerCell.value = modeTitle;
  bannerCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: bannerColor }
  };
  bannerCell.font = {
    name: 'Segoe UI',
    size: 13,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  bannerCell.protection = { locked: true };
  worksheet.getRow(1).height = 32;

  // Row 2: Table Column Headers (Navy Blue)
  const columnHeaders = columnsList.map(c => c.header);
  const headerRow = worksheet.getRow(2);
  headerRow.height = 28;
  columnHeaders.forEach((h, idx) => {
    const colLetter = String.fromCharCode(65 + idx);
    const cell = worksheet.getCell(`${colLetter}2`);
    cell.value = h;

    // Sell Price and MRP Price get distinct amber/orange header color
    const isPriceCol = h === 'Sell Price (₹)' || h === 'MRP Price (₹)';
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isPriceCol ? 'FFB45309' : 'FF1F4E78' } // Amber for price cols, Navy for others
    };
    cell.font = {
      name: 'Segoe UI',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    cell.protection = { locked: true };
  });

  // Row 3: Single Locked Mock Example Row — for visual reference only
  const sample1 = categoriesTree[0] || {};
  const mockRowValues = [
    sample1.headerName || 'Automotive',
    sample1.mainName || 'Car Accessories',
    sample1.subName || 'Seat Covers',
    'Sample Brand',
    '[EXAMPLE] Leatherette Seat Covers Set (DO NOT EDIT)',
    'Universal Fit',
    'piece',
    1,
    'This is a sample demonstration row for reference.',
    'Material: PU Leather | Color: Black',
    'sample, car accessories, seat cover',
    'sample-seat-cover.webp',
    'sample-front.jpg',
    'sample-back.jpg',
    99,      // Sell Price example
    149,     // MRP Price example (must be >= Sell Price)
    10,
  ];

  const mockRow = worksheet.getRow(3);
  mockRow.height = 24;
  mockRowValues.forEach((val, idx) => {
    const colLetter = String.fromCharCode(65 + idx);
    const cell = worksheet.getCell(`${colLetter}3`);
    cell.value = val;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F4F8' } // Light gray background for example row
    };
    cell.font = {
      name: 'Segoe UI',
      size: 10,
      italic: true,
      color: { argb: 'FF595959' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
    };
    cell.protection = { locked: true };
  });

  // Data Entry Rows (Row 4 to 1000)
  const unitsFormula = '"kg, g, litre, ml, piece, dozen, pack"';

  for (let rowIdx = 4; rowIdx <= 1000; rowIdx++) {
    worksheet.getCell(`Q${rowIdx}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: false, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid Stock', error: 'Stock must be a whole number of zero or more.' };
    // Explicitly unlock every cell in columns 1 to columnsList.length (A to P) so Excel permits editing
    for (let colIdx = 1; colIdx <= columnsList.length; colIdx++) {
      const cell = worksheet.getCell(rowIdx, colIdx);
      cell.protection = { locked: false };
    }

    // Column A: Header Category
    worksheet.getCell(`A${rowIdx}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [headerListFormula],
      showErrorMessage: true,
      errorTitle: 'Invalid Header Category',
      error: 'Please select a valid Header Category from the drop-down list.'
    };

    // Column B: Main Category (Dependent on Column A)
    const indirectMainFormula = `=INDIRECT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(A${rowIdx}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_"))`;
    worksheet.getCell(`B${rowIdx}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [indirectMainFormula],
      showErrorMessage: true,
      errorTitle: 'Invalid Main Category',
      error: 'Please select a valid Main Category for the selected Header Category.'
    };

    // Column C: Sub Category (Dependent on Column B)
    const indirectSubFormula = `=INDIRECT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(B${rowIdx}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_"))`;
    worksheet.getCell(`C${rowIdx}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [indirectSubFormula],
      showErrorMessage: true,
      errorTitle: 'Invalid Sub Category',
      error: 'Please select a valid Sub Category for the selected Main Category.'
    };

    // Column G: Unit
    worksheet.getCell(`G${rowIdx}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [unitsFormula],
      showErrorMessage: true,
      errorTitle: 'Invalid Unit',
      error: 'Please select a unit from the drop-down list (kg, g, litre, ml, piece, dozen, pack).'
    };

    // Column O: Sell Price (₹) — must be a positive number
    worksheet.getCell(`O${rowIdx}`).dataValidation = {
      type: 'decimal',
      operator: 'greaterThan',
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid Sell Price',
      error: 'Sell Price must be a positive number greater than 0 (e.g., 99 or 149.50).'
    };

    // Column P: MRP Price (₹) — must be >= Sell Price in Column O
    worksheet.getCell(`P${rowIdx}`).dataValidation = {
      type: 'custom',
      allowBlank: true,
      formulae: [`P${rowIdx}>=O${rowIdx}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Invalid MRP Price',
      error: 'MRP Price must be greater than or equal to Sell Price. The MRP is the original/crossed-out price shown to customers.'
    };
  }

  // Protect worksheet so Row 1 (Banner Title), Row 2 (Headers), and Row 3 (Example Row) are locked, while Row 4+ are editable
  await worksheet.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
    formatColumns: true,
    formatRows: true,
    insertRows: true,
    deleteRows: true
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Parses an XLSX buffer using ExcelJS
 *
 * @param {Buffer} buffer
 * @returns {Promise<Array<Object>>} Array of row objects
 */
export async function parseXLSX(buffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('The workbook has no product sheet.');

    const resultRows = [];
    let headers = [];

    worksheet.eachRow((row, rowNumber) => {
      const rowValues = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let val = cell.value;
        if (val && typeof val === 'object' && val.result !== undefined) {
          val = val.result;
        } else if (val && typeof val === 'object' && val.richText) {
          val = val.richText.map(t => t.text).join('');
        }
        rowValues[colNumber - 1] = val !== null && val !== undefined ? String(val).trim() : '';
      });

      // Dynamically detect column header row
      if (rowValues.includes('Header Category') || rowValues.includes('Product Name')) {
        headers = rowValues;
      } else if (headers.length > 0) {
        const rowObj = {};
        let hasData = false;
        headers.forEach((h, idx) => {
          if (h) {
            const val = rowValues[idx] !== undefined ? rowValues[idx] : '';
            rowObj[h.trim()] = val;
            if (val) hasData = true;
          }
        });

        const isExampleRow =
          String(rowObj['Product Name'] || '').includes('[EXAMPLE]') ||
          String(rowObj['Product Name'] || '').includes('DO NOT EDIT') ||
          String(rowObj['Header Category'] || '').includes('[EXAMPLE]') ||
          String(rowValues.join(' ')).includes('BULK PRODUCT UPLOAD TEMPLATE');

        if (hasData && !isExampleRow) {
          rowObj.__rowNumber = rowNumber;
          resultRows.push(rowObj);
        }
      }
    });

    return resultRows;
  } catch (err) {
    throw new Error(`Invalid .xlsx workbook: ${err.message}`);
  }
}

/**
 * Parses a CSV string or buffer into rows of key-value objects.
 */
export function parseCSV(content) {
  const text = (Buffer.isBuffer(content) ? content.toString('utf-8') : String(content)).replace(/^\uFEFF/, '');
  const lines = [], rowNumbers = [];
  let record = '', quoted = false, physicalRow = 1, recordRow = 1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { record += '""'; index++; continue; }
      quoted = !quoted;
    }
    if (char === '\n' && !quoted) { lines.push(record.replace(/\r$/, '')); rowNumbers.push(recordRow); record = ''; recordRow = physicalRow + 1; }
    else record += char;
    if (char === '\n') physicalRow++;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (record) { lines.push(record.replace(/\r$/, '')); rowNumbers.push(recordRow); }

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;

    const rowObj = {};
    rowObj.__rowNumber = rowNumbers[i];
    headers.forEach((h, idx) => {
      rowObj[h.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    rows.push(rowObj);
  }

  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Main parser entry point
 */
export async function parseSpreadsheet(buffer, originalName = '') {
  if (!buffer?.length) throw new Error('The product sheet is empty.');
  if (!/\.(xlsx|csv)$/i.test(originalName)) throw new Error('Use an .xlsx or .csv product sheet.');
  if (originalName.toLowerCase().endsWith('.csv')) {
    if (buffer.includes(0) || buffer.subarray(0, 2).toString() === 'PK') throw new Error('The file is not a UTF-8 CSV. Save it as CSV UTF-8 or upload .xlsx.');
    return parseCSV(buffer);
  }
  return await parseXLSX(buffer);
}

/**
 * Fallback CSV generator if explicitly requested
 */
export function generateBulkTemplateCSV(categoriesTree = []) {
  const headers = BULK_COLUMNS.join(',');
  const lines = [headers];
  const q = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

  const sample1 = categoriesTree[0] || {};
  lines.push([
    q(sample1.headerName || 'Grocery & Staples'),
    q(sample1.mainName || 'Dairy & Eggs'),
    q(sample1.subName || 'Milk'),
    q('Amul'),
    q('[EXAMPLE] Gold Milk 500ml'),
    q('500ml'),
    q('ml'),
    q('500'),
    q('Fresh Pasteurised Milk'),
    q('Fat: 4.5% | SNF: 8.5%'),
    q('milk, amul, dairy, fresh milk'),
    q('quickmart-07c8bc-primary.webp'),
    q('quickmart-07c8bc-front.jpg'),
    q('quickmart-07c8bc-back.jpg'),
    q('99'),
    q('149'),
    q('10')
  ].join(','));

  return lines.join('\n');
}

