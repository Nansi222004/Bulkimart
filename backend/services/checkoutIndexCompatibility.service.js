// These optional historical identifiers are absent from the current canonical
// writes. Enforce uniqueness of every PRESENT identifier, without indexing a
// missing field as a single shared null value. No application startup invokes
// this maintenance operation.
export const LEGACY_CHECKOUT_INDEXES = [
  { collection: 'payments', field: 'gatewayOrderId', oldName: 'gatewayOrderId_1', name: 'legacy_gateway_order_id_unique_present' },
  { collection: 'orders', field: 'orderId', oldName: 'orderId_1', name: 'legacy_order_id_unique_present' },
];

export async function reconcileCheckoutIndexes(db, { apply = false } = {}) {
  const report = [];
  for (const spec of LEGACY_CHECKOUT_INDEXES) {
    const collection = db.collection(spec.collection);
    const indexes = await collection.indexes();
    const old = indexes.find(index => index.name === spec.oldName);
    const replacement = indexes.find(index => index.name === spec.name);
    if (old && (JSON.stringify(old.key) !== JSON.stringify({ [spec.field]: 1 }) || !old.unique || old.sparse || old.partialFilterExpression)) {
      throw new Error('Unexpected legacy checkout index definition; manual review required.');
    }
    const matches = index => index?.unique === true
      && JSON.stringify(index.key) === JSON.stringify({ [spec.field]: 1 })
      && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ [spec.field]: { $exists: true } });
    if (replacement && !matches(replacement)) throw new Error('Unexpected replacement checkout index definition; manual review required.');
    report.push({ collection: spec.collection, legacyIndex: spec.oldName, replacementIndex: spec.name, legacyPresent: Boolean(old), replacementVerified: Boolean(replacement), applied: Boolean(apply && old) });
    if (!apply || !old) continue;
    // Establish and verify replacement uniqueness BEFORE retiring the obsolete
    // full-field constraint. Actual IDs (including explicit null) stay unique.
    await collection.createIndex({ [spec.field]: 1 }, { name: spec.name, unique: true, partialFilterExpression: { [spec.field]: { $exists: true } } });
    const verified = (await collection.indexes()).find(index => index.name === spec.name);
    if (!matches(verified)) throw new Error('Replacement uniqueness was not verified; old index retained.');
    await collection.dropIndex(spec.oldName);
    report[report.length - 1].replacementVerified = true;
  }
  return report;
}
