import { createHash } from 'node:crypto';
import Cart from '../models/Cart.js';
import { buildFulfilmentGroups } from './fulfilmentGroups.service.js';
import { wholesaleQuoteHash } from './wholesaleQuote.service.js';
import { sumMoney } from '../utils/money.js';
import { httpError } from '../utils/response.js';

// Aggregate the existing documents. No fourth cart, migration or client prices.
export const buildCustomerBasket = async ({ userId, user, destination, session, preview = false }) => {
  let query = Cart.find({ userId, channel: { $in: ['grocery', 'ecommerce', 'wholesale'] } });
  if (session) query = query.session(session);
  const carts = await query.lean();
  const groups = [], warnings = [];
  let wholesaleHash = null;
  for (const mode of ['retail', 'wholesale']) {
    const selected = carts.filter(cart => (cart.channel === 'wholesale') === (mode === 'wholesale') && cart.items?.length);
    if (!selected.length) continue;
    try {
      const part = await buildFulfilmentGroups({ userId, user, destination, purchaseMode: mode, session, includeDigital: preview });
      if (mode === 'wholesale') wholesaleHash = wholesaleQuoteHash(part);
      groups.push(...part.groups.map(group => ({ ...group, key: `${mode}:${group.key}`, salesChannel: mode })));
    } catch (error) {
      if (!preview || ![400, 409].includes(error.status)) throw error;
      warnings.push(error.message);
      // Preserve invalid lines for review/removal; never present cached money as a quote.
      for (const cart of selected) groups.push({ key: `invalid:${cart._id}`, salesChannel: mode,
        channel: cart.channel, valid: false, seller: null,
        items: cart.items.map(item => ({ itemId: item._id, productId: item.productId, variantId: item.variantId,
          name: item.name, variantName: item.variantName, qty: item.qty, available: false,
          additionalMessage: item.additionalMessage })), total: null });
    }
  }
  if (!preview && groups.some(group => group.items.some(item => item.fulfillmentType === 'digital'))) throw httpError(400, 'Digital products require their existing digital checkout');
  if (!preview && groups.some(group => group.requestedMode === 'same_day' && group.deliveryMode !== 'same_day')) throw httpError(409, 'Same-day delivery is no longer available. Review your basket.');
  const items = groups.flatMap(group => group.items);
  const demand = new Map();
  for (const item of items) {
    if (item.fulfillmentType === 'digital') continue;
    const key = `${item.productId}:${item.variantId || 'root'}`;
    demand.set(key, (demand.get(key) || 0) + item.qty);
  }
  for (const item of items) {
    if (item.stock != null && item.fulfillmentType !== 'digital' && demand.get(`${item.productId}:${item.variantId || 'root'}`) > item.stock) {
      item.available = false;
      if (preview) warnings.push(`Combined quantity exceeds available stock for ${item.name}.`);
    }
  }
  if (preview && items.some(item => item.fulfillmentType === 'digital') && items.some(item => item.fulfillmentType !== 'digital')) warnings.push('Digital and physical products require separate checkout.');
  if (preview && groups.some(group => group.requestedMode === 'same_day' && group.deliveryMode !== 'same_day')) warnings.push('Same-day delivery is no longer available. Choose Scheduled or review your basket.');
  const valid = !warnings.length && groups.every(group => group.items.every(item => item.available !== false));
  const totals = valid ? groups.reduce((total, group) => ({
    subtotal: sumMoney(total.subtotal, group.subtotal), deliveryCharge: sumMoney(total.deliveryCharge, group.deliveryCharge),
    sameDayPremium: sumMoney(total.sameDayPremium, group.sameDayFee || 0, group.sellerIncentive || 0),
    couponDiscount: 0, totalAmount: sumMoney(total.totalAmount, group.total),
    itemCount: total.itemCount + group.items.reduce((n, item) => n + item.qty, 0),
  }), { subtotal: 0, deliveryCharge: 0, sameDayPremium: 0, couponDiscount: 0, totalAmount: 0, itemCount: 0 }) : null;
  const basketHash = valid ? createHash('sha256').update(JSON.stringify(groups.map(group => ({
    key: group.key, quote: wholesaleQuoteHash({ groups: [group] }),
    requestedMode: group.requestedMode,
    lines: group.items.map(item => String(item.itemId)),
  })))).digest('hex') : null;
  return { groups, items: groups.flatMap(group => group.items), totals, valid, warnings,
    purchaseMode: 'basket', quoteHash: wholesaleHash, basketHash, needsDeliveryChoice: false,
    cartSnapshots: carts.filter(cart => cart.items?.length).map(cart => ({ id: cart._id, version: cart.__v ?? 0, channel: cart.channel })) };
};
