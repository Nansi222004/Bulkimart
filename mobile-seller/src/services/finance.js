import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { getFinanceLedger, getFinanceSummary } from './seller.api';
import { readSellerFinances, validPayoutAmount } from '../utils/financeRead';

// Summary + ledger loaded together and validated, the same as SellerContext.fetchSellerFinances.
export async function loadSellerFinances() {
  const [summaryBody, ledgerBody] = await Promise.all([getFinanceSummary(), getFinanceLedger(50)]);
  return readSellerFinances(summaryBody, ledgerBody);
}

/**
 * Port of frontend/src/modules/Seller/utils/payoutIntent.js.
 * One opaque Idempotency-Key per (seller, amount) until the server confirms the request,
 * so a retry after a dropped connection can't create a second payout request.
 * Stores only the key and the amount, never bank details.
 */
export async function payoutIntent(sellerId, amount) {
  if (!validPayoutAmount(amount)) throw new Error('Payout amount must have at most two decimals');
  if (!sellerId) throw new Error('Seller identity has not loaded');
  const storageKey = `bulkimart:payout-intent:${sellerId}:${amount.toFixed(2)}`;
  let key = await AsyncStorage.getItem(storageKey);
  if (!key) { key = `seller-payout:${uuidv4()}`; await AsyncStorage.setItem(storageKey, key); }
  return { key, complete: () => AsyncStorage.removeItem(storageKey) };
}
