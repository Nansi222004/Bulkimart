export const isSellerReturnNotification = notification =>
  /^(RETURN_|REFUND_)/.test(notification?.event || '') || Boolean(notification?.metadata?.returnId)
  || /^\/seller\/(?:returns|item-returns)(?:[/?]|$)/.test(notification?.route || '');
