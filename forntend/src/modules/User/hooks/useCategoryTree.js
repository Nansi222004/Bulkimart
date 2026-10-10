import { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * The admin's category tree for one storefront, fetched once and shared.
 *
 * Five landing sections need to know which category they represent. Each of them
 * asking the server would be five identical requests for a tree that changes
 * about as often as the shop's signage, so the answer is shared: the first
 * caller starts the request and everyone else — including components that mount
 * later, or mount again after a navigation — waits on that same promise.
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

const fetchTree = (type) => {
  const existing = inflight.get(type);
  if (existing) return existing;

  const p = fetch(apiUrl(`/api/categories/tree?type=${type}`))
    .then((res) => {
      if (!res.ok) throw new Error(`Categories unavailable (${res.status})`);
      return res.json();
    })
    // The tree endpoint answers with a bare array, not the {success,data} envelope.
    .then((data) => {
      const tree = Array.isArray(data) ? data : [];
      resolved.set(type, tree);
      return tree;
    })
    .catch((err) => {
      // A failed fetch must not become a permanent empty tree: forget it so the
      // next mount tries again rather than showing an empty shop forever.
      inflight.delete(type);
      throw err;
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

  useEffect(() => {
    let cancelled = false;

    const known = resolved.get(type);
    if (known) { setTree(known); setLoading(false); setError(''); return undefined; }

    setLoading(true);
    setError('');

    fetchTree(type)
      .then((data) => { if (!cancelled) setTree(data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load categories');
        setTree([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [type, attempt]);

  const retry = () => {
    inflight.delete(type);
    resolved.delete(type);
    setAttempt((value) => value + 1);
  };

  return { tree, loading, error, retry };
};

/**
 * The category ids a section should ask for, by slug.
 *
 * Returns `undefined` while the tree is loading or when the slug is not in it —
 * and `undefined` means "no filter", so a section falls back to its previous
 * behaviour rather than rendering an empty grid because a category was renamed.
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
    /** Ready for useProducts({ category }) — a comma list the API reads as a branch. */
    categoryParam: ids && ids.length ? ids.join(',') : undefined,
  };
};

/** Testing seam: forget everything cached, so a run starts cold. */
export const __resetCategoryCache = () => { inflight.clear(); resolved.clear(); };

export default useCategoryTree;
