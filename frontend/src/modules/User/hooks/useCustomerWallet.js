import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import { socket } from '../../../utils/socket';

export default function useCustomerWallet({ active, userId, onBalance }) {
  const [data, setData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0), controller = useRef(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current, session = captureUserSession();
    controller.current?.abort();
    if (!session.token) { setData(null); setTransactions([]); setLoading(false); return; }
    const abort = new AbortController(); controller.current = abort;
    const current = () => request === generation.current && isCurrentUserSession(session);
    setLoading(true); setError('');
    try {
      const read = async path => {
        const response = await boundedFetch(apiUrl(path), { signal: abort.signal, cache: 'no-store', headers: { Authorization: `Bearer ${session.token}` } });
        const body = await response.json();
        if (!response.ok || body.success === false) throw new Error(body.message || 'Could not refresh your wallet. Please retry.');
        return body.data;
      };
      const [wallet, history] = await Promise.all([read('/api/wallet'), read('/api/wallet/transactions?limit=20')]);
      if (!current()) return;
      if (!Number.isFinite(wallet?.balance) || wallet.balance < 0 || !Array.isArray(history)) throw new Error('Could not refresh your wallet. Please retry.');
      setData(wallet); setTransactions(history); onBalance?.(wallet.balance);
    } catch (err) {
      if (current()) setError(err.message || 'Could not refresh your wallet. Please retry.');
    } finally { if (current()) setLoading(false); }
  }, [userId, onBalance]);

  useEffect(() => {
    setData(null); setTransactions([]);
  }, [userId]);
  useEffect(() => {
    void refresh();
    const cancel = () => { generation.current++; controller.current?.abort(); };
    if (!active) return cancel;
    const update = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const notification = n => { if (['REFUND_COMPLETED', 'WALLET_CREDIT', 'WALLET_DEBIT', 'PARCEL_UPDATED'].includes(n?.event)) update(); };
    // Polling also recovers a notification missed while the app was offline.
    const timer = setInterval(update, 10000);
    socket.on('notification_new', notification); socket.on('connect', update);
    window.addEventListener('focus', update); window.addEventListener('online', update);
    document.addEventListener?.('visibilitychange', update);
    return () => {
      cancel();
      clearInterval(timer); socket.off('notification_new', notification); socket.off('connect', update);
      window.removeEventListener('focus', update); window.removeEventListener('online', update);
      document.removeEventListener?.('visibilitychange', update);
    };
  }, [active, refresh]);
  return { data, transactions, loading, error, refresh };
}
