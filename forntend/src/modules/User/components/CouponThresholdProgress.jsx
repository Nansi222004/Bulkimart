import React from 'react';
import './CouponThresholdProgress.css';

const money = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const benefit = offer => {
  if (offer.discountType === 'free_shipping') return 'free delivery';
  if (offer.discountType === 'percentage') return `${offer.value}% off${offer.maxDiscount > 0 ? ` (up to ${money(offer.maxDiscount)})` : ''}`;
  if (offer.discountType === 'fixed') return `${money(offer.value)} off`;
  return null;
};

export default function CouponThresholdProgress({ offers = [], onShopMore, appliedCode }) {
  if (appliedCode) return null;
  const offer = offers.find(item => item.threshold && benefit(item));
  if (!offer) return null;
  const { minimumOrderValue, eligibleOrderValue, remainingAmount, progressPercentage } = offer.threshold;
  if (!(minimumOrderValue > 0) || !Number.isFinite(progressPercentage)) return null;
  const unlocked = remainingAmount <= 0;
  return <section className="coupon-threshold" aria-label={`${offer.code} coupon progress`}>
    <strong>{unlocked ? `You've unlocked ${benefit(offer)}!` : `Add ${money(remainingAmount)} more to unlock ${benefit(offer)}.`}</strong>
    <div className="coupon-threshold-track" role="progressbar" aria-valuemin={0} aria-valuemax={minimumOrderValue} aria-valuenow={Math.min(eligibleOrderValue, minimumOrderValue)} aria-label={`Order value for ${offer.code}`}>
      <span style={{ width: `${progressPercentage}%` }} />
    </div>
    <div className="coupon-threshold-foot"><small>{money(eligibleOrderValue)} of {money(minimumOrderValue)} · {offer.code}</small>{!unlocked && <button type="button" onClick={() => onShopMore?.(offer)}>Shop More →</button>}</div>
  </section>;
}
