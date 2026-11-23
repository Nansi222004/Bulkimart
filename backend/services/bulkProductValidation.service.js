import { validateProductAttributes, specBrandName } from './catalogAttribute.service.js';

/**
 * Bulk product sheet → products, following the same rules as the Add Product form:
 *  - Rows with the same Product Name in the same category are ONE product; each row is a variant
 *    (500 g / 1 kg, S / M / L). Variant Names must then differ.
 *  - Every product needs at least one image (first row of the product).
 *  - Category Fields set up by Admin are columns named "Label [code]"; required ones must be filled,
 *    option fields must use one of the configured options, per-variant fields are read per row.
 *  - Brand, Variant Name, Pack Size and Specifications are saved (they used to be dropped).
 *
 * `getFields(categoryId, subCategoryId)` returns the category's resolved fields (resolveCategoryFields);
 * it is injected so this stays testable without a database.
 */

export const BULK_UNITS = ['kg', 'g', 'litre', 'ml', 'piece', 'dozen', 'pack'];
const FIELD_COLUMN = /\[([a-z][a-z0-9_]{1,49})\]\s*$/;
const MAX_VARIANTS = 100;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const read = (row, ...keys) => str(keys.map((key) => row[key]).find((value) => str(value) !== ''));
const sameText = (a, b) => a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
const twoDecimals = (n) => Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) <= 0.00001;

/** "Fat: 4.5% | SNF: 8.5%" (also ; or new lines) → [['Fat', '4.5%'], ['SNF', '8.5%']]. */
export function parseSpecificationText(text) {
  return str(text).split(/\s*(?:\||;|\r?\n)\s*/).map((part) => {
    const i = part.indexOf(':');
    return i > 0 ? [part.slice(0, i).trim(), part.slice(i + 1).trim()] : [part.trim(), ''];
  }).filter(([k, v]) => k || v);
}

/** A sheet value for a category field → what normalizeFieldValue expects (option labels → option values). */
function sheetValue(field, raw) {
  const text = str(raw);
  if (!text) return '';
  const option = (t) => field.options.find((o) => sameText(o.value, t) || sameText(o.label, t))?.value ?? t;
  if (field.fieldType === 'select') return option(text);
  if (field.fieldType === 'multiselect') return text.split(',').map((t) => t.trim()).filter(Boolean).map(option);
  if (field.fieldType === 'boolean') return text.toLowerCase();
  if (field.fieldType === 'date') {
    // A date cell without a date format arrives as Excel's day number (46418 = 2027-01-31).
    if (/^\d{5}$/.test(text)) return new Date(Math.round((Number(text) - 25569) * 86400000)).toISOString().slice(0, 10);
    // 31-01-2027 or 31/01/2027 (Indian order) → 2027-01-31
    const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return text;
}

/** Category-field columns of one row: { code: rawValue }. */
const fieldColumns = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const m = FIELD_COLUMN.exec(key);
    if (m && str(value)) out[m[1]] = value;
  }
  return out;
};

