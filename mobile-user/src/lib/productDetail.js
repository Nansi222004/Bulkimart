// Short-lived shared copy of GET /api/products/:id.
// The product page, its extras and "Add to cart" all read the same record within a few seconds; each read was a
// separate ~0.8 s round trip, so adding from the product page waited on a third identical request. Results are
// reused for 30 s and concurrent reads share one request. The cart API still validates every add on the server.
import { request } from '../api/client';

const TTL_MS = 30000;
const entries = new Map();

/** Store a detail body that was fetched elsewhere (e.g. the product page's own loader). */
export function rememberProductDetail(id, body) {
  if (id && body) entries.set(String(id), { at: Date.now(), promise: Promise.resolve({ ok: true, body }) });
}

/** `{ ok, body }` for the product, from the shared copy when it is fresh. */
export function fetchProductDetail(id) {
  const key = String(id);
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = request(`/api/products/${key}`, { auth: false }).then(result => {
    if (!result.ok) entries.delete(key);
    return result;
  }, error => { entries.delete(key); throw error; });
  entries.set(key, { at: Date.now(), promise });
  return promise;
}
