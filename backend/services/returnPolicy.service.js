import mongoose from 'mongoose';
import Category from '../models/Category.js';
import CategoryReturnPolicy from '../models/CategoryReturnPolicy.js';
import { httpError } from '../utils/response.js';
import { RETURN_POLICY_MAX_WINDOW_DAYS } from '../constants/enums.js';

/**
 * Category Return Policy — Phase 2 foundation only. Nothing in this file
 * writes to an Order/OrderItem; that snapshot step is Phase 3.
 */

/**
 * Walks a leaf/any Category up to its HEADER (a Category with
 * `parent: null`) — the tree is not guaranteed to be exactly two levels
 * deep, so `product.subCategory` (the immediate parent) cannot be trusted
 * as "the header" on its own.
 *
 * Bounded + cycle-safe: a `visited` set refuses to loop forever on a
 * corrupted `parent` chain, and `maxDepth` refuses to walk indefinitely on
 * a chain that never terminates in `parent: null` at all. Either condition
 * — plus a missing parent doc, or an invalid/nonexistent starting id —
 * resolves to `null`, never a guess.
 *
 * @returns {Promise<import('mongoose').Document|null>} the header Category doc, or null
 */
export const resolveHeaderCategory = async (categoryId, { maxDepth = 20 } = {}) => {
  if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) return null;

  let current = await Category.findById(categoryId);
  if (!current) return null;

  const visited = new Set([String(current._id)]);
  let depth = 0;

  while (current.parent) {
    depth += 1;
    if (depth > maxDepth) return null; // chain too deep / never terminates — refuse rather than guess

    const parentKey = String(current.parent);
    if (visited.has(parentKey)) return null; // cycle detected
    visited.add(parentKey);

    const parent = await Category.findById(current.parent);
    if (!parent) return null; // broken chain — a parent id that doesn't resolve to a real document

    current = parent;
  }

  return current; // parent === null (or absent) => this is the header
};

/**
 * The authoritative return policy for a product's header category, resolved
 * fresh from CategoryReturnPolicy — never cached, since Admin edits must be
 * visible to the very next order (only ALREADY-PLACED orders are frozen,
 * via their own snapshot, not this lookup).
 *
 * A header with no policy document, or one with `isActive: false`, is
 * NON-RETURNABLE — never an inherited/permissive default (Phase 1 decision
 * #4). This is the single function both the future order-creation snapshot
 * (Phase 3) and the admin policy screen (Phase 7) must call, so "missing
 * policy" is decided in exactly one place.
 *
 * @returns {Promise<{ eligible: boolean, returnWindowDays: number, headerCategoryId: string|null, headerCategoryName: string|null }>}
 */
export const resolveReturnPolicyForCategory = async (categoryId) => {
  const header = await resolveHeaderCategory(categoryId);
  if (!header) {
    return { eligible: false, returnWindowDays: 0, headerCategoryId: null, headerCategoryName: null };
  }

  const policy = await CategoryReturnPolicy.findOne({ categoryId: header._id, isActive: true }).lean();
  if (!policy) {
    return { eligible: false, returnWindowDays: 0, headerCategoryId: String(header._id), headerCategoryName: header.name };
  }

  return {
    eligible: policy.returnWindowDays > 0,
    returnWindowDays: policy.returnWindowDays,
    headerCategoryId: String(header._id),
    headerCategoryName: header.name,
  };
};

/* ============================================================================
 * ORDER-ITEM SNAPSHOT (Phase 3) — frozen once, at order creation, onto
 * Order.items[].returnPolicy. Never recomputed afterwards; Admin editing
 * CategoryReturnPolicy must never move an existing order's own deadline.
 * ========================================================================== */

