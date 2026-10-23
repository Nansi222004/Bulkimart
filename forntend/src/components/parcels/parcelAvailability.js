// Keep discovery and the booking form aligned with the server's prerequisites.
export function parcelBookingEnabled(flags) {
  return ['catalogue', 'booking', 'auto_assignment', 'admin_fallback', 'fulfilment'].every(key => flags?.[key] === true)
    && flags.productionBlocked === false && (flags.online_payment === true || flags.pay_driver === true);
}

export function parcelBookingReady(flags, policy) {
  return parcelBookingEnabled(flags) && policy?.ready === true
    && policy.areas?.length > 0 && policy.categories?.length > 0
    && Array.isArray(policy.prohibitedItems)
    && (flags.online_payment === true || (policy.payDriverEnabled === true && policy.payDriverCategories?.some(category => policy.categories.includes(category))));
}
