export const isSellerReturnNotification = notification =>
  /^(RETURN_|REFUND_)/.test(notification?.event || '') || Boolean(notification?.metadata?.returnId)
  || /^\/seller\/(?:returns|item-returns)(?:[/?]|$)/.test(notification?.route || '');

const OBJECT_ID = /^[a-f\d]{24}$/i;

/** The return a notification points at — from metadata, else its `?return=` route. */
export const sellerReturnIdOf = notification => {
  const fromMeta = String(notification?.metadata?.returnId || '');
  if (OBJECT_ID.test(fromMeta)) return fromMeta;
  const fromRoute = String(notification?.route || '').match(/[?&]return=([a-f\d]{24})(?:&|$)/i)?.[1];
  return fromRoute || null;
};

/**
 * Opens Item Returns and, when the notification names a return, that return's
 * details. The URL carries `?return=` so a not-yet-mounted tab picks it up on
 * mount; the event reaches an already-open tab.
 */
export const openSellerReturn = (setActiveTab, notification) => {
  setActiveTab('item-returns');
  const returnId = sellerReturnIdOf(notification);
  if (!returnId || typeof window === 'undefined') return;
  window.history.replaceState(null, '', `/seller/item-returns?return=${returnId}`);
  window.dispatchEvent(new CustomEvent('seller_open_return', { detail: { returnId } }));
};
