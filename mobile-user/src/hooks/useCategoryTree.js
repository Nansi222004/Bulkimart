import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { apiUrl, boundedFetch } from '../api/client';
import { on, EVENTS } from '../lib/events';

/**
 * The admin's category tree for one storefront, shared for a short interval.
 *
 * Five landing sections need to know which category they represent. Each of them
 * asking the server would be five identical requests for a tree that changes
 * about as often as the shop's signage, so the answer is shared: the first
 * caller starts the request and everyone else — including components that mount
 * later, or mount again after a navigation — waits on that same promise.
 * Expired trees refresh when the app is visible so an empty first response
 * cannot hide categories published later in the same app session.
 *
 * Header → Main → Subcategory is preserved exactly as the server sends it. This
 * flattens nothing; it only indexes the tree so a section can find its own node
 * by slug and ask for everything filed underneath it.
 */

/**
 * Two caches, deliberately.
 *
 * They were one, and it was a bug: the entry started out as a promise and was
 * then overwritten with the resolved array, so the second caller got an array
 * where it expected something thenable and the section crashed. A cache whose
 * value changes type is a cache with two meanings, so each meaning now has its
 * own map — `inflight` is always a promise, `resolved` is always a tree.
 */
const inflight = new Map();   // channel -> Promise<tree>
const resolved = new Map();   // channel -> tree, once it has arrived
const expires = new Map();
const CACHE_MS = 30000;

const fetchTree = (type) => {
  const existing = inflight.get(type);
  if (existing) return existing;

  const p = boundedFetch(apiUrl(`/api/categories/tree?type=${type}`))
    .then((res) => {
      if (!res.ok) throw new Error(`Categories unavailable (${res.status})`);
      return res.json();
    })
    // The tree endpoint answers with a bare array, not the {success,data} envelope.
    .then((data) => {
      if (!Array.isArray(data)) throw new Error('Categories returned an invalid response');
      const previous = resolved.get(type);
      const tree = previous && JSON.stringify(previous) === JSON.stringify(data) ? previous : data;
      resolved.set(type, tree);
      expires.set(type, Date.now() + CACHE_MS);
      return tree;
    })
    .finally(() => {
      if (inflight.get(type) === p) inflight.delete(type);
    });

  inflight.set(type, p);
  return p;
};

/** Depth-first walk over Header → Main → Sub. */
const walk = function* (nodes) {
  for (const node of nodes || []) {
    yield node;
    yield* walk(node.children);
  }
};

/**
 * Every category id at or beneath one node.
 *
 * Products are filed against leaves, so "show me Men's Wear" means "show me
 * Shirts, Kurtas and Trousers". Returning the branch node's own id too costs
 * nothing and covers a catalogue that files directly against a main category.
 */
export const descendantIds = (node) => (node ? [...walk([node])].map((n) => n._id) : []);

export const findBySlug = (tree, slug) => {
  for (const node of walk(tree)) if (node.slug === slug) return node;
  return null;
};

/**
 * @param {'grocery'|'ecommerce'} type  the storefront — never mixed
 */
export const useCategoryTree = (type) => {
  // A tree already in hand paints on the first frame instead of flashing empty.
  const [tree, setTree] = useState(() => resolved.get(type) || []);
  const [loading, setLoading] = useState(() => !resolved.has(type));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loadedType, setLoadedType] = useState(type);

  useEffect(() => {
    let cancelled = false;

    const known = resolved.get(type);
    setTree(known || []);
    setLoadedType(type);
    setLoading(!known);
    setError('');
    const refresh = () => {
      if ((expires.get(type) || 0) > Date.now()) {
        // Another section may have refreshed the shared cache since this one
        // last rendered. Adopt that result even when no request is necessary.
        setTree(resolved.get(type) || []); setLoading(false); setError('');
        return;
      }
      fetchTree(type)
        .then((data) => { if (!cancelled) { setTree(data); setError(''); } })
        .catch((err) => { if (!cancelled) setError(err.message || 'Could not load categories'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    const visible = () => { if (AppState.currentState === 'active') refresh(); };
    refresh();
    const appState = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    const stopOnline = on(EVENTS.ONLINE, refresh);
    const timer = setInterval(visible, CACHE_MS);
    return () => {
      cancelled = true; clearInterval(timer);
      appState.remove();
      stopOnline();
    };
  }, [type, attempt]);

  const retry = () => {
    resolved.delete(type);
    expires.delete(type);
    setAttempt((value) => value + 1);
  };

  return { tree: loadedType === type ? tree : [], loading: loadedType !== type || loading, error, retry };
};

/**
 * The category ids a section should ask for, by slug.
 *
 * Returns null categoryParam and exists: false when the slug is not in the tree,
 * preventing sections from accidentally querying all store products when a category
 * is deleted or unpublished.
 */
export const useCategoryBranch = (type, slug) => {
  const { tree, loading, error, retry } = useCategoryTree(type);
  const node = loading || !slug ? null : findBySlug(tree, slug);
  const ids = node ? descendantIds(node) : null;

  return {
    node,
    loading,
    error,
    retry,
    exists: Boolean(node),
    /** Ready for useProducts({ category }) — a comma list the API reads as a branch. */
    categoryParam: ids && ids.length ? ids.join(',') : null,
  };
};

/** Forget everything cached, so the next read goes to the server (pull-down refresh, and tests start cold). */
export const clearCategoryCache = () => { inflight.clear(); resolved.clear(); expires.clear(); };
export const __resetCategoryCache = clearCategoryCache;

export default useCategoryTree;
