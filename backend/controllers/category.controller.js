import Category from '../models/Category.js';
import { CHANNEL } from '../constants/enums.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';


/**
 * Build a unique slug from the FULL PATH, not just the leaf name.
 * "Rice" can legitimately exist under both Cooking Essentials and Fresh, but
 * Category.slug is a unique index — deriving from the name alone made the second
 * one fail with a raw E11000 error. A numeric suffix breaks any remaining tie.
 */
const slugify = (str) =>
  String(str).toLowerCase().trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildUniqueSlug = async (name, parentId, ignoreId = null, channel = null) => {
  let base = slugify(name);

  if (parentId) {
    // Children inherit the parent's slug, which already carries the channel.
    const parent = await Category.findById(parentId, 'slug');
    if (parent?.slug) base = `${parent.slug}--${base}`;
  } else if (channel) {
    // Level 1 must carry the channel, otherwise a Quick category reusing a
    // Shop All name would collide with it — the same name legitimately exists
    // in both sections (e.g. "Personal Care").
    base = `${channel}--${base}`;
  }

  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await Category.exists({ slug, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
};

// @desc    Get all active categories
// @route   GET /api/categories
// @access  Public
export const getCategories = asyncHandler(async (req, res) => {
  const { type, parent, isPopular, showOnHome, showInNav } = req.query;
  const filter = { isActive: true, type: { $in: [CHANNEL.GROCERY, CHANNEL.ECOM] } };

  if (type) {
    if (![CHANNEL.GROCERY, CHANNEL.ECOM].includes(type)) return res.status(200).json([]);
    filter.type = type;
  }
  if (parent !== undefined) {
    filter.parent = parent === 'null' ? null : parent;
  }
  if (isPopular !== undefined) {
    filter.isPopular = isPopular === 'true';
  }
  if (showOnHome !== undefined) {
    filter.showOnHome = showOnHome === 'true';
  }
  if (showInNav !== undefined) {
    filter.showInNav = showInNav === 'true';
  }

  const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 });
  res.status(200).json(categories);
});

// @desc    Get category tree hierarchy (parent-child nested)
// @route   GET /api/categories/tree
// @access  Public
export const getCategoryTree = asyncHandler(async (req, res) => {
  const { type } = req.query;
  const filter = { isActive: true, type: { $in: [CHANNEL.GROCERY, CHANNEL.ECOM] } };
  if (type) {
    if (![CHANNEL.GROCERY, CHANNEL.ECOM].includes(type)) return res.status(200).json([]);
    filter.type = type;
  }

  const all = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();

  // Index children by parent id so the tree is built in one pass instead of
  // re-scanning the array at every level.
  const byParent = new Map();
  for (const cat of all) {
    const key = cat.parent ? String(cat.parent) : 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(cat);
  }

  // Level 1 (header) → Level 2 (main) → Level 3 (sub)
  const build = (parentKey, level) =>
    (byParent.get(parentKey) || []).map((cat) => ({
      ...cat,
      level,
      children: level < 3 ? build(String(cat._id), level + 1) : [],
    }));

  const tree = build('root', 1);

  res.status(200).json(tree);
});

// @desc    Get QCommerce (grocery) categories
// @route   GET /api/categories/grocery
// @access  Public
export const getGroceryCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ type: CHANNEL.GROCERY, isActive: true }).sort({ sortOrder: 1, name: 1 });
  res.status(200).json(categories);
});


