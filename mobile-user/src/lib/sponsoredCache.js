// Short-lived shared answers from GET /api/advertising/placements, so a header-category page can show its
// sponsored row (and its grid) immediately when the answer was already fetched in the background.
// Impressions and clicks are still reported only when a card is actually seen or tapped.
import { boundedFetch } from '../api/client';

const TTL_MS = 20000;
const entries = new Map();

export function sponsoredQuery(channel, categoryId, point) {
  const query = new URLSearchParams({ type: channel, category: categoryId });
  if (Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) { query.set('lat', String(point.lat)); query.set('lng', String(point.lng)); }
  return query.toString();
}

/** `{ ok, body }` for the placements request, shared for 20 s. */
export function fetchSponsored(query, { fresh = false } = {}) {
  const hit = entries.get(query);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = boundedFetch(`/api/advertising/placements?${query}`, {}, 4000)
    .then(async response => { const value = { ok: response.ok, body: await response.json().catch(() => ({})) }; const entry = entries.get(query); if (entry?.promise === promise) entry.value = value; return value; })
    .catch(error => { entries.delete(query); throw error; });
  entries.set(query, { at: Date.now(), promise });
  if (entries.size > 30) entries.delete(entries.keys().next().value);
  return promise;
}

/** The answer already received for this query (and still fresh), for an instant first render; otherwise null. */
export function peekSponsored(query) {
  const hit = entries.get(query);
  return hit?.value && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

let currentPoint = null;
/** The delivery point used for prefetches, so they match what the page will ask for. */
export const setSponsoredPoint = point => { currentPoint = point || null; };
export const prefetchSponsored = (channel, categoryId) => { fetchSponsored(sponsoredQuery(channel, categoryId, currentPoint)).catch(() => {}); };
