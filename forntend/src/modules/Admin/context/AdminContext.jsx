import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { adminGet, adminPatch, adminPost, adminDelete, qs } from '../../../utils/adminApi';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';

const AdminContext = createContext();

/**
 * Which tab a nav id actually opens.
 *
 * Several nav entries are section landing pages rather than tabs of their own
 * — tapping "Sellers" opens the vendor dashboard. Resolving here means the id
 * that goes in the URL is the one the panel is really showing, so a refresh
 * lands back on the same screen instead of bouncing to the section root.
 */
const TAB_ALIASES = {
  sellers: 'vendor-dashboard',
  'delivery-partners': 'delivery-dashboard',
  users: 'user-dashboard',
};

/**
 * Friendly URLs that name a tab differently from its internal id, so
 * /admin/reviews works as well as /admin/user-reviews.
 */
const PATH_ALIASES = {
  reviews: 'user-reviews',
  orders: 'ecom-orders',
};

const DEFAULT_TAB = 'overview';

/** '/admin/reviews' → 'user-reviews'; '/admin' → 'overview'. */
const tabFromPath = () => {
  const segment = window.location.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  if (!segment) return DEFAULT_TAB;
  const decoded = decodeURIComponent(segment);
  if (decoded === 'shg' || decoded.startsWith('shg-') || decoded === 'subscriptions' || decoded.startsWith('sub-') || decoded === 'donation-settings') return DEFAULT_TAB;
  return PATH_ALIASES[decoded] || TAB_ALIASES[decoded] || decoded;
};

