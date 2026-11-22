import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import CatalogAttribute, { ATTRIBUTE_FIELD_TYPES, OPTION_FIELD_TYPES } from '../models/CatalogAttribute.js';
import CategoryAttribute from '../models/CategoryAttribute.js';
import CatalogConfigAudit from '../models/CatalogConfigAudit.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import { resolveCategoryFields, categoryFilters, normalizeFieldValue } from '../services/catalogAttribute.service.js';

/**
 * Dynamic category attributes.
 *  Public (seller form + customer filters): GET /api/catalog/fields, GET /api/catalog/filters
 *  Admin (catalog permission):              /api/admin/catalog/…
 */

const isId = (v) => mongoose.isValidObjectId(v);
const audit = (req, action, entityType, entityId, summary, before, after) => CatalogConfigAudit.create({
  actorId: req.user._id, actorName: req.user.name || req.user.email, action, entityType, entityId, summary, before, after,
}).catch(() => { /* an audit write never blocks the change itself */ });

// ---------------------------------------------------------------- public

export const getCategoryFields = asyncHandler(async (req, res) => {
  const { category, subCategory } = req.query;
  if (!isId(category)) throw httpError(400, 'A valid category is required');
  if (subCategory && !isId(subCategory)) throw httpError(400, 'Invalid subcategory');
  const fields = await resolveCategoryFields(category, subCategory);
  return ok(res, { fields }, 'Category fields');
});

export const getCategoryFilterOptions = asyncHandler(async (req, res) => {
  const { category, subCategory } = req.query;
  if (!isId(category)) throw httpError(400, 'A valid category is required');
  return ok(res, { filters: await categoryFilters(category, subCategory) }, 'Category filters');
});

// ---------------------------------------------------------------- admin: attributes

const cleanOptions = (options, fieldType) => {
  if (!OPTION_FIELD_TYPES.includes(fieldType)) return [];
  if (!Array.isArray(options) || !options.length) throw httpError(400, 'Add at least one option for a dropdown or multi-select field');
  if (options.length > 500) throw httpError(400, 'At most 500 options per field');
  const seen = new Set();
  return options.map((o, i) => {
    const label = String((typeof o === 'string' ? o : o?.label) ?? '').trim();
    const value = String((typeof o === 'string' ? o : o?.value ?? label) ?? '').trim();
    if (!label || !value) throw httpError(400, `Option ${i + 1} needs a label`);
    if (label.length > 120 || value.length > 120) throw httpError(400, `Option “${label.slice(0, 30)}” is too long`);
    if (seen.has(value.toLowerCase())) throw httpError(400, `Option “${label}” is listed twice`);
    seen.add(value.toLowerCase());
    return { value, label, isActive: o?.isActive !== false, sortOrder: Number.isFinite(Number(o?.sortOrder)) ? Number(o.sortOrder) : i };
  });
};

const cleanValidation = (v, fieldType) => {
  if (!v || typeof v !== 'object') return undefined;
  const out = {};
  for (const k of ['min', 'max']) if (v[k] !== undefined && v[k] !== '' && v[k] !== null) {
    if (!Number.isFinite(Number(v[k]))) throw httpError(400, `Validation ${k} must be a number`);
    out[k] = Number(v[k]);
  }
  if (Number.isFinite(out.min) && Number.isFinite(out.max) && out.min > out.max) throw httpError(400, 'Minimum cannot be more than maximum');
  if (v.maxLength !== undefined && v.maxLength !== '' && v.maxLength !== null) {
    const n = Number(v.maxLength);
    if (!Number.isInteger(n) || n < 1 || n > 5000) throw httpError(400, 'Maximum length must be 1 to 5000');
    out.maxLength = n;
  }
  if (v.pattern) {
    if (!['text', 'longtext'].includes(fieldType)) throw httpError(400, 'A pattern applies to text fields only');
    try { new RegExp(String(v.pattern)); } catch { throw httpError(400, 'The pattern is not a valid regular expression'); }
    out.pattern = String(v.pattern).slice(0, 200);
    if (v.patternMessage) out.patternMessage = String(v.patternMessage).slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
};

const codeFrom = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 50);

