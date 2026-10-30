import { serviceApplicationId } from '../../../components/services/serviceRequests';
import { openAdvertisingNotification } from '../../../components/advertising/advertisingNotifications';

const openCustomerRequest = (id, actions) => {
  actions.setTab('services'); actions.close();
  window.history.replaceState(null, '', `/admin/services?legalRequest=${id}`);
  window.dispatchEvent(new Event('legal-request-open'));
};

// Keep notification data out of detail state: only the authenticated API may
// populate it. The route contains an opaque reference, never form/file data.
export function createAdminNotificationOpener() {
  const pending = new Set(), marked = new Set();
  return async (n, actions) => {
    if (!n || typeof n !== 'object') return;
    const key = n._id || n;
    if (pending.has(key)) return;
    pending.add(key);
    try {
      if (!n.isRead && n._id && !marked.has(key)) {
        marked.add(key);
        await actions.markRead(n._id);
      }
      if (openAdvertisingNotification(n, actions.setTab, true)) { actions.close(); return; }
      if (n.metadata?.ticketId) {
        actions.setTab('tickets'); actions.close();
        await actions.openTicket({
          id: n.metadata.ticketId,
          ticketNumber: n.metadata.ticketNumber || n.metadata.ticketId,
          userName: n.metadata.userName || '',
          requesterRole: n.metadata.requesterRole || 'customer',
          subject: n.metadata.subject || n.title || 'Support Request',
          category: n.metadata.category || 'General',
        });
      } else if (/^\/admin\/services\?legalRequest=[a-f\d]{24}$/i.test(n.route || '') && serviceApplicationId(n.metadata?.applicationId) === new URLSearchParams(n.route.split('?')[1]).get('legalRequest')) {
        openCustomerRequest(serviceApplicationId(n.metadata.applicationId), actions);
      } else if (/^\/admin\/parcel-delivery(\?parcel=[a-f\d]{24})?$/i.test(n.route || '')) {
        // Parcel alerts open the booking; the panel reads the id from the URL.
        actions.setTab('parcel-delivery'); actions.close();
        window.history.replaceState(null, '', n.route);
        window.dispatchEvent(new Event('parcel-booking-open'));
      } else if (n.metadata?.applicationId || n.route === '/admin/services') {
        const id = serviceApplicationId(n.metadata?.applicationId);
        // Older paid customer alerts used the seller application route. Resolve
        // their audience from the authenticated API without rewriting history.
        if (id && await actions.resolveServiceType?.(id) === 'customer') { openCustomerRequest(id, actions); return; }
        actions.setTab('services'); actions.close();
        if (id) actions.openService(id);
        else actions.toast('Service application reference is unavailable. Select an application from the list.');
      }
    } catch {
      marked.delete(key);
      actions.toast('Unable to open this notification. Please try again.');
    } finally { pending.delete(key); }
  };
}
