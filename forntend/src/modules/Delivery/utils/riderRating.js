export const riderRatingSummary = profile => {
  const count = Number(profile?.ratingCount) || 0;
  const rating = Number(profile?.rating);
  return count > 0 && Number.isFinite(rating)
    ? { value: `${rating.toFixed(1)} / 5`, count: `${count} customer ${count === 1 ? 'rating' : 'ratings'}` }
    : { value: 'Not rated yet', count: 'No customer ratings yet' };
};
