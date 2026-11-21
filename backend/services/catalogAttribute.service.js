import mongoose from 'mongoose';
import Category from '../models/Category.js';
import CatalogAttribute, { OPTION_FIELD_TYPES } from '../models/CatalogAttribute.js';
import CategoryAttribute from '../models/CategoryAttribute.js';
import { httpError } from '../utils/response.js';

/**
 * Dynamic category attributes: the fields a category asks for, and validation of the values a seller
 * submits. Used by the seller form endpoint, product create/update, product detail and customer filters,
 * so all of them follow the same Admin configuration.
 */

const MAX_DEPTH = 8;
const isId = (v) => mongoose.isValidObjectId(v);

/** Root → leaf category ids for the product's category (and subcategory, when it belongs under it). */
export async function categoryChain(categoryId, subCategoryId) {
  const leafId = subCategoryId && isId(subCategoryId) ? subCategoryId : categoryId;
  if (!isId(leafId)) return [];
  const chain = [];
  const seen = new Set();
  let current = await Category.findById(leafId).select('_id parent').lean();
  while (current && chain.length < MAX_DEPTH && !seen.has(String(current._id))) {
    seen.add(String(current._id));
    chain.unshift(String(current._id));
    current = current.parent ? await Category.findById(current.parent).select('_id parent').lean() : null;
  }
  // A subcategory from another branch is ignored rather than mixing two category trees' fields.
  if (subCategoryId && categoryId && String(subCategoryId) !== String(categoryId) && !chain.includes(String(categoryId))) {
    return categoryChain(categoryId);
  }
  return chain;
}

const optionList = (attribute, mapping) => {
  const allowed = Array.isArray(mapping.allowedOptions) && mapping.allowedOptions.length ? new Set(mapping.allowedOptions) : null;
  return (attribute.options || [])
    .filter((o) => o.isActive !== false && (!allowed || allowed.has(o.value)))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((o) => ({ value: o.value, label: o.label }));
};

/**
 * The fields for a category/subcategory, parent mappings first, overridden by the child's own mapping for
 * the same attribute. Archived attributes and switched-off mappings are left out.
 */