export const AdminProvider = ({ children }) => {
  // Read from the URL on first paint, so opening /admin/reviews directly (or
  // refreshing on it) lands on that tab rather than the dashboard.
  const [activeTabInternal, setActiveTabInternal] = useState(tabFromPath);

  const setActiveTab = (tabId) => {
    if (tabId === 'shg' || tabId.startsWith('shg-') || tabId === 'subscriptions' || tabId.startsWith('sub-') || tabId === 'donation-settings') tabId = DEFAULT_TAB;
    const resolved = TAB_ALIASES[tabId] || tabId;
    setActiveTabInternal(resolved);

    const path = resolved === DEFAULT_TAB ? '/admin' : `/admin/${resolved}`;
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  // Back/forward move between tabs like any other navigation.
  useEffect(() => {
    const onPopState = () => setActiveTabInternal(tabFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [toastMessage, setToastMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  // Modals & sub-state
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketReply, setTicketReply] = useState('');

  // Admin's own notification inbox (GET /api/admin/notifications) — the
  // panel's real-time channel, previously just a toast-triggering button.
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [adminUnreadCount, setAdminUnreadCount] = useState(0);
  const [adminNotifLoading, setAdminNotifLoading] = useState(false);

  const fetchAdminNotifications = useCallback(async () => {
    setAdminNotifLoading(true);
    try {
      const { data } = await adminGet('/notifications?limit=30');
      setAdminNotifications(data || []);
    } catch (err) {
      console.error('[ADMIN] fetch notifications failed:', err.message);
    } finally {
      setAdminNotifLoading(false);
    }
  }, []);

  const fetchAdminUnreadCount = useCallback(async () => {
    try {
      const { data } = await adminGet('/notifications/unread-count');
      setAdminUnreadCount(data?.count || 0);
    } catch (err) {
      console.error('[ADMIN] fetch unread count failed:', err.message);
    }
  }, []);

  const markAdminNotificationRead = useCallback(async (id) => {
    setAdminNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, isRead: true } : n)));
    setAdminUnreadCount((c) => Math.max(0, c - 1));
    try {
      await adminPatch(`/notifications/${id}/read`, {});
    } catch (err) {
      console.error('[ADMIN] mark-read failed:', err.message);
    }
  }, []);

  // Connects once an admin token exists — Admin previously had no socket
  // connection at all (a pure HTTP-polling dashboard); this is the
  // smallest addition that gives it a live "something changed" signal,
  // same pattern every other role's context already uses.
  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) return;
    connectSocket(token, 'admin');
    fetchAdminUnreadCount();

    const onNew = () => setAdminUnreadCount((c) => c + 1);
    socket.on('notification_new', onNew);
    return () => {
      socket.off('notification_new', onNew);
      disconnectSocket();
    };
  }, [fetchAdminUnreadCount]);

  // Toast Trigger Helper
  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage('');
    }, 3000);
  };

  // Recent Activity System Logs
  /**
   * Activity log for this admin session only.
   *
   * It used to be seeded with four entries describing things that never
   * happened — a seller registering, a product submitted, a payout pending — so
   * every admin opened the panel to a history of invented events. It now starts
   * empty and fills as the admin acts.
   *
   * This is not persisted: refreshing clears it. A durable audit trail belongs
   * on the server, not in a browser tab.
   */
  const [logs, setLogs] = useState([]);

  const addLog = (text) => {
    setLogs(prev => [
      { id: Date.now(), time: 'Just Now', text },
      ...prev.slice(0, 7) // keep last 8 logs
    ]);
  };

  // 1. SELLERS LIST STATE
  // ==========================================================================
  // 1. GENERAL VENDORS (SELLERS) — live data from GET /api/admin/sellers
  //    Mock data removed; this section is fully wired to the backend.
  // ==========================================================================
  // remembers which vendor tab is open so refreshes land on the same list
  const [sellerStatusFilter, setSellerStatusFilter] = useState('all');

  const [sellers, setSellers] = useState([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [sellersError, setSellersError] = useState('');
  const [sellerCounts, setSellerCounts] = useState({ pending: 0, approved: 0 });

  const [sellerDetail, setSellerDetail] = useState(null);
  const [sellerDetailLoading, setSellerDetailLoading] = useState(false);

  const fetchSellers = useCallback(async (status = 'all', search = '') => {
    setSellersLoading(true);
    setSellersError('');
    try {
      const { data } = await adminGet(`/sellers${qs({ status, search, limit: 100 })}`);
      setSellers(data || []);
    } catch (err) {
      setSellersError(err.message);
      setSellers([]);
    } finally {
      setSellersLoading(false);
    }
  }, []);

  const fetchSellerCounts = useCallback(async () => {
    try {
      const { data } = await adminGet('/dashboard/pending-counts');
      setSellerCounts(data.sellers || { pending: 0, approved: 0 });
    } catch {
      /* badge counts are non-critical */
    }
  }, []);

  // Platform Overview dashboard — KPI cards + Recent Orders / Low Stock /
  // Sellers Registered / category-sales widgets, all from one endpoint.
  const [dashboardOverview, setDashboardOverview] = useState(null);
  const [dashboardOverviewLoading, setDashboardOverviewLoading] = useState(false);

  const fetchDashboardOverview = useCallback(async () => {
    setDashboardOverviewLoading(true);
    try {
      const { data } = await adminGet('/dashboard/overview');
      setDashboardOverview(data);
    } catch {
      setDashboardOverview(null);
    } finally {
      setDashboardOverviewLoading(false);
    }
  }, []);

  /** Load the full registration dossier (all steps + uploaded documents). */
  const fetchSellerDetail = useCallback(async (id) => {
    setSellerDetailLoading(true);
    setSellerDetail(null);
    try {
      const { data } = await adminGet(`/sellers/${id}`);
      setSellerDetail(data);
    } catch (err) {
      triggerToast(err.message);
    } finally {
      setSellerDetailLoading(false);
    }
  }, []);

  const approveSeller = async (id) => {
    try {
      const { message } = await adminPatch(`/sellers/${id}/approve`);
      triggerToast(message || 'Seller approved.');
      addLog(`Seller ${id} approved.`);
      setSelectedSeller(null);
      setSellerDetail(null);
      await Promise.all([fetchSellers(sellerStatusFilter), fetchSellerCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const rejectSeller = async (id, reason) => {
    const finalReason = reason || window.prompt('Reason for rejection (the seller will see this):');
    if (!finalReason) return;
    try {
      const { message } = await adminPatch(`/sellers/${id}/reject`, { reason: finalReason });
      triggerToast(message || 'Seller rejected.');
      addLog(`Seller ${id} rejected: ${finalReason}`);
      setSelectedSeller(null);
      setSellerDetail(null);
      await Promise.all([fetchSellers(sellerStatusFilter), fetchSellerCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const suspendSeller = async (id, reason) => {
    const finalReason = reason || window.prompt('Reason for suspension:');
    if (!finalReason) return;
    try {
      const { message } = await adminPatch(`/sellers/${id}/suspend`, { reason: finalReason });
      triggerToast(message || 'Seller suspended.');
      addLog(`Seller ${id} suspended: ${finalReason}`);
      setSelectedSeller(null);
      setSellerDetail(null);
      await Promise.all([fetchSellers(sellerStatusFilter), fetchSellerCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  /**
   * A seller's product-visibility radius — unlike approve/reject/suspend,
   * this doesn't change the seller's status, so the detail view stays
   * open afterward and just re-fetches to show the saved value.
   */
  const setSellerRadius = async (id, radiusKm) => {
    try {
      const { message } = await adminPatch(`/sellers/${id}/radius`, { radiusKm });
      triggerToast(message || 'Seller radius updated.');
      await fetchSellerDetail(id);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const setSellerWholesaleStatus = async (id, status, reason) => {
    try {
      const payload = { status, ...(status === 'suspended' ? { suspensionReason: reason } : { rejectionReason: reason }) };
      const { message } = await adminPatch(`/sellers/${id}/wholesale`, payload);
      triggerToast(message || `Wholesale channel ${status}.`);
      await Promise.all([fetchSellerDetail(id), fetchSellers(sellerStatusFilter)]);
      return { ok: true };
    } catch (err) {
      triggerToast(err.message);
      return { ok: false, message: err.message };
    }
  };

  const setDeliveryPartnerRadius = async (id, radiusKm) => {
    try {
      const { message } = await adminPatch(`/delivery-partners/${id}/radius`, { radiusKm });
      triggerToast(message || 'Delivery partner radius updated.');
      await fetchRiderDetail(id);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  /**
   * The three platform-wide radius ceilings (Same-Day / seller service /
   * delivery partner) — separate from the per-seller and per-rider radius
   * above, which those two functions already manage. Same GET/POST shape
   * as the delivery-charge setting.
   */
  const fetchRadiusSettings = async () => {
    try {
      const { data } = await adminGet('/radius-settings');
      return data;
    } catch (err) {
      triggerToast(err.message);
      return null;
    }
  };

  const setRadiusSettings = async (payload) => {
    try {
      const { message } = await adminPost('/radius-settings', payload);
      triggerToast(message || 'Radius settings updated.');
      return true;
    } catch (err) {
      triggerToast(err.message);
      return false;
    }
  };

  // ==========================================================================
  // Referral Program — settings, monitoring queue, cost report
  // ==========================================================================
  const fetchReferralSettings = async () => {
    try {
      const { data } = await adminGet('/referral-settings');
      return data;
    } catch (err) {
      triggerToast(err.message);
      return null;
    }
  };

  const setReferralSettings = async (payload) => {
    try {
      const { message } = await adminPost('/referral-settings', payload);
      triggerToast(message || 'Referral settings updated.');
      return true;
    } catch (err) {
      triggerToast(err.message);
      return false;
    }
  };

  const fetchReferralsAdmin = async ({ status, search, page = 1, limit = 20 } = {}) => {
    try {
      const { data, pagination } = await adminGet(`/referrals${qs({ status, search, page, limit })}`);
      return { rows: data || [], pagination };
    } catch (err) {
      triggerToast(err.message);
      return { rows: [], pagination: null };
    }
  };

  const fetchReferralCostReport = async () => {
    try {
      const { data } = await adminGet('/referrals/cost-report');
      return data;
    } catch (err) {
      triggerToast(err.message);
      return null;
    }
  };

  const blockReferralAdminAction = async (id, reason) => {
    try {
      await adminPatch(`/referrals/${id}/block`, { reason });
      triggerToast('Referral blocked.');
      return true;
    } catch (err) {
      triggerToast(err.message);
      return false;
    }
  };

  const approveReferralAdminAction = async (id) => {
    try {
      await adminPatch(`/referrals/${id}/approve`, {});
      triggerToast('Referral approved and credited.');
      return true;
    } catch (err) {
      triggerToast(err.message);
      return false;
    }
  };

  // ==========================================================================
  // 2. PRODUCTS — live from GET /api/admin/products
  //    Mock catalogue removed. It listed five SHG products (clay jars, mango
  //    pickle, forest honey) that exist in no database, each carrying a
  //    fabricated per-channel price and stock.
  // ==========================================================================
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productFilters, setProductFilters] = useState({ status: 'all', type: '', search: '' });

  /**
   * One product belongs to one storefront.
   *
   * The removed mock hung a `quick` and an `ecom` block off a single product,
   * as if one listing lived on both. It does not: a product carries a `type`
   * of ecommerce or grocery, and a seller who wants both creates two.
   */
  const fetchAdminProducts = useCallback(async (filters = {}) => {
    setProductsLoading(true);
    setProductsError('');
    try {
      const { data } = await adminGet(`/products${qs({ limit: 100, ...filters })}`);
      setProducts((data || []).map((p) => ({
        id: p._id,
        name: p.name,
        channel: p.type,
        fulfillmentType: p.fulfillmentType || 'physical',
        digital: p.fulfillmentType === 'digital' ? {
          author: p.digital?.author,
          language: p.digital?.language,
          format: p.digital?.format,
          fileStatus: p.digital?.file?.status || 'missing',
          fileSizeBytes: p.digital?.file?.sizeBytes || 0,
        } : undefined,
        sellerName: p.sellerId?.storeDetails?.name || p.sellerId?.businessName
                 || p.shgStoreId?.groupName || '—',
        category: p.category?.name || '—',
        desc: p.description,
        price: p.price,
        mrp: p.mrp,
        stock: p.stock,
        unit: p.unit,
        image: p.images?.[0] || null,
        status: p.status,
        isActive: p.isActive,
        isFeatured: p.isFeatured,
        isSponsored: p.isSponsored,
        sponsoredRank: p.sponsoredRank,
        rejectionReason: p.rejectionReason,
        createdAt: p.createdAt,
        raw: p,
      })));
    } catch (err) {
      setProductsError(err.message);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  /**
   * Restore a listing that was taken down.
   *
   * Not an approval queue: products go live the moment a seller publishes them,
   * by deliberate decision. This exists to undo a takedown.
   */
  const restoreProduct = async (id) => {
    try {
      const { message } = await adminPatch(`/products/${id}/approve`);
      triggerToast(message || 'Product is live again.');
      addLog(`Product ${id} restored to live.`);
      setSelectedProduct(null);
      await fetchAdminProducts(productFilters);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  /** Take a listing off the storefront. The seller is shown the reason. */
  const takeDownProduct = async (id, reason) => {
    const finalReason = reason || window.prompt('Why is this listing being taken down? (the seller will see this)');
    if (!finalReason) return;
    try {
      const { message } = await adminPatch(`/products/${id}/reject`, { reason: finalReason });
      triggerToast(message || 'Product taken down.');
      addLog(`Product ${id} taken down: ${finalReason}`);
      setSelectedProduct(null);
      await fetchAdminProducts(productFilters);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const toggleProductFeatured = async (id, isFeatured) => {
    try {
      const { message } = await adminPatch(`/products/${id}/feature`, { isFeatured });
      triggerToast(message || 'Updated.');
      await fetchAdminProducts(productFilters);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const toggleProductSponsored = async (id, isSponsored, sponsoredRank) => {
    try {
      const { message } = await adminPatch(`/products/${id}/sponsor`, { isSponsored, sponsoredRank });
      triggerToast(message || 'Updated.');
      await fetchAdminProducts(productFilters);
    } catch (err) {
      triggerToast(err.message);
    }
  };
  // 3. PAYOUTS STATE
  // Seller payouts: no backend endpoint yet (Day 3). Empty, not fabricated.
  const [payouts, setPayouts] = useState([]);

  const processPayout = (id) => {
    setPayouts(prev => prev.map(p => p.id === id ? { ...p, status: 'Approved' } : p));
    const pay = payouts.find(p => p.id === id);
    triggerToast(`Payout of ₹${pay?.amount.toLocaleString('en-IN')} approved for ${pay?.sellerName}.`);
    addLog(`Bank transfer of ₹${pay?.amount} processed to ${pay?.sellerName}.`);
    setSelectedPayout(null);
  };

  // Rider payouts — live from GET /api/admin/rider-payouts. `earnings.pending`/
  // `earnings.paid` on DeliveryPartner are the platform's real running ledger
  // (incremented on every delivered trip), not a number computed just for
  // this screen.
  const [riderPayouts, setRiderPayouts] = useState([]);
  const [riderPayoutsLoading, setRiderPayoutsLoading] = useState(false);
  const [riderPayoutsError, setRiderPayoutsError] = useState('');

  const fetchRiderPayouts = useCallback(async (search = '') => {
    setRiderPayoutsLoading(true);
    setRiderPayoutsError('');
    try {
      const { data } = await adminGet(`/rider-payouts${qs({ search, limit: 100 })}`);
      setRiderPayouts(data || []);
    } catch (err) {
      setRiderPayoutsError(err.message);
      setRiderPayouts([]);
    } finally {
      setRiderPayoutsLoading(false);
    }
  }, []);

  const settleRiderPayout = async (id, name, amount) => {
    try {
      const { message } = await adminPatch(`/rider-payouts/${id}/settle`);
      triggerToast(message || `Payout of ₹${amount} settled for ${name}.`);
      addLog(`Rider payout of ₹${amount} settled for ${name}.`);
      await fetchRiderPayouts();
    } catch (err) {
      triggerToast(err.message);
    }
  };

  // 4. SUPPORT TICKETS STATE — live from GET /api/admin/tickets
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState('');
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState('All');
  const [ticketRoleFilter, setTicketRoleFilter] = useState('All');

  // Full detail (ticket + conversation incl. internal notes) for whichever
  // ticket is open — separate from the lightweight list-row shape above.
  const [ticketDetail, setTicketDetail] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);

  const mapTicketRow = (t) => ({
    id: t._id,
    ticketNumber: t.ticketNumber || t._id,
    userName: t.userName,
    userEmail: t.userEmail || '',
    requesterRole: t.requesterRole || 'customer',
    category: t.category || '—',
    subject: t.subject,
    desc: t.description,
    status: t.status,
    reply: t.reply || '',
    assignedAdmin: t.assignedAdmin || null,
    date: t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    raw: t,
  });

  const fetchTickets = useCallback(async (status = 'all', search = '', category = 'all', requesterRole = 'all') => {
    setTicketsLoading(true);
    setTicketsError('');
    try {
      const { data } = await adminGet(`/tickets${qs({ status, search, category, requesterRole, limit: 100 })}`);
      setTickets((data || []).map(mapTicketRow));
    } catch (err) {
      setTicketsError(err.message);
      setTickets([]);
    } finally {
      setTicketsLoading(false);
    }
  }, []);

  const openTicketDetail = async (ticketRow) => {
    setSelectedTicket(ticketRow);
    setTicketDetail(null);
    setTicketMessages([]);
    setTicketDetailLoading(true);
    try {
      const { data } = await adminGet(`/tickets/${ticketRow.id}`);
      setTicketDetail(data.ticket);
      setTicketMessages(data.messages || []);
    } catch (err) {
      triggerToast(err.message);
    } finally {
      setTicketDetailLoading(false);
    }
  };

  const refreshTicketDetail = async (id) => {
    const { data } = await adminGet(`/tickets/${id}`);
    setTicketDetail(data.ticket);
    setTicketMessages(data.messages || []);
    await fetchTickets(filterStatus === 'All' ? 'all' : filterStatus, searchQuery, ticketCategoryFilter === 'All' ? 'all' : ticketCategoryFilter, ticketRoleFilter === 'All' ? 'all' : ticketRoleFilter);
  };

  const replyToTicket = async (id, message) => {
    try {
      await adminPost(`/tickets/${id}/messages`, { message });
      setTicketReply('');
      await refreshTicketDetail(id);
      triggerToast('Reply sent.');
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const addInternalNote = async (id, message) => {
    try {
      await adminPost(`/tickets/${id}/notes`, { message });
      await refreshTicketDetail(id);
      triggerToast('Internal note added.');
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const assignTicketToSelf = async (id) => {
    try {
      await adminPatch(`/tickets/${id}/assign`, {});
      addLog(`Support ticket ${id} assigned.`);
      await refreshTicketDetail(id);
      triggerToast('Ticket assigned to you.');
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const changeTicketStatus = async (id, status) => {
    try {
      await adminPatch(`/tickets/${id}/status`, { status });
      addLog(`Support ticket ${id} status changed to ${status}.`);
      await refreshTicketDetail(id);
      triggerToast(`Status updated to ${status.replace(/_/g, ' ')}.`);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const resolveTicket = async (id, reply) => {
    try {
      await adminPatch(`/tickets/${id}/resolve`, { reply });
      triggerToast(`Ticket has been marked RESOLVED.`);
      addLog(`Support ticket ${id} resolved: "${(reply || '').slice(0, 20)}..."`);
      setSelectedTicket(null);
      setTicketReply('');
      await fetchTickets();
    } catch (err) {
      triggerToast(err.message);
    }
  };

  // 5. USERS STATE — live from GET /api/admin/users
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const fetchUsers = useCallback(async (search = '', status = 'all', state = '', district = '') => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const { data } = await adminGet(`/users${qs({ search, status, state, district, limit: 100 })}`);
      setUsers((data || []).map((u) => ({
        id: u._id,
        name: u.name || 'Anonymous User',
        phone: u.phone || '',
        email: u.email || '',
        kycStatus: u.isActive ? 'Verified' : 'Pending',
        date: u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
        isActive: u.isActive,
        raw: u
      })));
    } catch (err) {
      setUsersError(err.message);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // State/District filter options for the Consumer Users directory — only
  // the (state, district) combinations that actually have a registered
  // user, computed server-side from everyone's DEFAULT address.
  const [consumerLocations, setConsumerLocations] = useState({ states: [], districtsByState: {}, stateCounts: {} });

  const fetchConsumerLocations = useCallback(async () => {
    try {
      const { data } = await adminGet('/consumers/locations');
      setConsumerLocations(data || { states: [], districtsByState: {}, stateCounts: {} });
    } catch (err) {
      triggerToast(err.message);
    }
  }, []);

  const approveUserKyc = async (id) => {
    try {
      await adminPatch(`/users/${id}/status`, { isActive: true });
      triggerToast('User KYC status approved.');
      addLog(`User ${id} KYC approved.`);
      await fetchUsers();
    } catch (err) {
      triggerToast(err.message);
    }
  };

  // Consumer directory summary counts — total/active/inactive/blocked buyers,
  // plus new-signup counts. Powers both the Consumer Users header chips and
  // the Consumer Users -> Dashboard tab's stat cards.
  const [consumerStats, setConsumerStats] = useState({
    total: 0, active: 0, inactive: 0, blocked: 0, newLast7Days: 0, newLast30Days: 0,
  });

  const fetchConsumerStats = useCallback(async () => {
    try {
      const { data } = await adminGet('/consumers/stats');
      setConsumerStats(data || { total: 0, active: 0, inactive: 0, blocked: 0, newLast7Days: 0, newLast30Days: 0 });
    } catch {
      /* summary counts are non-critical */
    }
  }, []);

  // This calendar month's order activity across both channels — the
  // Dashboard tab's "Orders This Month" card.
  const [consumerOrdersSummary, setConsumerOrdersSummary] = useState({ totalOrders: 0, totalRevenue: 0, byChannel: {} });

  const fetchConsumerOrdersSummary = useCallback(async () => {
    try {
      const { data } = await adminGet('/consumers/orders-summary');
      setConsumerOrdersSummary(data || { totalOrders: 0, totalRevenue: 0, byChannel: {} });
    } catch {
      /* non-critical */
    }
  }, []);

  // Buyer-account activity feed (wallet events + profile/address updates).
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLogsLoading, setActivityLogsLoading] = useState(false);

  const fetchCustomerActivityLog = useCallback(async ({ state, district } = {}) => {
    setActivityLogsLoading(true);
    try {
      const { data } = await adminGet(`/consumers/activity-log${qs({ state, district })}`);
      setActivityLogs(data || []);
    } catch {
      setActivityLogs([]);
    } finally {
      setActivityLogsLoading(false);
    }
  }, []);

  // Order history — one buyer's (pass userId) or a whole channel's (pass type).
  const [customerOrders, setCustomerOrders] = useState([]);
  const [customerOrdersLoading, setCustomerOrdersLoading] = useState(false);
  const [customerOrdersMeta, setCustomerOrdersMeta] = useState({ page: 1, limit: 20, total: 0, pages: 0 });

  /**
   * `type` is now OPTIONAL — omitting it (and `userId`) returns every order
   * ever placed, across BOTH channels, paginated. Previously the backend
   * refused that combination outright, which is why the old "Orders" tab
   * under Consumer Users silently hardcoded `type: 'ecommerce'` and never
   * showed a single Quick Commerce order.
   */
  const fetchCustomerOrders = useCallback(async ({ userId, type, status, search, page = 1, limit = 20 } = {}) => {
    setCustomerOrdersLoading(true);
    try {
      const { data, meta } = await adminGet(`/consumers/orders${qs({ userId, type, status, search, page, limit })}`);
      setCustomerOrders(data || []);
      setCustomerOrdersMeta(meta || { page: 1, limit, total: 0, pages: 0 });
    } catch {
      setCustomerOrders([]);
      setCustomerOrdersMeta({ page: 1, limit, total: 0, pages: 0 });
    } finally {
      setCustomerOrdersLoading(false);
    }
  }, []);

  // Flattened product reviews, for moderation.
  const [reviewsList, setReviewsList] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');

  // Which moderation queue is on screen — remembered so an approve/reject
  // refreshes the same filter the admin was looking at, not the whole list.
  const [reviewStatusFilter, setReviewStatusFilter] = useState('pending');

  const fetchCustomerReviews = useCallback(async (search = '', status = 'pending') => {
    setReviewsLoading(true);
    setReviewsError('');
    try {
      const { data } = await adminGet(`/consumers/reviews${qs({ search, status, limit: 100 })}`);
      setReviewsList((data || []).map((r) => ({
        id: r.reviewId,
        userName: r.userName || 'Anonymous',
        itemRated: r.productName,
        comment: r.comment || '',
        rating: r.rating,
        status: r.status || 'pending',
        rejectionReason: r.rejectionReason || '',
        date: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
        raw: r,
      })));
    } catch (err) {
      setReviewsError(err.message);
      setReviewsList([]);
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  /**
   * Approve or reject a review. The server re-derives the product's star
   * rating from its approved reviews, so nothing about the score is decided
   * here.
   */
  const updateCustomerReviewStatus = async (id, status, rejectionReason) => {
    try {
      await adminPatch(`/consumers/reviews/${id}/status`, { status, rejectionReason });
      triggerToast(status === 'approved' ? 'Review approved and published.' : `Review ${status}.`);
      addLog(`Review ${id} ${status} by admin.`);
      await fetchCustomerReviews(searchQuery, reviewStatusFilter);
      return { ok: true };
    } catch (err) {
      triggerToast(err.message);
      return { ok: false };
    }
  };

  const deleteCustomerReview = async (id) => {
    try {
      await adminDelete(`/consumers/reviews/${id}`);
      triggerToast('Review removed.');
      addLog(`Review ${id} removed by admin.`);
      await fetchCustomerReviews(searchQuery, reviewStatusFilter);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  // Vendor ecosystem health — General Vendors › Dashboard.
  const [vendorDashboard, setVendorDashboard] = useState(null);
  const [vendorDashboardLoading, setVendorDashboardLoading] = useState(false);
  const [vendorDashboardError, setVendorDashboardError] = useState('');

  const fetchVendorDashboard = useCallback(async (days = 30) => {
    setVendorDashboardLoading(true);
    setVendorDashboardError('');
    try {
      const { data } = await adminGet(`/vendor-dashboard${qs({ days })}`);
      setVendorDashboard(data || null);
    } catch (err) {
      setVendorDashboardError(err.message);
      setVendorDashboard(null);
    } finally {
      setVendorDashboardLoading(false);
    }
  }, []);

  // ==========================================================================
  // 7. DELIVERY PARTNERS — live data from GET /api/admin/delivery-partners
  //    Mock data removed; this section is fully wired to the backend.
  // ==========================================================================
  // Remembers which fleet tab is open so a refresh lands on the same list.
  const [riderStatusFilter, setRiderStatusFilter] = useState('all');

  const [riders, setRiders] = useState([]);
  const [ridersLoading, setRidersLoading] = useState(false);
  const [ridersError, setRidersError] = useState('');
  const [riderCounts, setRiderCounts] = useState({ pending: 0, approved: 0 });

  const [riderDetail, setRiderDetail] = useState(null);
  const [riderDetailLoading, setRiderDetailLoading] = useState(false);

  // State/city options for the fleet filters, served alongside the list.
  const [riderFilterOptions, setRiderFilterOptions] = useState({ states: [], cities: [] });

  /**
   * The arguments the list was last loaded with, so the Refresh button and
   * any approve/suspend can reload the exact view the admin is looking at
   * rather than resetting them to an unfiltered list.
   */
  const riderQuery = useRef({ status: 'all', search: '', state: '', city: '' });

  const fetchRiders = useCallback(async (status = 'all', search = '', { state = '', city = '' } = {}) => {
    riderQuery.current = { status, search, state, city };
    setRidersLoading(true);
    setRidersError('');
    try {
      const { data, meta } = await adminGet(`/delivery-partners${qs({ status, search, state, city, limit: 100 })}`);
      setRiders(data || []);
      if (meta?.filters) setRiderFilterOptions(meta.filters);
    } catch (err) {
      setRidersError(err.message);
      setRiders([]);
    } finally {
      setRidersLoading(false);
    }
  }, []);

  /** Reload the current view — what the Refresh button calls. */
  const refreshRiders = useCallback(() => {
    const { status, search, state, city } = riderQuery.current;
    return fetchRiders(status, search, { state, city });
  }, [fetchRiders]);

  /**
   * Fleet totals for the dashboard.
   *
   * Note `fleet` counts approved riders only — people who could actually be sent
   * out. Half-finished registrations are reported separately as `incomplete`
   * rather than being folded in to make the number look bigger.
   */
  const [fleetStats, setFleetStats] = useState(null);

  const fetchFleetStats = useCallback(async () => {
    try {
      const { data } = await adminGet('/delivery-partners/stats');
      setFleetStats(data);
    } catch {
      setFleetStats(null);
    }
  }, []);

  const fetchRiderCounts = useCallback(async () => {
    try {
      const { data } = await adminGet('/dashboard/pending-counts');
      setRiderCounts(data.delivery || { pending: 0, approved: 0 });
    } catch {
      /* badge counts are non-critical */
    }
  }, []);

  /** The full application: licence, Aadhaar, base location, zones, bank, documents. */
  const fetchRiderDetail = useCallback(async (id) => {
    setRiderDetailLoading(true);
    setRiderDetail(null);
    try {
      const { data } = await adminGet(`/delivery-partners/${id}`);
      setRiderDetail(data);
    } catch (err) {
      triggerToast(err.message);
    } finally {
      setRiderDetailLoading(false);
    }
  }, []);

  const approveRider = async (id) => {
    try {
      const { message } = await adminPatch(`/delivery-partners/${id}/approve`);
      triggerToast(message || 'Delivery partner approved.');
      addLog(`Delivery partner ${id} approved.`);
      setRiderDetail(null);
      await Promise.all([refreshRiders(), fetchRiderCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  const rejectRider = async (id, reason) => {
    // The rider is shown this text, so it cannot be blank.
    const finalReason = reason || window.prompt('Reason for rejection (the rider will see this):');
    if (!finalReason) return;
    try {
      const { message } = await adminPatch(`/delivery-partners/${id}/reject`, { reason: finalReason });
      triggerToast(message || 'Delivery partner rejected.');
      addLog(`Delivery partner ${id} rejected: ${finalReason}`);
      setRiderDetail(null);
      await Promise.all([refreshRiders(), fetchRiderCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

  // Completed/failed trips — Delivery Fleet › Completed Deliveries.
  const [deliveryHistory, setDeliveryHistory] = useState([]);
  const [deliveryHistoryLoading, setDeliveryHistoryLoading] = useState(false);
  const [deliveryHistoryError, setDeliveryHistoryError] = useState('');

  const fetchDeliveryHistory = useCallback(async (search = '') => {
    setDeliveryHistoryLoading(true);
    setDeliveryHistoryError('');
    try {
      const { data } = await adminGet(`/delivery-history${qs({ search, limit: 100 })}`);
      setDeliveryHistory(data || []);
    } catch (err) {
      setDeliveryHistoryError(err.message);
      setDeliveryHistory([]);
    } finally {
      setDeliveryHistoryLoading(false);
    }
  }, []);

  // Fleet SLA scorecard — Delivery Fleet › Delivery Performance.
  const [deliveryPerformance, setDeliveryPerformance] = useState(null);
  const [deliveryPerformanceLoading, setDeliveryPerformanceLoading] = useState(false);
  const [deliveryPerformanceError, setDeliveryPerformanceError] = useState('');

  const fetchDeliveryPerformance = useCallback(async (days = 30) => {
    setDeliveryPerformanceLoading(true);
    setDeliveryPerformanceError('');
    try {
      const { data } = await adminGet(`/delivery-performance${qs({ days })}`);
      setDeliveryPerformance(data || null);
    } catch (err) {
      setDeliveryPerformanceError(err.message);
      setDeliveryPerformance(null);
    } finally {
      setDeliveryPerformanceLoading(false);
    }
  }, []);

  // Serviceable pincode coverage — Delivery Fleet › Delivery Hub Zones.
  const [deliveryZones, setDeliveryZones] = useState(null);
  const [deliveryZonesLoading, setDeliveryZonesLoading] = useState(false);
  const [deliveryZonesError, setDeliveryZonesError] = useState('');

  const fetchDeliveryZones = useCallback(async ({ state, city, search, status } = {}) => {
    setDeliveryZonesLoading(true);
    setDeliveryZonesError('');
    try {
      const { data } = await adminGet(`/delivery-zones${qs({ state, city, search, status })}`);
      setDeliveryZones(data || null);
    } catch (err) {
      setDeliveryZonesError(err.message);
      setDeliveryZones(null);
    } finally {
      setDeliveryZonesLoading(false);
    }
  }, []);

  const suspendRider = async (id, reason) => {
    const finalReason = reason || window.prompt('Reason for suspension:');
    if (!finalReason) return;
    try {
      const { message } = await adminPatch(`/delivery-partners/${id}/suspend`, { reason: finalReason });
      triggerToast(message || 'Delivery partner suspended.');
      addLog(`Delivery partner ${id} suspended: ${finalReason}`);
      setRiderDetail(null);
      await Promise.all([refreshRiders(), fetchRiderCounts()]);
    } catch (err) {
      triggerToast(err.message);
    }
  };

 
  // 10. MORNING DISPATCH ROSTERS STATE — Mock rosters removed
  const [morningRosters, setMorningRosters] = useState([]);
 
  const dispatchRoster = (id) => {
    setMorningRosters(prev => prev.map(r => {
      if (r.id === id) {
        const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        triggerToast(`Roster #${r.id} successfully DISPATCHED.`);
        addLog(`Morning delivery roster #${r.id} dispatched at ${time}.`);
        return { ...r, status: 'Dispatched', dispatchTime: time, slaStatus: 'On Time' };
      }
      return r;
    }));
  };

  return (
    <AdminContext.Provider value={{
      activeTab: activeTabInternal,
      setActiveTab,
      toastMessage,
      triggerToast,
      searchQuery,
      setSearchQuery,
      filterStatus,
      setFilterStatus,
      logs,
      sellers,
      sellersLoading,
      sellersError,
      sellerCounts,
      sellerDetail,
      sellerDetailLoading,
      sellerStatusFilter,
      setSellerStatusFilter,
      fetchSellers,
      fetchSellerCounts,
      fetchSellerDetail,
      setSellerDetail,
      approveSeller,
      rejectSeller,
      suspendSeller,
      setSellerRadius,
      setSellerWholesaleStatus,
      fetchRadiusSettings,
      setRadiusSettings,
      fetchReferralSettings,
      setReferralSettings,
      fetchReferralsAdmin,
      fetchReferralCostReport,
      blockReferralAdminAction,
      approveReferralAdminAction,
      products,
      productsLoading,
      productsError,
      productFilters,
      setProductFilters,
      fetchAdminProducts,
      restoreProduct,
      takeDownProduct,
      toggleProductFeatured,
      toggleProductSponsored,
      payouts,
      processPayout,
      riderPayouts,
      riderPayoutsLoading,
      riderPayoutsError,
      fetchRiderPayouts,
      settleRiderPayout,
      tickets,
      ticketsLoading,
      ticketsError,
      ticketCategoryFilter, setTicketCategoryFilter,
      ticketRoleFilter, setTicketRoleFilter,
      ticketDetail, ticketMessages, ticketDetailLoading,
      fetchTickets,
      openTicketDetail,
      replyToTicket,
      addInternalNote,
      assignTicketToSelf,
      changeTicketStatus,
      resolveTicket,

      // Platform Overview dashboard
      dashboardOverview,
      dashboardOverviewLoading,
      fetchDashboardOverview,

      // Users & SHG
      users,
      usersLoading,
      usersError,
      fetchUsers,
      approveUserKyc,
      consumerLocations,
      fetchConsumerLocations,
      consumerStats,
      fetchConsumerStats,
      consumerOrdersSummary,
      fetchConsumerOrdersSummary,
      activityLogs,
      activityLogsLoading,
      fetchCustomerActivityLog,
      customerOrders,
      customerOrdersLoading,
      customerOrdersMeta,
      fetchCustomerOrders,
      reviewsList,
      reviewsLoading,
      reviewsError,
      reviewStatusFilter,
      setReviewStatusFilter,
      fetchCustomerReviews,
      updateCustomerReviewStatus,
      deleteCustomerReview,
      // Delivery
      riders,
      ridersLoading,
      ridersError,
      riderCounts,
      fleetStats,
      fetchFleetStats,
      riderStatusFilter,
      setRiderStatusFilter,
      fetchRiders,
      refreshRiders,
      riderFilterOptions,
      fetchRiderCounts,
      riderDetail,
      riderDetailLoading,
      fetchRiderDetail,
      setDeliveryPartnerRadius,
      setRiderDetail,
      approveRider,
      rejectRider,
      suspendRider,
      morningRosters,
      dispatchRoster,
      deliveryHistory,
      deliveryHistoryLoading,
      deliveryHistoryError,
      fetchDeliveryHistory,
      deliveryPerformance,
      deliveryPerformanceLoading,
      deliveryPerformanceError,
      vendorDashboard,
      vendorDashboardLoading,
      vendorDashboardError,
      fetchVendorDashboard,

      fetchDeliveryPerformance,
      deliveryZones,
      deliveryZonesLoading,
      deliveryZonesError,
      fetchDeliveryZones,

      // Modal selection wrappers
      selectedSeller,
      setSelectedSeller,
      selectedProduct,
      setSelectedProduct,
      selectedPayout,
      setSelectedPayout,
      adminNotifications, adminUnreadCount, adminNotifLoading,
      fetchAdminNotifications, fetchAdminUnreadCount, markAdminNotificationRead,
      selectedTicket,
      setSelectedTicket,
      ticketReply,
      setTicketReply
    }}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = () => useContext(AdminContext);

export default AdminContext;
