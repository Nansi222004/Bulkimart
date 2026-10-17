// Legacy records have no explicit channel list: type/channels and enabled
// variant offers retain their existing meaning. Explicit lists restrict access.
export const channelAllowed = (product, channel) => product?.sellingChannels == null || product.sellingChannels.includes(channel);
export const retailAllowed = product => product?.sellingChannels == null || product.sellingChannels.some(channel => ['ecommerce', 'grocery'].includes(channel));
export const channelVisibility = channel => ({ $or: [{ sellingChannels: { $exists: false } }, { sellingChannels: null }, { sellingChannels: channel }] });
export const retailVisibility = () => ({ $or: [{ sellingChannels: { $exists: false } }, { sellingChannels: null }, { sellingChannels: { $in: ['ecommerce', 'grocery'] } }] });
export const wholesaleOnly = product => Array.isArray(product?.sellingChannels) && product.sellingChannels.length === 1 && product.sellingChannels[0] === 'wholesale';
