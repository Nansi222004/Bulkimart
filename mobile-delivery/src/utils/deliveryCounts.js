/**
 * The rider's lifetime trip counts, shared by Profile, Duty and Earnings so all three show the same number.
 * The earnings summary carries both counts from one moment (orders + return pickups, and parcels); before,
 * each screen added a profile count and a summary count that could be refreshed at different times.
 * Falls back to the profile count when the summary has not loaded (or comes from an older server).
 */
export function deliveryCounts(profile, summary) {
  const fromSummary = summary?.deliveries;
  if (fromSummary && Number.isFinite(fromSummary.total)) return fromSummary;
  const ordersAndReturns = Number(profile?.totalDeliveries) || 0;
  const parcels = Number(summary?.parcels?.lifetimeTrips) || 0;
  return { ordersAndReturns, parcels, total: ordersAndReturns + parcels };
}
