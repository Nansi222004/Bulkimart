import { useCallback, useEffect, useMemo, useState } from 'react';
import useApiResource from './useApiResource';
import { listSellerOrders } from '../services/seller.api';

const PAGE_SIZE = 100; // The server's maximum page size for GET /api/sellers/orders.
const rowsOf = (body) => (Array.isArray(body?.data) ? body.data : []);

// The seller's orders, newest first: the first page loads with the screen, older pages load on
// request ("Load older orders"), so sellers with more than 100 orders can still reach every one.
// `type` limits to one storefront (grocery / ecommerce); undefined = all.
export default function usePagedSellerOrders(type) {
  const loader = useCallback(async () => {
    const body = await listSellerOrders({ type, status: 'all', limit: PAGE_SIZE, page: 1 });
    return { rows: rowsOf(body), total: Number(body?.meta?.total) || 0 };
  }, [type]);
  const resource = useApiResource(loader, [loader]);
  const first = resource.data;

  const [older, setOlder] = useState([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  // A fresh first page (refresh, storefront change) starts the older pages over.
  useEffect(() => { setOlder([]); setPage(1); setMoreError(''); }, [first]);

  const list = useMemo(() => {
    const seen = new Set();
    return [...(first?.rows || []), ...older].filter((o) => !seen.has(String(o._id)) && seen.add(String(o._id)));
  }, [first, older]);
  const total = Math.max(first?.total || 0, list.length);
  const hasMore = list.length < total;

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setMoreError('');
    try {
      const next = page + 1;
      const body = await listSellerOrders({ type, status: 'all', limit: PAGE_SIZE, page: next });
      setOlder((prev) => [...prev, ...rowsOf(body)]);
      setPage(next);
    } catch (e) {
      setMoreError(e.message || 'Could not load older orders');
    } finally { setLoadingMore(false); }
  }, [loadingMore, hasMore, page, type]);

  return { ...resource, list, total, hasMore, loadMore, loadingMore, moreError };
}
