// Explicit maintenance only. Preserve unique phone values on historical rider
// documents while allowing current delivery-job documents to omit that field.
export async function reconcileDeliveryPhoneIndex(db, { apply = false } = {}) {
  const collection = db.collection('deliveries');
  const indexes = await collection.indexes();
  const old = indexes.find(index => index.name === 'phone_1');
  const name = 'legacy_delivery_phone_unique_present';
  const matches = index => index?.unique === true
    && JSON.stringify(index.key) === JSON.stringify({ phone: 1 })
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ phone: { $exists: true } });
  if (old && (JSON.stringify(old.key) !== JSON.stringify({ phone: 1 }) || !old.unique || old.sparse || old.partialFilterExpression)) throw new Error('Unexpected legacy delivery phone index; review required');
  const existing = indexes.find(index => index.name === name);
  if (existing && !matches(existing)) throw new Error('Unexpected replacement delivery phone index; review required');
  if (apply && old) {
    await collection.createIndex({ phone: 1 }, { name, unique: true, partialFilterExpression: { phone: { $exists: true } } });
    if (!matches((await collection.indexes()).find(index => index.name === name))) throw new Error('Replacement was not verified; legacy index retained');
    await collection.dropIndex('phone_1');
  }
  const after = await collection.indexes();
  return { legacyPresent: after.some(index => index.name === 'phone_1'), replacementVerified: matches(after.find(index => index.name === name)), applied: Boolean(apply && old) };
}