export async function validateBulkRows(rows, categories, imageMap = new Map(), { getFields = async () => [] } = {}) {
  const errors = [], products = [];
  const header = Object.keys(rows[0] || {});
  const required = [['Product Name', 'Name', 'product name'], ['Main Category', 'Category', 'Header Category', 'Header'], ['Sell Price (₹)', 'Price (₹)', 'Price', 'price'], ['Stock', 'stock']];
  const missing = required.filter((names) => !names.some((name) => header.includes(name))).map((names) => names[0]);
  if (missing.length) return { products, errors: [{ row: 1, reason: `Missing required columns: ${missing.join(', ')}. Download the latest template.` }] };

  const checkImage = (image, issues) => {
    if (/^https?:\/\//i.test(image)) { try { new URL(image); } catch { issues.push(`Invalid image URL: ${image}`); } }
    else if (!imageMap.has(image.toLowerCase())) issues.push(`Image '${image}' is missing from the ZIP archive. Upload the matching ZIP or use an HTTP(S) image URL`);
  };

  // 1. Read and check every row on its own.
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const name = read(row, 'Product Name', 'product name', 'Name');
    if (name.startsWith('#') || name.includes('[EXAMPLE]') || name.includes('DO NOT EDIT')) continue;
    const issues = [];
    const rowNumber = row.__rowNumber || index + 2;
    if (!name) issues.push('Product Name is required');
    else if (name.length < 3) issues.push('Product Name must be at least 3 characters');

    const main = read(row, 'Main Category', 'Category'), headerName = read(row, 'Header Category', 'Header'), sub = read(row, 'Sub Category', 'Subcategory');
    const matches = (text) => categories.filter((category) => category.name.trim().toLowerCase() === text.toLowerCase());
    const headerCategory = headerName ? matches(headerName)[0] : null;
    const mainMatches = matches(main || headerName);
    const category = mainMatches.find((candidate) => !headerCategory || !main || String(candidate.parent) === String(headerCategory._id) || String(candidate._id) === String(headerCategory._id));
    const subCategory = sub && sub.toLowerCase() !== 'general' ? matches(sub).find((candidate) => String(candidate.parent) === String(category?._id)) : null;
    if (headerName && !headerCategory) issues.push(`Header Category '${headerName}' does not exist in this storefront`);
    if (!category) issues.push(`Main Category '${main || headerName}' is invalid for the selected header and storefront`);
    if (sub && sub.toLowerCase() !== 'general' && !subCategory) issues.push(`Sub Category '${sub}' does not belong to the main category`);

    const rawPrice = read(row, 'Sell Price (₹)', 'Price (₹)', 'Price', 'price');
    const price = Number(rawPrice);
    const mrp = Number(read(row, 'MRP Price (₹)', 'MRP (₹)', 'MRP', 'mrp') || rawPrice);
    if (!rawPrice || !Number.isFinite(price) || price <= 0 || !twoDecimals(price)) issues.push('Sell Price must be a positive number with at most two decimal places');
    if (!Number.isFinite(mrp) || mrp < price || !twoDecimals(mrp)) issues.push('MRP must be a number at least equal to Sell Price, with at most two decimal places');
    const rawStock = read(row, 'Stock', 'stock'), stock = Number(rawStock);
    if (!rawStock || !Number.isSafeInteger(stock) || stock < 0) issues.push('Stock is required and must be a whole number of zero or more');
    const unit = (read(row, 'Unit') || 'piece').toLowerCase();
    if (!BULK_UNITS.includes(unit)) issues.push(`Unit must be ${BULK_UNITS.join(', ')}`);
    const rawPack = read(row, 'Pack Size'), packSize = Number(rawPack);
    if (rawPack && (!Number.isFinite(packSize) || packSize <= 0)) issues.push('Pack Size must be a number greater than 0 (e.g. 500 for 500 g)');

    const images = [['Primary Image URL', 'Primary Image'], ['Front Image URL', 'Front Image'], ['Back Image URL', 'Back Image']].map((keys) => read(row, ...keys)).filter(Boolean);
    images.forEach((image) => checkImage(image, issues));

    if (issues.length) { errors.push({ row: rowNumber, name, reason: issues.join('; ') }); continue; }

    const key = `${name.toLowerCase().replace(/\s+/g, ' ')}|${category._id}|${subCategory?._id || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      rowNumber, name, category, subCategory, images, fields: fieldColumns(row),
      brand: read(row, 'Brand'), description: read(row, 'Product Description', 'Description'),
      specText: read(row, 'Specifications'), tags: read(row, 'Search Tags', 'Tags'),
      variant: {
        name: read(row, 'Variant Name') || (rawPack ? `${packSize} ${unit}` : ''),
        price, mrp, stock, unit,
        ...(rawPack && (unit === 'g' || unit === 'kg') ? { weight: unit === 'kg' ? packSize * 1000 : packSize } : {}),
      },
    });
  }

  // 2. Each group of rows is one product.
  for (const group of groups.values()) {
    const first = group[0];
    const rowNumbers = group.map((g) => g.rowNumber);
    const issues = [];
    if (group.length > MAX_VARIANTS) issues.push(`A product can have at most ${MAX_VARIANTS} variants`);

    // Product-level columns come from the first row; later rows may repeat them or leave them empty.
    for (const [prop, label] of [['brand', 'Brand'], ['description', 'Product Description'], ['specText', 'Specifications'], ['tags', 'Search Tags']]) {
      const other = group.find((g) => g[prop] && first[prop] && !sameText(g[prop], first[prop]));
      if (other) issues.push(`${label} differs between row ${first.rowNumber} and row ${other.rowNumber} for the same product — fill it on the first row only`);
      else if (!first[prop]) {
        const later = group.find((g) => g[prop]);
        if (later) first[prop] = later[prop];
      }
    }

    if (!first.images.length) issues.push(`Add at least one image (Primary Image) on row ${first.rowNumber}`);

    if (group.length > 1) {
      const seen = new Map();
      for (const g of group) {
        if (!g.variant.name) { issues.push(`Row ${g.rowNumber}: Variant Name (or Pack Size) is required when a product has several rows`); continue; }
        const k = g.variant.name.toLowerCase();
        if (seen.has(k)) issues.push(`Rows ${seen.get(k)} and ${g.rowNumber} have the same Variant Name '${g.variant.name}' — each variant needs its own name`);
        else seen.set(k, g.rowNumber);
      }
    }

    // Category Fields, checked exactly like the Add Product form.
    const fields = await getFields(first.category._id, first.subCategory?._id);
    const specsInput = {};
    const leftoverSpecs = [];
    for (const f of fields.filter((x) => !x.isVariant)) {
      const values = group.map((g) => g.fields[f.code]).filter((v) => str(v));
      const firstValue = values[0];
      if (values.some((v) => !sameText(str(v), str(firstValue)))) issues.push(`${f.label} differs between rows of the same product — fill it on the first row only`);
      if (str(firstValue)) specsInput[f.code] = sheetValue(f, firstValue);
    }
    // "Specifications" text: pairs whose name matches a category field fill it; the rest go in the description.
    for (const [k, v] of parseSpecificationText(first.specText)) {
      const field = fields.find((f) => !f.isVariant && sameText(f.label, k));
      if (field && v && specsInput[field.code] === undefined) specsInput[field.code] = sheetValue(field, v);
      else if (!field) leftoverSpecs.push(v ? `${k}: ${v}` : k);
    }
    // Admin defaults fill blanks, as the form pre-fills them.
    for (const f of fields) {
      if (f.isVariant || specsInput[f.code] !== undefined) continue;
      if (f.defaultValue !== null && f.defaultValue !== undefined && f.defaultValue !== '') specsInput[f.code] = f.defaultValue;
    }

    const variants = group.map((g) => {
      const options = {};
      for (const f of fields.filter((x) => x.isVariant)) {
        const raw = g.fields[f.code];
        if (str(raw)) options[f.code] = sheetValue(f, raw);
        else if (f.defaultValue !== null && f.defaultValue !== undefined && f.defaultValue !== '') options[f.code] = f.defaultValue;
      }
      return { ...g.variant, name: g.variant.name || 'Default', options };
    });
    // "[code]" columns that are not fields of this category are ignored (the template lists every storefront field).
    const attributeResult = fields.length
      ? validateProductAttributes(fields, specsInput, variants, { enforceRequired: true })
      : { specs: [], variantOptions: variants.map(() => []), errors: [] };
    issues.push(...attributeResult.errors);

    if (issues.length) { errors.push({ row: rowNumbers[0], rows: rowNumbers, name: first.name, reason: issues.join('; ') }); continue; }

    const description = [first.description || first.name, leftoverSpecs.length ? `Specifications:\n${leftoverSpecs.join('\n')}` : '']
      .filter(Boolean).join('\n\n');
    products.push({
      row: rowNumbers[0],
      rows: rowNumbers,
      images: first.images,
      // Photos on later rows belong to that variant (e.g. each colour); the first row's are the product's.
      variantImages: group.map((g, i) => (i === 0 ? [] : g.images)),
      data: {
        name: first.name,
        category: first.category._id,
        subCategory: first.subCategory?._id,
        brandName: specBrandName(fields, attributeResult.specs) || first.brand || undefined,
        description,
        tags: first.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        ...(attributeResult.specs.length ? { specs: attributeResult.specs } : {}),
        variants: variants.map(({ options: _raw, ...v }, i) => ({
          ...v,
          ...(attributeResult.variantOptions[i]?.length ? { options: attributeResult.variantOptions[i] } : {}),
        })),
      },
    });
  }

  errors.sort((a, b) => a.row - b.row);
  return { products, errors };
}
