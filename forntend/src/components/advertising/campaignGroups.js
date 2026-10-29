// Turning the products a seller ticks into campaigns: one normal campaign per category of the chosen
// storefront. The server checks the same rules again when each campaign is saved and submitted.

// A datetime-local value (local time, to the minute) for a date.
export const localInput = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
// The earliest start a seller can pick: the next whole minute, so today stays selectable but no past time.
export const earliestStart = () => localInput(new Date(Math.ceil(Date.now() / 60000) * 60000));
export const validStart = value => Boolean(value) && Number.isFinite(new Date(value).getTime()) && new Date(value) >= new Date(earliestStart());

// Seller-facing names for the package terms shown before submitting.
export const TERM_LABELS = { sellerPause: 'Pausing', cancellation: 'Cancelling', rejection: 'If rejected', suspension: 'Suspension', unusedService: 'If your ad cannot be shown', refunds: 'Refunds' };

// The categories a campaign may use for a product, most specific first (from the products list).
const placements = product => product.adCategories?.length ? product.adCategories : product.categories || [];
export const defaultCategory = product => String(placements(product)[0]?.id || '');

// selected: [{ product, variantId }] in the order ticked; assigned: { productId: categoryId } set when
// the seller moves a group to a parent category. Products with the same category form one group.
export function campaignGroups(selected, assigned = {}) {
  const groups = new Map();
  for (const item of selected) {
    const id = String(assigned[item.product.id] || defaultCategory(item.product));
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { categoryId: id, items: [] });
    groups.get(id).items.push(item);
  }
  const list = [...groups.values()].map(group => {
    const lists = group.items.map(i => placements(i.product));
    const category = lists.flat().find(c => String(c.id) === group.categoryId) || { id: group.categoryId, name: 'Category' };
    // A group may only move to a category every one of its products allows.
    const options = lists[0].filter(c => lists.every(l => l.some(x => String(x.id) === String(c.id))));
    return { ...group, category, options };
  });
  // Two categories with the same name (under different parents) are told apart by their parent.
  return list.map(group => ({ ...group, label: list.some(g => g !== group && g.category.name === group.category.name) && group.category.parentName
    ? `${group.category.parentName} › ${group.category.name}` : group.category.name }));
}

export const campaignName = (base, label) => {
  const suffix = ` – ${label}`;
  return `${base.trim().slice(0, Math.max(1, 200 - suffix.length))}${suffix}`.slice(0, 200);
};

// Packages for one group: the storefront's live packages for its category, and of those the ones whose
// "Products per ad" covers the group (the same checks the server makes on save and submission).
export function packagesFor(packages, module, group) {
  const inCategory = packages.filter(p => p.module === module && p.isActive && !p.archivedAt && (!p.categories?.length || p.categories.map(String).includes(group.categoryId)));
  return { inCategory, fitting: inCategory.filter(p => p.maxProducts >= group.items.length) };
}

// The price as the server quotes it for a package; GST is shown only when the package sets it.
export const packagePrice = p => p?.billingQuote
  ? { base: p.billingQuote.basePaise, tax: p.billingQuote.taxPaise, total: p.billingQuote.totalPaise }
  : { base: p?.amountPaise || 0, tax: null, total: p?.amountPaise || 0 };

// A key for one campaign's create request; the server returns the same campaign when it is resent.
export const requestKey = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, '');
