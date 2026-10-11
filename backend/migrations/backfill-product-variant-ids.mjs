import mongoose from 'mongoose';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Pure planner used by tests and the maintenance script. Never changes stock. */
export const planVariantIdBackfill = (products) => {
  const seen = new Map();
  const plan = [];
  const issues = [];
  const discrepancies = [];
  for (const product of products) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    let sum = 0;
    variants.forEach((variant, index) => {
      sum += Number(variant.stock || 0);
      let id = variant._id;
      if (id && !mongoose.isValidObjectId(id)) issues.push({ productId: String(product._id), index, reason: 'invalid_variant_id' });
      if (id) {
        const normalized = String(id);
        if (seen.has(normalized)) issues.push({ productId: String(product._id), index, reason: 'duplicate_variant_id', other: seen.get(normalized) });
        else seen.set(normalized, { productId: String(product._id), index });
      } else {
        id = new mongoose.Types.ObjectId();
        plan.push({ productId: product._id, index, variantId: id, expected: {
          name: variant.name, sku: variant.sku, price: variant.price,
          mrp: variant.mrp, stock: variant.stock,
        } });
      }
    });
    if (variants.length && Number(product.stock) !== sum) {
      discrepancies.push({ productId: String(product._id), rootStock: Number(product.stock), variantStockSum: sum });
    }
  }
  return { plan, issues, discrepancies };
};

const apply = process.argv.includes('--apply');
const syncProjection = process.argv.includes('--sync-stock-projection');
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!apply) throw new Error('This migration is intentionally not run by default. Use --apply only in an approved maintenance window.');
  const uri = process.env.BULKIMART_MIGRATION_URI;
  if (!uri) throw new Error('BULKIMART_MIGRATION_URI is required; URI will not be printed.');
  const parsed = new URL(uri);
  if (parsed.hostname !== 'cluster0.q39nutg.mongodb.net' || parsed.pathname.replace(/^\//, '').split('/')[0] !== 'bulkimart') {
    throw new Error('Refusing migration: connection must select the verified Bulkimart target cluster/database.');
  }
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const db = mongoose.connection.db;
    if (db.databaseName !== 'bulkimart' || mongoose.connection.host !== 'cluster0.q39nutg.mongodb.net') {
      throw new Error('Refusing migration: connected database identity did not match the approved target.');
    }
    const rows = await db.collection('products').find({}, { projection: { variants: 1, stock: 1 } }).toArray();
    const result = planVariantIdBackfill(rows);
    console.log(JSON.stringify({ productsScanned: rows.length, idsToAdd: result.plan.length, issues: result.issues, stockDiscrepancies: result.discrepancies }));
    if (result.issues.length) throw new Error('Migration stopped: invalid or duplicate IDs require manual review.');
    if (result.discrepancies.length && !syncProjection) {
      throw new Error('Migration stopped: root/variant stock discrepancies require explicit review; no stock will be changed. Re-run only with --sync-stock-projection after approving the report.');
    }
    for (const item of result.plan) {
      const filter = { _id: item.productId, [`variants.${item.index}._id`]: { $exists: false } };
      for (const [field, value] of Object.entries(item.expected)) {
        filter[`variants.${item.index}.${field}`] = value === undefined ? { $exists: false } : value;
      }
      const write = await db.collection('products').updateOne(
        filter,
        { $set: { [`variants.${item.index}._id`]: item.variantId } }
      );
      if (write.modifiedCount !== 1) throw new Error(`Variant changed during backfill for product ${String(item.productId)} at index ${item.index}; stop and re-audit.`);
    }
    if (syncProjection) {
      for (const discrepancy of result.discrepancies) {
        const write = await db.collection('products').updateOne(
          {
            _id: new mongoose.Types.ObjectId(discrepancy.productId),
            stock: discrepancy.rootStock,
            $expr: { $eq: [{ $sum: '$variants.stock' }, discrepancy.variantStockSum] },
          },
          { $set: { stock: discrepancy.variantStockSum } }
        );
        if (write.modifiedCount !== 1) throw new Error(`Stock changed during projection reconciliation for product ${discrepancy.productId}; stop and re-audit.`);
      }
    }
    console.log(JSON.stringify({ identifiersAdded: result.plan.length, projectionsReconciled: syncProjection ? result.discrepancies.length : 0 }));
  } finally {
    await mongoose.disconnect();
  }
}
