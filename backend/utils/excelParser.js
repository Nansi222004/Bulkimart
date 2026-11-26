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
export async function generateBulkTemplateExcelJS(categoriesTree = [], mode = 'ecommerce', categoryHierarchy = [], fieldColumns = [], { deliveryMethodColumn = false } = {}) {
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
    // Shop All only, once delivery methods are switched on (services/deliveryMethod.service.js).
    ...(deliveryMethodColumn ? [{ header: 'Delivery Method', key: 'deliveryMethod', width: 18 }] : []),
    // One column per Category Field (Admin → Category Fields). "[code]" is how the upload finds the field.
    ...fieldColumns.map((f) => ({ header: `${f.label} [${f.code}]`, key: `field_${f.code}`, width: Math.min(40, Math.max(18, f.label.length + 10)), field: f })),
  ];
  worksheet.columns = columnsList.map(({ header, key, width }) => ({ header, key, width }));
  const lastColumn = getColumnLetter(columnsList.length);
  const columnOf = (key) => getColumnLetter(columnsList.findIndex((c) => c.key === key) + 1);

  // How each column is used — shown as a note when the header cell is hovered / tapped.
  const columnNotes = {
    productName: 'Required. One row = one product.\nTo add variants (500 g / 1 kg, S / M / L): repeat the SAME Product Name on several rows, one row per variant, each with its own Variant Name, price and stock. Product details (brand, description, images, category fields) go on the first row.',
    variantName: 'e.g. 500 g, 1 kg, Red, XL. Required when the product has several rows. If empty, Pack Size + Unit is used (e.g. "500 g").',
    unit: 'kg, g, litre, ml, piece, dozen or pack. Default: piece.',
    packSize: 'Number for this variant, e.g. 500 (with Unit g) = 500 g. Used as the variant name when Variant Name is empty.',
    specifications: 'Optional. Format: Name: Value | Name: Value. A name matching a category field column fills that field; the rest are shown in the description.',
    searchTags: 'Comma separated, e.g. milk, dairy, fresh',
    primaryImageUrl: 'Required on the first row of each product.\nEither the image file name inside your ZIP (e.g. amul-milk.jpg) or a full https:// link.\nImages on later rows of the same product become that variant\'s photos.',
    frontImageUrl: 'Optional. File name in the ZIP or https:// link.',
    backImageUrl: 'Optional. File name in the ZIP or https:// link.',
    sellPrice: 'Required. Selling price, up to 2 decimals.',
    mrpPrice: 'Optional. Must be at least the Sell Price. Default: Sell Price.',
    stock: 'Required. Whole number, 0 or more.',
    deliveryMethod: 'Optional. Easy Ship (default — Shiprocket) or Self Delivery (you deliver; prepaid orders only). Fill it on the first row of the product.',
  };
  const fieldNote = (f) => {
    const typeText = {
      text: 'Text', longtext: 'Text', number: 'Whole number', decimal: 'Number', date: 'Date (YYYY-MM-DD)', boolean: 'Yes or No',
      select: 'Pick one option', multiselect: 'One or more options, separated by commas',
    }[f.fieldType] || f.fieldType;
    const lines = [`${f.label}: ${typeText}${f.unit ? ` (${f.unit})` : ''}`];
    if (f.options?.length) lines.push(`Options: ${f.options.slice(0, 40).join(', ')}${f.options.length > 40 ? ' …' : ''}`);
    if (f.isVariant) lines.push('Per variant: fill it on every row of the product.');
    lines.push(f.requiredIn.length ? `REQUIRED for: ${f.requiredIn.slice(0, 15).join(', ')}${f.requiredIn.length > 15 ? ' …' : ''}` : 'Optional');
    if (f.usedIn.length) lines.push(`Used in: ${f.usedIn.slice(0, 15).join(', ')}${f.usedIn.length > 15 ? ' …' : ''}`);
    lines.push('Leave it empty for categories that do not use it.');
    if (f.helpText) lines.push(f.helpText);
    return lines.join('\n');
  };

  // Single-choice category fields get a drop-down from the hidden reference sheet.
  const fieldListFormula = new Map();
  for (const col of columnsList.filter((c) => c.field?.fieldType === 'select' && c.field.options?.length)) {
    const letter = getColumnLetter(refColIdx++);
    col.field.options.forEach((label, i) => { refSheet.getCell(`${letter}${i + 1}`).value = label; });
    fieldListFormula.set(col.key, `CategoriesRef!$${letter}$1:$${letter}$${col.field.options.length}`);
  }

  // Mode Banner Styling
  const modeStr = String(mode).toLowerCase();
  const isQuick = modeStr === 'quick' || modeStr === 'grocery';

  const modeTitle = isQuick
    ? '⚡ QUICK COMMERCE BULK PRODUCT UPLOAD TEMPLATE'
    : '🛒 E-COMMERCE BULK PRODUCT UPLOAD TEMPLATE';
  const bannerColor = isQuick ? 'FF047857' : 'FF1E4E78'; // Emerald for Quick, Navy Blue for E-Commerce

  // Row 1: Mode Title Banner across every column
  worksheet.mergeCells(`A1:${lastColumn}1`);
  const bannerCell = worksheet.getCell('A1');
  bannerCell.value = modeTitle;
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bannerColor } };
  bannerCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  bannerCell.protection = { locked: true };
  worksheet.getRow(1).height = 32;

  // Row 2: Table Column Headers
  const headerRow = worksheet.getRow(2);
  headerRow.height = 28;
  columnsList.forEach((col, idx) => {
    const cell = worksheet.getCell(`${getColumnLetter(idx + 1)}2`);
    cell.value = col.header;
    const isPriceCol = col.key === 'sellPrice' || col.key === 'mrpPrice';
    const isRequiredField = col.field?.requiredIn?.length;
    // Amber for price columns, teal for category fields (darker when required somewhere), navy for the rest.
    const color = isPriceCol ? 'FFB45309' : col.field ? (isRequiredField ? 'FF0F766E' : 'FF14B8A6') : 'FF1F4E78';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    cell.protection = { locked: true };
    const note = col.field ? fieldNote(col.field) : columnNotes[col.key];
    if (note) cell.note = note;
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
    ...(deliveryMethodColumn ? ['Easy Ship'] : []),
  ];

  const mockRow = worksheet.getRow(3);
  mockRow.height = 24;
  columnsList.forEach((col, idx) => {
    const cell = worksheet.getCell(`${getColumnLetter(idx + 1)}3`);
    cell.value = mockRowValues[idx] ?? '';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F8' } };
    cell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF595959' } };
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
  const [colA, colB, colC, colUnit, colPrice, colMrp, colStock] = ['headerCategory', 'mainCategory', 'subCategory', 'unit', 'sellPrice', 'mrpPrice', 'stock'].map(columnOf);

  for (let rowIdx = 4; rowIdx <= 1000; rowIdx++) {
    // Unlock every data cell so Excel permits editing
    for (let colIdx = 1; colIdx <= columnsList.length; colIdx++) {
      worksheet.getCell(rowIdx, colIdx).protection = { locked: false };
    }

    worksheet.getCell(`${colStock}${rowIdx}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Invalid Stock', error: 'Stock must be a whole number of zero or more.' };

    // Header Category
    worksheet.getCell(`${colA}${rowIdx}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [headerListFormula], showErrorMessage: true,
      errorTitle: 'Invalid Header Category', error: 'Please select a valid Header Category from the drop-down list.'
    };

    // Main Category (depends on Header Category)
    const indirectMainFormula = `=INDIRECT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${colA}${rowIdx}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_"))`;
    worksheet.getCell(`${colB}${rowIdx}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [indirectMainFormula], showErrorMessage: true,
      errorTitle: 'Invalid Main Category', error: 'Please select a valid Main Category for the selected Header Category.'
    };

    // Sub Category (depends on Main Category)
    const indirectSubFormula = `=INDIRECT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${colB}${rowIdx}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_"))`;
    worksheet.getCell(`${colC}${rowIdx}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [indirectSubFormula], showErrorMessage: true,
      errorTitle: 'Invalid Sub Category', error: 'Please select a valid Sub Category for the selected Main Category.'
    };

    // Unit
    worksheet.getCell(`${colUnit}${rowIdx}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [unitsFormula], showErrorMessage: true,
      errorTitle: 'Invalid Unit', error: 'Please select a unit from the drop-down list (kg, g, litre, ml, piece, dozen, pack).'
    };

    // Sell Price — must be a positive number
    worksheet.getCell(`${colPrice}${rowIdx}`).dataValidation = {
      type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Invalid Sell Price', error: 'Sell Price must be a positive number greater than 0 (e.g., 99 or 149.50).'
    };

    // MRP — must be >= Sell Price
    worksheet.getCell(`${colMrp}${rowIdx}`).dataValidation = {
      type: 'custom', allowBlank: true, formulae: [`${colMrp}${rowIdx}>=${colPrice}${rowIdx}`], showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Invalid MRP Price', error: 'MRP Price must be greater than or equal to Sell Price. The MRP is the original/crossed-out price shown to customers.'
    };

    if (deliveryMethodColumn) {
      worksheet.getCell(`${columnOf('deliveryMethod')}${rowIdx}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"Easy Ship,Self Delivery"'], showErrorMessage: true, errorStyle: 'stop',
        errorTitle: 'Invalid Delivery Method', error: 'Choose Easy Ship or Self Delivery.'
      };
    }

    // Single-choice category fields
    for (const [key, formula] of fieldListFormula) {
      worksheet.getCell(`${columnOf(key)}${rowIdx}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'stop',
        errorTitle: 'Invalid option', error: 'Pick one of the options in the drop-down list.'
      };
    }
  }

  // Keep the header visible while scrolling down
  worksheet.views = [{ state: 'frozen', ySplit: 2 }];

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
        if (val instanceof Date) {
          // Date cells (e.g. an Expiry date field) → YYYY-MM-DD, the format category date fields use.
          val = Number.isNaN(val.getTime()) ? '' : val.toISOString().slice(0, 10);
        } else if (val && typeof val === 'object' && (val.hyperlink || val.text)) {
          // Excel turns a pasted image link into a hyperlink cell: { text, hyperlink }.
          val = typeof val.text === 'string' ? val.text : (val.text?.richText ? val.text.richText.map(t => t.text).join('') : val.hyperlink);
        } else if (val && typeof val === 'object' && val.result !== undefined) {
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