export const listAttributes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.includeArchived !== 'true') filter.isActive = true;
  if (req.query.search) {
    const safe = String(req.query.search).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ label: new RegExp(safe, 'i') }, { code: new RegExp(safe, 'i') }];
  }
  const attributes = await CatalogAttribute.find(filter).sort({ label: 1 }).limit(1000).lean();
  const usage = await CategoryAttribute.aggregate([{ $match: { attribute: { $in: attributes.map((a) => a._id) }, isActive: true } }, { $group: { _id: '$attribute', categories: { $sum: 1 } } }]);
  const used = new Map(usage.map((u) => [String(u._id), u.categories]));
  return ok(res, attributes.map((a) => ({ ...a, mappedCategories: used.get(String(a._id)) || 0 })), 'Attributes');
});

export const createAttribute = asyncHandler(async (req, res) => {
  const { label, fieldType, helpText, placeholder, unit, options, validation } = req.body || {};
  if (!String(label || '').trim()) throw httpError(400, 'Attribute name is required');
  if (!ATTRIBUTE_FIELD_TYPES.includes(fieldType)) throw httpError(400, `Field type must be one of: ${ATTRIBUTE_FIELD_TYPES.join(', ')}`);
  const code = req.body.code ? String(req.body.code).trim().toLowerCase() : codeFrom(label);
  if (!/^[a-z][a-z0-9_]{1,49}$/.test(code)) throw httpError(400, 'Code must start with a letter and use only a–z, 0–9 and _');
  if (await CatalogAttribute.exists({ code })) throw httpError(409, `An attribute with code “${code}” already exists`);
  const attribute = await CatalogAttribute.create({
    code, label: String(label).trim(), fieldType, helpText, placeholder, unit,
    options: cleanOptions(options, fieldType), validation: cleanValidation(validation, fieldType),
    createdBy: req.user._id, updatedBy: req.user._id,
  });
  audit(req, 'attribute.create', 'attribute', attribute._id, `Created ${attribute.label} (${fieldType})`, undefined, attribute.toObject());
  return created(res, attribute, 'Attribute created');
});

export const updateAttribute = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError(400, 'Invalid attribute');
  const attribute = await CatalogAttribute.findById(req.params.id);
  if (!attribute) throw httpError(404, 'Attribute not found');
  const before = attribute.toObject();
  const body = req.body || {};
  if (body.fieldType !== undefined && body.fieldType !== attribute.fieldType) {
    if (!ATTRIBUTE_FIELD_TYPES.includes(body.fieldType)) throw httpError(400, 'Invalid field type');
    // Changing the type would make stored values unreadable; archive and create a new attribute instead.
    const inUse = await Product.exists({ $or: [{ 'specs.attribute': attribute._id }, { 'variants.options.attribute': attribute._id }] });
    if (inUse) throw httpError(409, 'This attribute is already used by products, so its field type cannot change. Archive it and create a new one.');
    attribute.fieldType = body.fieldType;
  }
  if (body.label !== undefined) {
    if (!String(body.label).trim()) throw httpError(400, 'Attribute name is required');
    attribute.label = String(body.label).trim();
  }
  for (const k of ['helpText', 'placeholder', 'unit']) if (body[k] !== undefined) attribute[k] = String(body[k] || '').trim() || undefined;
  if (body.options !== undefined || body.fieldType !== undefined) {
    const next = cleanOptions(body.options ?? attribute.options, attribute.fieldType);
    // An option already chosen on products is switched off, never removed, so old listings keep their label.
    const nextValues = new Set(next.map((o) => o.value));
    for (const old of attribute.options || []) if (!nextValues.has(old.value)) next.push({ value: old.value, label: old.label, isActive: false, sortOrder: old.sortOrder ?? 999 });
    attribute.options = next;
  }
  if (body.validation !== undefined) attribute.validation = cleanValidation(body.validation, attribute.fieldType);
  attribute.updatedBy = req.user._id;
  await attribute.save();
  audit(req, 'attribute.update', 'attribute', attribute._id, `Updated ${attribute.label}`, before, attribute.toObject());
  return ok(res, attribute, 'Attribute updated');
});

// Archive / restore. Products keep their stored values and labels either way.
export const setAttributeStatus = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError(400, 'Invalid attribute');
  const isActive = req.body?.isActive === true || req.body?.isActive === 'true';
  const attribute = await CatalogAttribute.findByIdAndUpdate(req.params.id, { $set: { isActive, updatedBy: req.user._id } }, { returnDocument: 'after' });
  if (!attribute) throw httpError(404, 'Attribute not found');
  audit(req, isActive ? 'attribute.restore' : 'attribute.archive', 'attribute', attribute._id, `${isActive ? 'Restored' : 'Archived'} ${attribute.label}`);
  return ok(res, attribute, isActive ? 'Attribute restored' : 'Attribute archived');
});

