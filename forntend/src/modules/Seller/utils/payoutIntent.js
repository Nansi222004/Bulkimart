// Only opaque attempt IDs and rupee amounts are stored; never bank details.
export const payoutIntent = (storage, sellerId, amount, createId) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount*100)) || Math.abs(amount*100-Math.round(amount*100)) > .00001) throw new Error('Payout amount must have at most two decimals');
  if (!sellerId) throw new Error('Seller identity has not loaded');
  const storageKey = `bulkimart:payout-intent:${sellerId}:${amount.toFixed(2)}`;
  let key = storage.getItem(storageKey);
  if (!key) { key = `seller-payout:${createId()}`; storage.setItem(storageKey, key); }
  return { key, complete: () => storage.removeItem(storageKey) };
};
