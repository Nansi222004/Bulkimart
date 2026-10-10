/**
 * The one place a product's rating rollup is computed.
 *
 * `ratings.average`/`ratings.count` are a cache of the embedded reviews, and
 * three separate paths change what that cache should say: a shopper posting
 * a review, an admin approving or rejecting one, and an admin deleting one.
 * Three copies of this arithmetic is three chances for the star rating on a
 * product card to disagree with the reviews listed underneath it — this
 * codebase has paid for that kind of drift before, so there is one copy.
 *
 * Only APPROVED reviews count. A pending review must not move a product's
 * score before anyone has looked at it, and a rejected one must not leave a
 * mark behind after it has been turned down.
 */

/** Approved reviews only — what the public sees and what the score is built from. */
export const approvedReviewsOf = (product) =>
  (product?.ratings?.reviews || []).filter((r) => r.status === 'approved');

/**
 * Recompute `ratings.average`/`ratings.count` in place from approved reviews.
 * Does not save — the caller owns the write, and often has other changes to
 * commit in the same save.
 *
 * @returns {{average: number, count: number}} what it set
 */
export const applyApprovedRatings = (product) => {
  const approved = approvedReviewsOf(product);
  const count = approved.length;
  const average = count
    ? Number((approved.reduce((sum, r) => sum + Number(r.rating || 0), 0) / count).toFixed(2))
    : 0;

  product.ratings.count = count;
  product.ratings.average = average;

  return { average, count };
};

/**
 * How many reviews sit at each star, 1 through 5, plus each as a percentage
 * of the total — what the distribution bars on a product page render.
 *
 * Percentages are of the approved total, so an empty product reports zeroes
 * rather than dividing by zero.
 */
export const ratingBreakdownOf = (product) => {
  const approved = approvedReviewsOf(product);
  const total = approved.length;

  return [5, 4, 3, 2, 1].map((star) => {
    const count = approved.filter((r) => Number(r.rating) === star).length;
    return {
      star,
      count,
      percent: total ? Math.round((count / total) * 100) : 0,
    };
  });
};