// ---------------------------------------------------------------- admin: category mappings

export const getCategoryMappings = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError(400, 'Invalid category');
  const category = await Category.findById(req.params.id).select('name parent type requireProductApproval').lean();
  if (!category) throw httpError(404, 'Category not found');
  const own = await CategoryAttribute.find({ category: category._id }).populate('attribute').sort({ sortOrder: 1 }).lean();
  // What a seller will actually see here: inherited parent fields plus this category's own.
  const effective = await resolveCategoryFields(category._id);
  return ok(res, { category, mappings: own, effective }, 'Category attributes');
});

/**
 * The value pre-filled for sellers on new listings in this category (PDF §2 "default value"). Checked with the
 * same rules as a seller's input, so a default can never be something the seller would then be refused.
 * Files and photos have no default. Returns {} (no default) or { defaultValue }.
 */
const cleanDefault = (attribute, raw, allowedOptions) => {
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length)) return {};
  if (['image', 'file'].includes(attribute.fieldType)) throw httpError(400, `${attribute.label} is an upload field and cannot have a default value`);
  const usable = (attribute.options || []).filter((o) => o.isActive !== false && (!allowedOptions?.length || allowedOptions.includes(o.value)));
  const r = normalizeFieldValue({ ...attribute, options: usable }, raw);
  if (r.error) throw httpError(400, `Default value: ${r.error}`);
  return { defaultValue: r.value };
};

/** "Clothing: added Fabric; Size now required, customer filter; removed Pattern" — what the change log shows. */
const mappingChangeSummary = (categoryName, before, after, byId) => {
  const label = (id) => byId.get(String(id))?.label || 'a field';
  const flags = [['required', 'required'], ['isVariant', 'per variant'], ['isFilter', 'customer filter'], ['showOnDetail', 'on product page']];
  const was = new Map(before.map((m) => [String(m.attribute), m]));
  const now = new Map(after.map((m) => [String(m.attribute), m]));
  const parts = [];
  for (const [id, m] of now) {
    const old = was.get(id);
    if (!old) { parts.push(`added ${label(id)}`); continue; }
    const on = flags.filter(([k]) => Boolean(m[k] ?? k === 'showOnDetail') && !Boolean(old[k] ?? k === 'showOnDetail')).map(([, t]) => t);
    const off = flags.filter(([k]) => !Boolean(m[k] ?? k === 'showOnDetail') && Boolean(old[k] ?? k === 'showOnDetail')).map(([, t]) => t);
    const changes = [...on.map((t) => `now ${t}`), ...off.map((t) => `no longer ${t}`)];
    if (JSON.stringify(old.defaultValue ?? null) !== JSON.stringify(m.defaultValue ?? null)) changes.push(m.defaultValue === undefined ? 'default removed' : `default ${JSON.stringify(m.defaultValue)}`);
    if ((old.group || '') !== (m.group || '')) changes.push(`group "${m.group}"`);
    if (changes.length) parts.push(`${label(id)} ${changes.join(', ')}`);
  }
  for (const [id, m] of was) if (!now.has(id)) parts.push(`removed ${byId.get(id)?.label || m.attribute?.label || 'a field'}`);
  if (!parts.length) parts.push(`order or settings saved (${after.length} field${after.length === 1 ? '' : 's'})`);
  return `${categoryName}: ${parts.join('; ')}`.slice(0, 500);
};

