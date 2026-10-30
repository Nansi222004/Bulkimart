export function advertisingNotificationId(notification, admin = false) {
  const match = new RegExp(`^/${admin ? 'admin' : 'seller'}/advertising\\?campaign=([a-f\\d]{24})$`, 'i').exec(notification?.route || '');
  return match && (!notification.metadata?.campaignId || String(notification.metadata.campaignId) === match[1]) ? match[1] : null;
}

export function openAdvertisingNotification(notification, setTab, admin = false) {
  const id = advertisingNotificationId(notification, admin);
  if (!id) return false;
  setTab('advertising');
  window.history.pushState(null, '', `/${admin ? 'admin' : 'seller'}/advertising?campaign=${id}`);
  window.dispatchEvent(new Event('advertising-campaign-open'));
  return true;
}
