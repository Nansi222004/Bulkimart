import { createHash } from 'node:crypto';
export const wholesaleQuoteHash = (composed) => createHash('sha256').update(JSON.stringify(composed.groups.map(group => ({
  seller: String(group.seller?._id), channel: group.channel, total: group.total, delivery: group.deliveryCharge,
  items: group.items.map(item => ({ product: String(item.productId), variant: String(item.variantId), qty: item.qty, price: item.price, terms: item.wholesaleSnapshot })),
})))).digest('hex');
