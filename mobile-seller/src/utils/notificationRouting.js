// Maps a notification (inbox row or FCM data payload) to an in-app screen.
// Inputs come from the backend: `route` (e.g. /seller/orders/<id>, /seller/item-returns?return=<id>, /seller/earnings)
// and `metadata` ids (orderId, returnId, ticketId, productId). FCM data carries the same keys flattened.

const OBJECT_ID = /^[a-f\d]{24}$/i;
const id = (value) => (OBJECT_ID.test(String(value || '')) ? String(value) : null);

export const isRetiredSellerNotification = (n = {}) =>
  ['CAMPAIGN_UPDATE', 'SELLER_PROMOTION_UPDATE'].includes(n.event) || n.type === 'promotion'
  || /^\/(?:seller\/)?(?:promotions|campaigns|deals|advertisements|grow)(?:[/?#]|$)/i.test(n.route || '');

export function notificationTarget(n = {}) {
  const meta = n.metadata || n; // FCM data is flat
  const route = String(n.route || '');
  const orderId = id(meta.orderId) || route.match(/^\/seller\/orders\/([a-f\d]{24})(?:[/?#]|$)/i)?.[1] || route.match(/[?&]order=([a-f\d]{24})/i)?.[1];
  const returnId = id(meta.returnId) || route.match(/[?&]return=([a-f\d]{24})/i)?.[1];
  const ticketId = id(meta.ticketId);

  // Live chat replies / status changes (backend supportChat.service.js) open the chat.
  if (id(meta.conversationId) || /^\/seller\/support\?chat=1/i.test(route)) return { screen: 'SupportChat' };
  if (returnId) return { screen: 'ReturnDetail', params: { id: returnId, title: meta.returnNumber } };
  if (orderId) return { screen: 'OrderDetail', params: { id: orderId } };
  if (ticketId) return { screen: 'TicketDetail', params: { id: ticketId } };
  if (/^\/seller\/item-returns/i.test(route)) return { screen: 'Returns' };
  if (/^\/seller\/(earnings|moneyrequest|paymenthistory)/i.test(route)) return { screen: 'Tabs', params: { screen: 'Earnings' } };
  if (/^\/seller\/(products|stock)/i.test(route) || id(meta.productId)) return { screen: 'Tabs', params: { screen: 'Products' } };
  if (/^\/seller\/support/i.test(route)) return { screen: 'Support' };
  const campaignId = id(meta.campaignId) || route.match(/^\/seller\/advertising[^?#]*[?&]campaign=([a-f\d]{24})/i)?.[1];
  if (campaignId) return { screen: 'CampaignDetail', params: { id: campaignId } };
  if (/^\/seller\/advertising/i.test(route)) return { screen: 'Advertising' };
  if (/^\/seller\/faqs/i.test(route)) return { screen: 'ProductFaqs' };
  if (/^\/seller(\/dashboard)?\/?$/i.test(route)) return { screen: 'Tabs', params: { screen: 'Dashboard' } };
  return null;
}