export async function resolveCategoryFields(categoryId, subCategoryId) {
  const chain = await categoryChain(categoryId, subCategoryId);
  if (!chain.length) return [];
  const mappings = await CategoryAttribute.find({ category: { $in: chain } }).lean();
  const depth = new Map(chain.map((id, i) => [id, i]));
  mappings.sort((a, b) => depth.get(String(a.category)) - depth.get(String(b.category)));
  const byAttribute = new Map();
  for (const m of mappings) {
    if (m.isActive === false) byAttribute.delete(String(m.attribute));
    else byAttribute.set(String(m.attribute), { ...m, inherited: String(m.category) !== chain[chain.length - 1] });
  }
  if (!byAttribute.size) return [];
  const attributes = await CatalogAttribute.find({ _id: { $in: [...byAttribute.keys()] }, isActive: true }).lean();
  const fields = attributes.map((a) => {
    const m = byAttribute.get(String(a._id));
    return {
      attributeId: String(a._id), code: a.code, label: a.label, fieldType: a.fieldType,
      helpText: a.helpText || '', placeholder: a.placeholder || '', unit: a.unit || '',
      options: OPTION_FIELD_TYPES.includes(a.fieldType) ? optionList(a, m) : [],
      validation: a.validation || null,
      required: Boolean(m.required), isVariant: Boolean(m.isVariant), isFilter: Boolean(m.isFilter),
      showOnDetail: m.showOnDetail !== false, group: m.group || 'Product details', sortOrder: m.sortOrder || 0,
      defaultValue: m.defaultValue ?? null, inherited: m.inherited,
    };
  });
  return fields.sort((x, y) => x.group.localeCompare(y.group) || x.sortOrder - y.sortOrder || x.label.localeCompare(y.label));
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** One field's value → the stored value, or { error }. */
export function normalizeFieldValue(field, raw) {
  const v = field.validation || {};
  const label = field.label;
  switch (field.fieldType) {
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `${label} must be text` };
      const text = String(raw).trim();
      const max = v.maxLength || (field.fieldType === 'text' ? 200 : 5000);
      if (text.length > max) return { error: `${label} can be at most ${max} characters` };
      if (v.pattern) {
        let re; try { re = new RegExp(v.pattern); } catch { re = null; }
        if (re && !re.test(text)) return { error: v.patternMessage || `${label} is not in the expected format` };
      }
      return { value: text };
    }
    case 'number':
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: `${label} must be a number` };
      if (field.fieldType === 'number' && !Number.isInteger(n)) return { error: `${label} must be a whole number` };
      if (Number.isFinite(v.min) && n < v.min) return { error: `${label} must be at least ${v.min}` };
      if (Number.isFinite(v.max) && n > v.max) return { error: `${label} must be at most ${v.max}` };
      return { value: field.fieldType === 'decimal' ? Math.round(n * 1000) / 1000 : n };
    }
    case 'select': {
      const value = String(raw).trim();
      if (!field.options.some((o) => o.value === value)) return { error: `Choose a valid ${label}` };
      return { value };
    }
    case 'multiselect': {
      const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map((x) => String(x).trim()).filter(Boolean);
      const allowed = new Set(field.options.map((o) => o.value));
      if (list.some((x) => !allowed.has(x))) return { error: `Choose valid options for ${label}` };
      return { value: [...new Set(list)] };
    }
    case 'date': {
      const text = String(raw).trim();
      // Round-trip check: JavaScript would silently turn 2027-02-30 into 2 March.
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
      if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return { error: `${label} must be a real date (YYYY-MM-DD)` };
      return { value: text };
    }
    case 'boolean': {
      if (raw === true || raw === 'true' || raw === 'yes' || raw === 1) return { value: true };
      if (raw === false || raw === 'false' || raw === 'no' || raw === 0) return { value: false };
      return { error: `${label} must be Yes or No` };
    }
    case 'image':
    case 'file': {
      // The file is uploaded first through the media upload; the form submits its reference.
      const ref = String(raw).trim();
      if (ref.length > 600 || !(/^https:\/\//i.test(ref) || /^media:[a-f0-9]{24}$/i.test(ref) || ref.startsWith('/uploads/'))) return { error: `${label} must be an uploaded file` };
      return { value: ref };
    }
    default:
      return { error: `${label} has an unsupported field type` };
  }
}

const parseObject = (input, what) => {
  if (input === undefined || input === null || input === '') return {};
  let obj = input;
  if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { throw httpError(400, `${what} must be valid JSON`); } }
  if (typeof obj !== 'object' || Array.isArray(obj)) throw httpError(400, `${what} must be an object of field codes and values`);
  return obj;
};

/**
 * Checks a product's attribute values against its category's fields.
 *  - `specsInput`: { code: value } for product-level fields.
 *  - `variants`: each may carry `options: { code: value }` for variant-defining fields.
 * Returns { specs, variantOptions, errors }. Unknown codes are ignored; missing required fields and invalid
 * values are reported by label so the seller sees exactly what to fix.
 */
export function validateProductAttributes(fields, specsInput, variants = [], { enforceRequired = true } = {}) {
  const errors = [];
  const specsObj = parseObject(specsInput, 'Product details');
  const specs = [];
  const productFields = fields.filter((f) => !f.isVariant);
  const variantFields = fields.filter((f) => f.isVariant);

  for (const f of productFields) {
    const raw = specsObj[f.code];
    if (blank(raw)) { if (f.required && enforceRequired) errors.push(`${f.label} is required`); continue; }
    const r = normalizeFieldValue(f, raw);
    if (r.error) errors.push(r.error);
    else specs.push({ attribute: f.attributeId, code: f.code, label: f.label, value: r.value, unit: f.unit || undefined });
  }

  const variantOptions = [];
  const combos = new Set();
  (variants || []).forEach((variant, i) => {
    const name = variant?.name ? `“${variant.name}”` : `Variant ${i + 1}`;
    const optsObj = (() => { try { return parseObject(variant?.options, `${name} options`); } catch (e) { errors.push(e.message); return {}; } })();
    const options = [];
    for (const f of variantFields) {
      const raw = optsObj[f.code];
      if (blank(raw)) { if (f.required && enforceRequired) errors.push(`${name}: ${f.label} is required`); continue; }
      const r = normalizeFieldValue(f, raw);
      if (r.error) errors.push(`${name}: ${r.error}`);
      else options.push({ attribute: f.attributeId, code: f.code, label: f.label, value: r.value });
    }
    if (variantFields.length && options.length) {
      const key = options.map((o) => `${o.code}=${JSON.stringify(o.value)}`).sort().join('|');
      if (combos.has(key)) errors.push(`${name} repeats another variant's ${variantFields.map((f) => f.label).join(' / ')}`);
      combos.add(key);
    }
    variantOptions.push(options);
  });
  return { specs, variantOptions, errors };
}

