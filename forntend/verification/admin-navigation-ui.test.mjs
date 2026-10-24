import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Sidebar, Header, Provider;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Sidebar = (await vite.ssrLoadModule('/src/modules/Admin/components/LeftSidebar.jsx')).default;
  Header = (await vite.ssrLoadModule('/src/modules/Admin/components/TopHeader.jsx')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/Admin/context/AdminContext.jsx')).AdminProvider;
});
after(async () => vite.close());
const storage = { localStorage: { getItem: () => null } };
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
function all(node, predicate, found = []) { if (node && typeof node === 'object') { if (predicate(node)) found.push(node); for (const child of [node.props?.children].flat(Infinity)) all(child, predicate, found); } return found; }
for (const activeTab of ['overview', 'reports', 'user-dashboard', 'vendor-dashboard', 'delivery-dashboard', 'delivery-active', 'storefront-studio', 'banners', 'categories-header', 'finance-center']) test(`${activeTab} retains the normal admin sidebar`, () => {
  const h = hookHarness(Sidebar, { collapsed: false, setCollapsed() {} }, '/admin/' + activeTab, { activeTab, setActiveTab() {} }, storage);
  try {
    for (const title of ['Dashboard', 'Reports', 'Users', 'Sellers / Vendors', 'Products', 'Delivery Partners', 'Delivery Zones', 'Storefront Studio', 'Banners', 'Support Tickets', 'Finance Center']) assert.ok(h.find(n => n.type === 'button' && n.props.title === title), title);
    assert.doesNotMatch(text(h.tree), /Show All Sidebar Groups/);
    const groups = all(h.tree, n => n.props?.className === 'sa-nav-group-title').map(text);
    assert.deepEqual(groups, ['Platform', 'User Management', 'Vendor Management', 'Product Management', 'Order Management', 'Delivery Management', 'Marketing & CMS', 'Returns & Refunds', 'Settings', 'FINANCE']);
    assert.equal(all(h.tree, n => n.type === 'button' && n.props.title === 'Finance Center').length, 1);
    const parent = h.find(n => n.type === 'button' && n.props.title === (activeTab === 'storefront-studio' ? 'Storefront Studio' : 'Delivery Partners'));
    if (activeTab === 'storefront-studio' || activeTab.startsWith('delivery-')) assert.match(parent.props.className, /active/);
  } finally { h.close(); }
});
test('delivery subpages remain reachable beneath the parent without replacing the sidebar', () => {
  let selected;
  const h = hookHarness(Sidebar, { collapsed: false, setCollapsed() {} }, '/admin/deliverypartner', { activeTab: 'delivery-dashboard', setActiveTab: id => selected = id }, storage);
  try {
    for (const title of ['All Partners', 'Pending Applications', 'Active Partners', 'Suspended Partners', 'Active Deliveries', 'Order Assignment', 'Delivery Tracking', 'Completed Deliveries', 'Delivery Performance']) assert.ok(h.find(n => n.type === 'button' && n.props.title === title), title);
    h.find(n => n.type === 'button' && n.props.title === 'Delivery Tracking').props.onClick(); assert.equal(selected, 'delivery-tracking');
    h.find(n => n.type === 'button' && n.props.title === 'Reports').props.onClick(); assert.equal(selected, 'reports');
  } finally { h.close(); }
});
for (const path of ['/admin/deliverypartner', '/admin/delivery-dashboard', '/admin/delivery-partners']) test(`${path} opens the existing fleet page at the canonical URL`, () => {
  const h = hookHarness(Provider, {}, path + '?status=active', undefined, storage);
  try { assert.equal(h.tree.props.value.activeTab, 'delivery-dashboard'); assert.equal(window.location.pathname, '/admin/deliverypartner'); assert.equal(window.location.search, '?status=active'); } finally { h.close(); }
});
test('sidebar navigation, reports and history keep the selected page and URL synchronized', () => {
  const h = hookHarness(Provider, {}, '/admin', undefined, storage);
  try {
    h.tree.props.value.setActiveTab('delivery-partners'); h.flush(); assert.equal(window.location.pathname, '/admin/deliverypartner'); assert.equal(h.tree.props.value.activeTab, 'delivery-dashboard');
    h.tree.props.value.setActiveTab('reports'); h.flush(); assert.equal(window.location.pathname, '/admin/reports'); assert.equal(h.tree.props.value.activeTab, 'reports');
    window.history.replaceState(null, '', '/admin/delivery-dashboard'); window.dispatchEvent(new Event('popstate')); h.flush(); assert.equal(window.location.pathname, '/admin/deliverypartner'); assert.equal(h.tree.props.value.activeTab, 'delivery-dashboard');
    h.tree.props.value.setActiveTab('overview'); h.flush(); assert.equal(window.location.pathname, '/admin');
    assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});
test('shared header names the actual module instead of always showing Dashboard', () => {
  const previous = globalThis.document; globalThis.document = new EventTarget();
  try {
    for (const [activeTab, title] of [['overview', 'Dashboard'], ['reports', 'Reports'], ['delivery-dashboard', 'Delivery Partners'], ['storefront-studio', 'Storefront Studio']]) {
      const h = hookHarness(Header, {}, '/admin', { activeTab, setActiveTab() {} }, storage);
      try { assert.equal(text(h.find(n => n.props?.className === 'sa-header-title')), title); } finally { h.close(); }
    }
  } finally { if (previous) globalThis.document = previous; else delete globalThis.document; }
});
