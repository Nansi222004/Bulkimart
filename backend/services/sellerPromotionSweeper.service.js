import { expireDuePromotions } from './sellerPromotion.service.js';

/**
 * Same poll-the-database shape as every other sweeper in this codebase
 * (orderSweeper.service.js, shgSubscriptionSweeper.service.js) — setInterval
 * + .unref(), not node-cron. Flips ACTIVE promotions past their expiresAt to
 * EXPIRED and turns off their linked Banner, so "banner disappears from the
 * public feed automatically" (Section 28) doesn't depend on an admin or
 * seller happening to open a screen that triggers a lazy check.
 */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15m — a promotion's minimum duration is measured in days

let timer = null;

export const sweepOnce = async () => {
  const n = await expireDuePromotions();
  if (n) console.log(`[SELLER PROMOTION SWEEPER] expired ${n} promotion(s)`);
};

export const startSellerPromotionSweeper = () => {
  if (timer) return;
  timer = setInterval(() => {
    sweepOnce().catch((err) => console.error('[SELLER PROMOTION SWEEPER] failed:', err.message));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  console.log('Seller promotion sweeper started — expired promotions are flagged and their banners disabled automatically');
};

export const stopSellerPromotionSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