/** Throws a 400 listing every problem, or returns the clean values. */
export async function checkProductAttributes({ category, subCategory, specs, variants, enforceRequired = true }) {
  const fields = await resolveCategoryFields(category, subCategory);
  if (!fields.length) return { fields, specs: [], variantOptions: (variants || []).map(() => []) };
  const result = validateProductAttributes(fields, specs, variants, { enforceRequired });
  if (result.errors.length) {
    throw httpError(400, `Please fix the product details: ${result.errors.slice(0, 8).join('; ')}${result.errors.length > 8 ? ` (and ${result.errors.length - 8} more)` : ''}`, { code: 'PRODUCT_ATTRIBUTES_INVALID', errors: result.errors });
  }
  return { fields, ...result };
}

/**
 * The brand chosen in the category's "brand" field (Admin-managed list), as the display name kept in
 * product.brandName so search, cards and invoices keep working. '' when the category has no brand field.
 */
export function specBrandName(fields = [], specs = []) {
  const spec = (specs || []).find((s) => s.code === 'brand');
  if (!spec || spec.value === undefined || spec.value === null || spec.value === '') return '';
  const field = fields.find((f) => f.code === 'brand');
  const option = field?.options?.find((o) => o.value === spec.value);
  return String(option?.label || spec.value).slice(0, 120);
}

/** True when the category or any parent has "Require admin approval" switched on. */
export async function categoryRequiresApproval(categoryId, subCategoryId) {
  const chain = await categoryChain(categoryId, subCategoryId);
  if (!chain.length) return false;
  return Boolean(await Category.exists({ _id: { $in: chain }, requireProductApproval: true }));
}

/** Customer filters for a category: the mapped filter fields with the option values in use. */
export async function categoryFilters(categoryId, subCategoryId) {
  const fields = (await resolveCategoryFields(categoryId, subCategoryId)).filter((f) => f.isFilter);
  return fields.map((f) => ({ code: f.code, label: f.label, fieldType: f.fieldType, unit: f.unit, isVariant: f.isVariant, options: f.options }));
}

/**
 * Mongo conditions for `attr.<code>=value` filters (comma = any of). Product-level values live in
 * `specs`, variant-defining ones in `variants.options`, so both are matched.
 */
export function attributeFilterConditions(query = {}) {
  const and = [];
  for (const [key, raw] of Object.entries(query)) {
    const m = /^attr\.([a-z][a-z0-9_]{1,49})$/.exec(key);
    if (!m || raw === undefined || raw === '') continue;
    const values = String(raw).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    if (!values.length) continue;
    const typed = values.flatMap((v) => (v === 'true' ? [true, 'true'] : v === 'false' ? [false, 'false'] : Number.isFinite(Number(v)) ? [v, Number(v)] : [v]));
    and.push({ $or: [
      { specs: { $elemMatch: { code: m[1], value: { $in: typed } } } },
      { 'variants.options': { $elemMatch: { code: m[1], value: { $in: typed } } } },
    ] });
  }
  return and;
}

/**
 * HSN, barcode / GTIN, country of origin and dispatch time (PDF §4). Each is optional; an empty value
 * clears it on update. Returns only the keys that were sent.
 */