// @desc    Leaf categories a vendor may list into, with their full path
// @route   GET /api/categories/selectable?type=ecommerce
// @access  Public
export const getSelectableCategories = asyncHandler(async (req, res) => {
  const { type } = req.query;
  if (!type || ![CHANNEL.GROCERY, CHANNEL.ECOM].includes(type)) {
    res.status(400);
    throw new Error('A supported channel type is required (ecommerce | grocery)');
  }

  const all = await Category.find({ type, isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  const byId = new Map(all.map((c) => [String(c._id), c]));
  const parentIds = new Set(all.filter((c) => c.parent).map((c) => String(c.parent)));

  // Only leaves are selectable: a product listed against a header category
  // cannot be browsed or filtered properly.
  const leaves = all.filter((c) => !parentIds.has(String(c._id)));

  const pathOf = (cat) => {
    const parts = [cat.name];
    let cur = cat;
    // depth guard — a corrupt parent chain must never spin forever
    for (let i = 0; i < 5 && cur.parent; i += 1) {
      cur = byId.get(String(cur.parent));
      if (!cur) break;
      parts.unshift(cur.name);
    }
    return parts;
  };

  const data = leaves.map((c) => {
    const parts = pathOf(c);
    return {
      _id: c._id,
      name: c.name,
      slug: c.slug,
      type: c.type,
      path: parts.join(' › '),
      depth: parts.length,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  res.status(200).json({ success: true, data, message: '', meta: { total: data.length } });
});

// @desc    Get single category by id
// @route   GET /api/categories/:id
// @access  Public
export const getCategoryById = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category || !category.isActive || category.type === 'shg') {
    res.status(404);
    throw new Error('Category not found');
  }

  res.status(200).json(category);
});

// @desc    Category counts per section, split by level — drives the section badges
// @route   GET /api/categories/stats
// @access  Public
export const getCategoryStats = asyncHandler(async (req, res) => {
  const all = await Category.find({ isActive: true, type: { $in: [CHANNEL.GROCERY, CHANNEL.ECOM] } }, 'type parent').lean();

  const parentIds = new Set(all.filter((c) => c.parent).map((c) => String(c.parent)));
  const byId = new Map(all.map((c) => [String(c._id), c]));

  const levelOf = (cat) => {
    let level = 1;
    let cur = cat;
    while (cur.parent && level < 3) {
      cur = byId.get(String(cur.parent));
      if (!cur) break;
      level += 1;
    }
    return level;
  };

  const stats = {};
  for (const channel of [CHANNEL.ECOM, CHANNEL.GROCERY]) stats[channel] = { l1: 0, l2: 0, l3: 0, leaves: 0, total: 0 };

  for (const cat of all) {
    const bucket = stats[cat.type];
    if (!bucket) continue;                       // ignore any legacy channel value
    bucket[`l${levelOf(cat)}`] += 1;
    bucket.total += 1;
    if (!parentIds.has(String(cat._id))) bucket.leaves += 1;   // listable by vendors
  }

  return ok(res, stats, '', { sections: { ecommerce: 'Shop All', grocery: 'Quick' } });
});

/**
 * The header's colour choices, taken from a request.
 *
 * Shared by create and update so the two cannot drift. Only keys that were
 * actually sent are returned: a form that omits a colour must leave the stored
 * one alone rather than blanking it, and an empty string is a deliberate
 * "clear this" that unsets back to the app's own styling.
 */
const readHeaderStyle = (body) => {
  const out = {};
  for (const key of ['backgroundColor', 'textColor', 'activeTabColor']) {
    if (body[key] !== undefined) out[key] = String(body[key]).trim() || undefined;
  }
  return out;
};

// @desc    Create category (Admin only)
// @route   POST /api/categories
// @access  Private/Admin
export const createCategory = asyncHandler(async (req, res) => {
  const { name, type, parent, sortOrder, description } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Category name is required');
  }

  // A child inherits its parent's channel; mixing them would break the tree.
  let parentDoc = null;
  if (parent) {
    parentDoc = await Category.findById(parent);
    if (!parentDoc) {
      res.status(400);
      throw new Error('Parent category not found');
    }
  }

  // A top-level (Level 1) category must state its section explicitly. The UI
  // sends it from the active section, but the server cannot rely on that.
  const channel = parentDoc ? parentDoc.type : type;
  if (!channel) {
    res.status(400);
    throw new Error('Section is required for a header category (ecommerce or grocery)');
  }
  if (![CHANNEL.GROCERY, CHANNEL.ECOM].includes(channel)) {
    res.status(400);
    throw new Error(`Invalid section "${channel}". Expected ecommerce or grocery`);
  }

  const categoryData = {
    ...readHeaderStyle(req.body),
    ...(req.body.showInNav !== undefined
      ? { showInNav: req.body.showInNav === true || req.body.showInNav === 'true' }
      : {}),
    name,
    type: channel,
    parent: parent || null,
    sortOrder: sortOrder || 0,
    description,
    slug: await buildUniqueSlug(name, parent, null, channel),
    isPopular: req.body.isPopular === true || req.body.isPopular === 'true',
    showOnHome: req.body.showOnHome === true || req.body.showOnHome === 'true'
  };

  // Upload image/icon if uploaded
  if (req.files) {
    if (req.files.image) {
      categoryData.image = await uploadToCloudinary(req.files.image[0].buffer, 'categories');
    }
    if (req.files.icon) {
      // Rasterised to PNG: an SVG buffer has no binary image signature, so
      // Cloudinary would file it under /raw/ and serve it as octet-stream,
      // which browsers refuse to render in an <img> tag (see seedRealProducts.js
      // for the same fix applied to generated product images).
      categoryData.icon = await uploadToCloudinary(req.files.icon[0].buffer, 'category-icons', {
        resource_type: 'image',
        format: 'png',
      });
    }
  }

  const category = await Category.create(categoryData);
  res.status(201).json({
    success: true,
    category
  });
});

// @desc    Update category (Admin only)
// @route   PUT /api/categories/:id
// @access  Private/Admin
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  const { name, type, parent, sortOrder, description, isActive } = req.body;

  // Re-parenting must stay inside the same section. Moving a category under a
  // parent in another channel would split the tree and strand its products.
  if (parent !== undefined && String(parent || '') !== String(category.parent || '')) {
    if (parent) {
      const newParent = await Category.findById(parent);
      if (!newParent) {
        res.status(400);
        throw new Error('Parent category not found');
      }
      if (newParent.type !== category.type) {
        res.status(400);
        throw new Error(`Cannot move a ${category.type} category under a ${newParent.type} parent`);
      }
      if (String(newParent._id) === String(category._id)) {
        res.status(400);
        throw new Error('A category cannot be its own parent');
      }
    }
    category.parent = parent || null;
  }

  // The section itself is not editable — changing it would orphan every child
  // and every product already listed under this category.
  if (type && type !== category.type) {
    res.status(400);
    throw new Error('A category cannot be moved between sections. Create it in the other section instead.');
  }

  if (name && name !== category.name) {
    category.name = name;
    category.slug = await buildUniqueSlug(name, category.parent, category._id, category.type);
  }
  if (sortOrder !== undefined) category.sortOrder = sortOrder;
  if (description !== undefined) category.description = description;
  if (isActive !== undefined) category.isActive = isActive;
  if (req.body.isPopular !== undefined) category.isPopular = req.body.isPopular === true || req.body.isPopular === 'true';
  if (req.body.showOnHome !== undefined) category.showOnHome = req.body.showOnHome === true || req.body.showOnHome === 'true';
  for (const [key, value] of Object.entries(readHeaderStyle(req.body))) category[key] = value;
  if (req.body.showInNav !== undefined) {
    category.showInNav = req.body.showInNav === true || req.body.showInNav === 'true';
  }

  if (req.files) {
    if (req.files.image) {
      category.image = await uploadToCloudinary(req.files.image[0].buffer, 'categories');
    }
    if (req.files.icon) {
      category.icon = await uploadToCloudinary(req.files.icon[0].buffer, 'category-icons', {
        resource_type: 'image',
        format: 'png',
      });
    }
  }

  const updatedCategory = await category.save();
  res.status(200).json({
    success: true,
    category: updatedCategory
  });
});

// @desc    Soft delete category (Admin only)
// @route   DELETE /api/categories/:id
// @access  Private/Admin
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error('Category not found');
  }

  if (category.isSystem) {
    res.status(400);
    throw new Error('System-reserved categories cannot be deleted');
  }

  category.isActive = false;
  await category.save();

  res.status(200).json({
    success: true,
    message: 'Category soft-deleted successfully'
  });
});
