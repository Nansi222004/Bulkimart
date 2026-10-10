/**
 * Standard response envelope: { success, data, message, meta }
 *
 * Every endpoint written from Day 1 Block 0 onward must use these helpers.
 * The six pre-existing controllers still return mixed shapes (some bare arrays);
 * they are retrofitted in Day 2 Block 7.3.
 */

export const ok = (res, data, message = '', meta = {}) =>
  res.status(200).json({ success: true, data, message, meta });

export const created = (res, data, message = '') =>
  res.status(201).json({ success: true, data, message, meta: {} });

/**
 * @param {object} page  { page, limit, total }
 */
export const paginated = (res, data, { page = 1, limit = 20, total = 0, ...extra }) =>
  res.status(200).json({
    success: true,
    data,
    message: '',
    meta: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)) || 0,
      // callers may add their own summary figures (e.g. totalDiscount)
      ...extra,
    },
  });

/** Normalises ?page=&limit= into safe numbers plus a mongo skip. */
export const getPagination = (query, defaultLimit = 20, maxLimit = 100) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Throw a plain error carrying an HTTP status the error middleware can read.
 * `meta` is optional and additive — most call sites never pass it — but it
 * lets a specific error carry a machine-readable reason code (e.g.
 * `{ code: 'SUBSCRIPTION_REQUIRED' }`) for a client to branch on instead of
 * parsing the human-readable `message` string.
 */
export const httpError = (status, message, meta) =>
  Object.assign(new Error(message), { status, meta });
