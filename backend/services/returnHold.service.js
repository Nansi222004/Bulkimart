// Only the purchased policy controls a hold. Current catalogue policy is never read.
export const returnHoldOpen = (item, now = new Date()) => {
  if (!item?.deliveredAt || !Number.isFinite(new Date(item.deliveredAt).getTime())) return true;
  const policy = item.returnPolicy;
  if (policy?.returnEligible === false || policy?.returnWindowDays === 0) return false;
  if (item.returnEligibleUntil) return !Number.isFinite(new Date(item.returnEligibleUntil).getTime()) || new Date(item.returnEligibleUntil) > now;
  if (policy?.returnEligible) {
    if (!(policy.returnWindowDays > 0)) return true;
    return new Date(item.deliveredAt).getTime() + policy.returnWindowDays * 86400000 > now.getTime();
  }
  return false;
};