/**
 * The exact shape frozen onto one order item. Reuses `resolveHeaderCategory`
 * (the traversal is not duplicated) but — unlike
 * `resolveReturnPolicyForCategory` above, whose contract collapses "no
 * policy" and "explicit 0 days" into the same `returnWindowDays: 0` since
 * both simply mean "not eligible right now" — the snapshot must tell the
 * two apart: `returnWindowDays: null` means nothing was ever configured for
 * this header, while `0` means an admin explicitly chose "no returns" for
 * it. Both snapshot as `returnEligible: false`; only the `returnWindowDays`
 * value differs.
 */
export const buildReturnPolicySnapshot = async (categoryId) => {
  const header = await resolveHeaderCategory(categoryId);
  if (!header) {
    return { headerCategoryId: null, headerCategoryName: null, returnEligible: false, returnWindowDays: null };
  }

  const policy = await CategoryReturnPolicy.findOne({ categoryId: header._id, isActive: true }).lean();
  if (!policy) {
    return { headerCategoryId: header._id, headerCategoryName: header.name, returnEligible: false, returnWindowDays: null };
  }

  return {
    headerCategoryId: header._id,
    headerCategoryName: header.name,
    returnEligible: policy.returnWindowDays > 0,
    returnWindowDays: policy.returnWindowDays,
  };
};

/**
 * Batched form for an order with several lines: resolves each DISTINCT
 * category id exactly once, however many order lines share it, rather than
 * re-walking the same header chain per line.
 *
 * @returns {Promise<Map<string, Awaited<ReturnType<typeof buildReturnPolicySnapshot>>>>}
 *   keyed by the ORIGINAL (leaf/mid) categoryId string, so a caller can look
 *   up each of its lines directly by the id it already has.
 */
export const buildReturnPolicySnapshotsFor = async (categoryIds) => {
  const unique = [...new Set((categoryIds || []).filter(Boolean).map(String))];
  const entries = await Promise.all(unique.map(async (id) => [id, await buildReturnPolicySnapshot(id)]));
  return new Map(entries);
};

/* ============================================================================
 * ADMIN — configuration (Phase 2: service + API only; UI is Phase 7)
 * ========================================================================== */

/** Every header category, each paired with its policy if one exists (null otherwise). */
export const listReturnPolicies = async () => {
  const headers = await Category.find({ parent: null }).sort({ type: 1, sortOrder: 1, name: 1 }).lean();
  const policies = await CategoryReturnPolicy.find({ categoryId: { $in: headers.map((h) => h._id) } })
    .populate('updatedBy', 'name email')
    .lean();
  const byCategory = new Map(policies.map((p) => [String(p.categoryId), p]));

  return headers.map((h) => ({
    categoryId: h._id,
    categoryName: h.name,
    channel: h.type,
    policy: byCategory.get(String(h._id)) || null,
  }));
};

/**
 * Create or update the one policy document for a header category.
 * Rejects a non-header id outright — a policy attached to a leaf/mid-level
 * category would be unreachable by resolveReturnPolicyForCategory, which
 * only ever looks the header up by its own resolved id.
 */
export const upsertReturnPolicy = async ({ categoryId, returnWindowDays, isActive, adminId }) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) throw httpError(400, 'Invalid category');

  const category = await Category.findById(categoryId);
  if (!category) throw httpError(404, 'Category not found');
  if (category.parent) throw httpError(400, 'A return policy can only be set on a header category (one with no parent)');

  const days = Number(returnWindowDays);
  if (!Number.isInteger(days) || days < 0) {
    throw httpError(400, 'returnWindowDays must be a whole number of 0 or more');
  }
  if (days > RETURN_POLICY_MAX_WINDOW_DAYS) {
    throw httpError(400, `returnWindowDays cannot exceed ${RETURN_POLICY_MAX_WINDOW_DAYS}`);
  }

  const policy = await CategoryReturnPolicy.findOneAndUpdate(
    { categoryId },
    {
      $set: {
        returnWindowDays: days,
        isActive: isActive !== false,
        updatedBy: adminId,
      },
      $setOnInsert: { createdBy: adminId },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );

  return policy;
};
