/**
 * Maps a notification `route` (backend notifyRider routes, e.g. '/delivery/earnings') to an app screen.
 * Mirrors the web DeliveryNotifications allow-list: only /delivery/* routes open anything.
 * Unknown or foreign routes open the notifications list instead of guessing.
 */
const TAB_ROUTES = {
  dashboard: { name: 'Main', params: { screen: 'Duty' } },
  earnings: { name: 'Main', params: { screen: 'Earnings' } },
  history: { name: 'Main', params: { screen: 'History' } },
  returns: { name: 'Main', params: { screen: 'Returns' } },
  profile: { name: 'Main', params: { screen: 'Profile' } },
  support: { name: 'Support' },
  parcels: { name: 'Parcels' },
};

export function routeForNotification(route) {
  const raw = String(route || '');
  const path = raw === '/delivery' ? '/delivery/dashboard' : raw;
  const match = path.match(/^\/delivery\/(dashboard|earnings|history|returns|profile|support|parcels)(?:[/?#]|$)/);
  if (!match) return { name: 'Notifications' };
  // Live chat replies (backend supportChat.service.js: /delivery/support?chat=1) open the chat.
  if (match[1] === 'support' && /[?&]chat=1/.test(path)) return { name: 'SupportChat' };
  if (match[1] === 'parcels') {
    const id = path.match(/[?&]parcel=([a-f\d]{24})/i)?.[1];
    return id ? { name: 'ParcelDetail', params: { id } } : TAB_ROUTES.parcels;
  }
  if (match[1] === 'returns') {
    const id = path.match(/^\/delivery\/returns\/([a-f\d]{24})/i)?.[1];
    if (id) return { name: 'ReturnDetail', params: { id } };
  }
  return TAB_ROUTES[match[1]];
}

export const isDeliveryNotification = (n) => /^\/delivery(?:\/|$)/.test(n?.route || '');