/** Replaces this category's own mappings (inherited ones are edited on the parent). */
export const replaceCategoryMappings = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError(400, 'Invalid category');
  const category = await Category.findById(req.params.id).select('name').lean();
  if (!category) throw httpError(404, 'Category not found');
  const list = req.body?.mappings;
  if (!Array.isArray(list) || list.length > 200) throw httpError(400, 'Send a list of at most 200 mappings');
  const ids = list.map((m) => String(m?.attribute || ''));
  if (ids.some((id) => !isId(id))) throw httpError(400, 'Every mapping needs a valid attribute');
  if (new Set(ids).size !== ids.length) throw httpError(400, 'An attribute is mapped twice');
  const attributes = await CatalogAttribute.find({ _id: { $in: ids } }).select('fieldType options label validation').lean();
  if (attributes.length !== ids.length) throw httpError(400, 'An attribute does not exist');
  const byId = new Map(attributes.map((a) => [String(a._id), a]));
  const docs = list.map((m, i) => {
    const a = byId.get(String(m.attribute));
    const isVariant = m.isVariant === true;
    if (isVariant && !['select', 'text', 'number', 'decimal'].includes(a.fieldType)) throw httpError(400, `${a.label} cannot define variants (use a dropdown, text or number field)`);
    let allowedOptions;
    if (Array.isArray(m.allowedOptions) && m.allowedOptions.length) {
      const valid = new Set((a.options || []).map((o) => o.value));
      allowedOptions = m.allowedOptions.map(String).filter((v) => valid.has(v));
    }
    return {
      category: category._id, attribute: a._id, required: m.required === true, isVariant,
      isFilter: m.isFilter === true, showOnDetail: m.showOnDetail !== false,
      group: String(m.group || 'Product details').trim().slice(0, 60) || 'Product details',
      sortOrder: Number.isFinite(Number(m.sortOrder)) ? Number(m.sortOrder) : i,
      ...(allowedOptions?.length ? { allowedOptions } : {}),
      ...cleanDefault(a, m.defaultValue, allowedOptions),
      isActive: m.isActive !== false, updatedBy: req.user._id,
    };
  });
  const before = await CategoryAttribute.find({ category: category._id }).lean();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await CategoryAttribute.deleteMany({ category: category._id }, { session });
      if (docs.length) await CategoryAttribute.insertMany(docs, { session });
    });
  } finally { await session.endSession(); }
  audit(req, 'mapping.replace', 'mapping', category._id, mappingChangeSummary(category.name, before, docs, byId), before, docs);
  const effective = await resolveCategoryFields(category._id);
  return ok(res, { mappings: await CategoryAttribute.find({ category: category._id }).populate('attribute').sort({ sortOrder: 1 }).lean(), effective }, 'Category attributes saved');
});

export const listCatalogAudit = asyncHandler(async (req, res) => {
  const filter = {};
  if (['attribute', 'category', 'mapping'].includes(req.query.entityType)) filter.entityType = req.query.entityType;
  if (isId(req.query.entityId)) filter.entityId = req.query.entityId;
  const rows = await CatalogConfigAudit.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 100, 300)).select('-before -after').lean();
  return ok(res, rows, 'Catalog changes');
});

/** Category create/update/delete call this so category changes appear in the same log. */
/** Switches "new listings need admin approval" for a category (subcategories inherit it). */
export const setCategoryApproval = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) throw httpError(400, 'Invalid category');
  if (typeof req.body?.requireProductApproval !== 'boolean') throw httpError(400, 'requireProductApproval must be true or false');
  const category = await Category.findById(req.params.id).select('name requireProductApproval');
  if (!category) throw httpError(404, 'Category not found');
  const before = Boolean(category.requireProductApproval);
  category.requireProductApproval = req.body.requireProductApproval;
  await category.save();
  if (before !== category.requireProductApproval) {
    audit(req, 'category.approval', 'category', category._id, `${category.name}: admin approval ${category.requireProductApproval ? 'required' : 'not required'} for new listings`, { requireProductApproval: before }, { requireProductApproval: category.requireProductApproval });
  }
  return ok(res, { _id: category._id, requireProductApproval: category.requireProductApproval }, 'Saved');
});

export const auditCategoryChange = (req, action, category, summary) => audit(req, action, 'category', category._id, summary);

// ---------------------------------------------------------------- seller uploads

/**
 * One file for an image/file category field (size chart, hallmark certificate …) or a variant photo.
 * Images (kind=image) are public product media; documents (kind=file) are private and linked as media:<id>.
 * The returned reference is what the product form submits as the field's value.
 */
export const uploadCatalogFileHandler = asyncHandler(async (req, res) => {
  if (!req.file) throw httpError(400, 'Choose a file to upload');
  const kind = req.body?.kind === 'file' ? 'file' : 'image';
  if (kind === 'image' && req.file.mimetype === 'application/pdf') throw httpError(400, 'This field needs an image, not a PDF');
  const { uploadFileWithMeta } = await import('../services/cloudinary.service.js');
  const { mediaContext } = await import('../services/media.service.js');
  const meta = await uploadFileWithMeta(req.file.buffer, kind === 'image' ? 'products' : 'product-documents', {
    resource_type: req.file.mimetype === 'application/pdf' ? 'raw' : 'image',
    ...mediaContext(req, req.file),
  });
  return created(res, { url: meta.url, kind, fileName: req.file.originalname }, 'Uploaded');
});
