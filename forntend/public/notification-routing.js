// Shared by the classic FCM service worker and its offline regression tests.
self.notificationTarget = function (data = {}) {
  if (data.audience === 'seller' || data.event === 'ORDER_CREATED' && String(data.route || '').startsWith('/seller')) {
    if (!/^[a-f\d]{24}$/i.test(String(data.orderId || ''))) return '/seller/orders';
    const params = new URLSearchParams();
    if (/^[a-f\d]{24}$/i.test(String(data.notificationId || ''))) params.set('notification', data.notificationId);
    return '/seller/orders/' + data.orderId + (params.size ? '?' + params : '');
  }
  try {
    const url = new URL(data.route || '/', self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : '/';
  } catch { return '/'; }
};
