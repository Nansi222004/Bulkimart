// Warms the header-category pages in the background so tapping a category in the header opens with its products
// already loaded. Uses exactly the requests DynamicCategorySection makes (same URLs), which readCatalog shares.
import { useEffect } from 'react';
import { apiUrl } from '../api/client';
import { readCatalog } from './useProducts';
import { descendantIds, findBySlug, useCategoryTree } from './useCategoryTree';
import { prefetchSponsored } from '../lib/sponsoredCache';

export function usePrefetchHeaderCategories(channel, headerCategories = []) {
  const { tree, loading } = useCategoryTree(channel);
  const slugs = headerCategories.map(c => c.slug).filter(Boolean).join(',');
  useEffect(() => {
    if (loading || !slugs) return undefined;
    // After the visible page has had its turn on the network.
    const timer = setTimeout(() => {
      for (const slug of slugs.split(',')) {
        const node = findBySlug(tree, slug);
        if (!node) continue;
        const ids = descendantIds(node);
        if (!ids.length) continue;
        const qs = new URLSearchParams({ type: channel, category: ids.join(','), limit: '200' });
        readCatalog(apiUrl(`/api/products?${qs}`)).catch(() => {});
        prefetchSponsored(channel, node._id);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [channel, slugs, loading, tree]);
}
