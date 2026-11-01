import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads one server resource with loading / refreshing / error state.
 * loader() returns a promise. Stale results (after unmount or a newer load) are dropped.
 */
export default function useApiResource(loader, deps = [], { enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // `deps` is the caller's dependency list for `loader` (same contract as useCallback).
  const run = useCallback(async (mode = 'load') => {
    const current = ++generation.current;
    if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await loader();
      if (mounted.current && current === generation.current) setData(result);
      return result;
    } catch (e) {
      if (mounted.current && current === generation.current) { setData(null); setError(e?.message || 'Could not load data'); }
      return null;
    } finally {
      if (mounted.current && current === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (enabled) run('load'); }, [enabled, run]);

  const reload = useCallback(() => run('load'), [run]);
  const refresh = useCallback(() => run('refresh'), [run]);
  return { data, error, loading, refreshing, reload, refresh, setData };
}
