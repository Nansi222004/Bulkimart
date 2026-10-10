import PackagingMaterial from '../models/PackagingMaterial.js';
import { httpError } from '../utils/response.js';

/** Server-authoritative minimum total quantity for a Bulk Packaging Order. */
export const BULK_ORDER_MIN_TOTAL_ITEMS = Number(process.env.PACKAGING_BULK_MIN_ITEMS) || 500;

/**
 * The one place packaging pricing is computed. Never trust a client-supplied
 * unitPrice/lineTotal/subtotal — this resolves every material fresh from the
 * database and rejects anything that would make the total ambiguous
 * (duplicate material, inactive material, non-existent material, a
 * non-integer or non-positive quantity).
 *
 * `rawItems` is `[{ materialId, quantity }]` — quantity as sent by the
 * client, never trusted beyond "how many of this material".
 *
 * Returns `{ items, totalItems, subtotal }` where `items` already carries
 * the name/type/specification/unitPrice/lineTotal snapshot a PackagingOrder
 * line item needs — callers persisting an order can use this array as-is.
 */
export const resolvePackagingItems = async (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw httpError(400, 'At least one packaging material is required');
  }

  const seen = new Set();
  const parsed = rawItems.map((raw) => {
    const materialId = String(raw?.materialId || '');
    const quantity = Number(raw?.quantity);
    if (!materialId) throw httpError(400, 'Each line requires a materialId');
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      throw httpError(400, `Invalid quantity for material ${materialId} — must be a positive whole number`);
    }
    if (seen.has(materialId)) {
      throw httpError(400, 'Duplicate material in the same order — combine quantities into a single line instead');
    }
    seen.add(materialId);
    return { materialId, quantity };
  });

  const materials = await PackagingMaterial.find({ _id: { $in: parsed.map((p) => p.materialId) } });
  const byId = new Map(materials.map((m) => [String(m._id), m]));

  const items = parsed.map(({ materialId, quantity }) => {
    const material = byId.get(materialId);
    if (!material) throw httpError(400, `Packaging material ${materialId} not found`);
    if (!material.isActive) throw httpError(400, `"${material.name}" is no longer available`);

    const unitPriceSnapshot = material.unitPrice;
    const lineTotal = unitPriceSnapshot * quantity;
    return {
      materialId: material._id,
      materialNameSnapshot: material.name,
      materialTypeSnapshot: material.materialType,
      specificationSnapshot: material.specification,
      quantity,
      unitPriceSnapshot,
      lineTotal,
    };
  });

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  return { items, totalItems, subtotal };
};

/**
 * Recomputes a PackagingPackage's live totals from CURRENT material prices
 * — never cached on the package document itself (see PackagingPackage.js's
 * file comment for why). Used for both the admin builder's live preview and
 * the seller-facing package listing/detail.
 *
 * Unlike resolvePackagingItems, an inactive material inside an already-saved
 * package does not throw here — a draft/disabled package may still contain
 * one (nothing wrong with looking at it); the hard rejection only happens at
 * publish time and at actual purchase time (see packaging.controller.js).
 */
export const pricePackage = async (pkg) => {
  const materials = await PackagingMaterial.find({ _id: { $in: pkg.items.map((i) => i.materialId) } });
  const byId = new Map(materials.map((m) => [String(m._id), m]));

  const items = pkg.items.map((i) => {
    const material = byId.get(String(i.materialId));
    return {
      materialId: i.materialId,
      quantity: i.quantity,
      material: material
        ? {
            _id: material._id,
            name: material.name,
            materialType: material.materialType,
            specification: material.specification,
            unitPrice: material.unitPrice,
            image: material.image,
            isActive: material.isActive,
          }
        : null,
      lineTotal: material ? material.unitPrice * i.quantity : 0,
    };
  });

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  return { items, totalItems, subtotal };
};
