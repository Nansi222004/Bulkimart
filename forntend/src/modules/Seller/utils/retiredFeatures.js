// Historical records remain in the database; retired seller tools have no inbox actions.
export const isRetiredSellerNotification = (notification = {}) =>
  ['CAMPAIGN_UPDATE', 'SELLER_PROMOTION_UPDATE'].includes(notification.event) ||
  notification.type === 'promotion' ||
  /^\/(?:seller\/)?(?:promotions|campaigns|deals|advertisements|grow)(?:[/?#]|$)/i.test(notification.route || '');