export function parseCommonListingDetails(body = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('hsnCode')) {
    const v = String(body.hsnCode ?? '').trim();
    if (v && !/^\d{4,8}$/.test(v)) throw httpError(400, 'HSN code must be 4 to 8 digits');
    out.hsnCode = v || undefined;
  }
  if (has('barcode')) {
    const v = String(body.barcode ?? '').trim();
    if (v && !/^\d{8,14}$/.test(v)) throw httpError(400, 'Barcode (GTIN / EAN / UPC) must be 8 to 14 digits');
    out.barcode = v || undefined;
  }
  if (has('countryOfOrigin')) {
    const v = String(body.countryOfOrigin ?? '').trim();
    if (v.length > 60) throw httpError(400, 'Country of origin is too long');
    out.countryOfOrigin = v || undefined;
  }
  if (has('dispatchDays')) {
    const raw = body.dispatchDays;
    if (raw === '' || raw === null || raw === undefined) out.dispatchDays = undefined;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 30) throw httpError(400, 'Dispatch time must be 0 to 30 days');
      out.dispatchDays = n;
    }
  }
  return out;
}

/** Variant photos: at most 5 uploaded image references per variant; anything else is dropped. */
export const cleanVariantImages = (images) => {
  if (!Array.isArray(images)) return undefined;
  const list = images.map((x) => String(x || '').trim()).filter((x) => /^https:\/\//i.test(x) || x.startsWith('/uploads/') || /^media:[a-f0-9]{24}$/i.test(x)).slice(0, 5);
  return list.length ? list : undefined;
};

/** Replaces each variant's raw `options` / `images` with the checked values. */
export const applyVariantAttributes = (variants, variantOptions) => variants.map((v, i) => {
  const { options: _raw, images, ...rest } = v;
  const options = variantOptions?.[i] || [];
  const cleanImages = cleanVariantImages(images);
  return { ...rest, ...(options.length ? { options } : {}), ...(cleanImages ? { images: cleanImages } : {}) };
});

/**
 * The product page's specification table: the product's details and its variants' options, with option labels
 * (not stored values), in the category's configured order and groups, leaving out fields Admin hid from the
 * product page. Values of fields no longer configured for the category are still shown (they were valid).
 */
export async function displaySpecifications(product) {
  const specs = product?.specs || [];
  const variantValues = new Map();
  for (const v of product?.variants || []) for (const o of v.options || []) {
    if (!variantValues.has(o.code)) variantValues.set(o.code, { code: o.code, label: o.label, values: new Set() });
    variantValues.get(o.code).values.add(String(o.value));
  }
  if (!specs.length && !variantValues.size) return [];
  const fields = await resolveCategoryFields(product.category?._id || product.category, product.subCategory?._id || product.subCategory).catch(() => []);
  const byCode = new Map(fields.map((f, i) => [f.code, { ...f, order: i }]));
  const optionLabel = (f, value) => f?.options?.find((o) => o.value === String(value))?.label || String(value);
  const show = (value, f, unit) => {
    if (Array.isArray(value)) return value.map((x) => optionLabel(f, x)).join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    const text = f && ['select'].includes(f.fieldType) ? optionLabel(f, value) : String(value);
    return unit ? `${text} ${unit}` : text;
  };
  const rows = [];
  for (const s of specs) {
    const f = byCode.get(s.code);
    if (f && f.showOnDetail === false) continue;
    if (f && ['image', 'file'].includes(f.fieldType)) continue; // documents are not printed in the table
    rows.push({ code: s.code, label: f?.label || s.label, value: show(s.value, f, f?.unit ?? s.unit), group: f?.group || 'Product details', order: f?.order ?? 999 });
  }
  for (const v of variantValues.values()) {
    const f = byCode.get(v.code);
    if (f && f.showOnDetail === false) continue;
    rows.push({ code: v.code, label: `Available ${(f?.label || v.label).toLowerCase()}`, value: [...v.values].map((x) => show(x, f, f?.unit)).join(', '), group: 'Variants', order: (f?.order ?? 999) + 1000 });
  }
  return rows.sort((a, b) => a.order - b.order).map(({ order: _o, ...row }) => row);
}
