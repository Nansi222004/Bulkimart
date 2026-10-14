import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';

const DigitalLibraryPage = () => {
  const { setActiveNav } = useUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('userToken') || ''}` });

  useEffect(() => {
    let alive = true;
    fetch(apiUrl('/api/digital/library'), { headers: headers() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Could not load your e-books');
        if (alive) setItems(body.data || []);
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const download = async (entry) => {
    setDownloading(entry.id);
    setError('');
    try {
      const response = await fetch(apiUrl(`/api/digital/library/${entry.id}/download`), { headers: headers() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Download is temporarily unavailable');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${entry.product?.name || 'ebook'}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="orders-page-container">
      <div className="orders-header-row">
        <button className="back-arrow-btn" onClick={() => setActiveNav('account')} aria-label="Back to account">‹</button>
        <h2 className="orders-page-title">MY E-BOOKS</h2>
        <div style={{ width: 20 }} />
      </div>
      <div className="orders-header-divider" />
      {error && <div style={{ margin: 16, padding: 12, borderRadius: 10, background: '#fef2f2', color: '#b91c1c' }}>{error}</div>}
      {loading ? <div style={{ padding: 32, textAlign: 'center' }}>Loading your library…</div> : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 42 }}>📚</div>
          <strong style={{ display: 'block', marginTop: 8, color: '#0f172a' }}>No purchased e-books yet</strong>
          <span>Verified purchases will appear here automatically.</span>
        </div>
      ) : (
        <div style={{ padding: 16, display: 'grid', gap: 14 }}>
          {items.map((entry) => (
            <article key={entry.id} className="profile-menu-card" style={{ padding: 14, display: 'flex', gap: 14 }}>
              <img src={entry.product?.images?.[0]} alt="" style={{ width: 76, height: 104, objectFit: 'cover', borderRadius: 9, background: '#e2e8f0' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 900, color: '#0284c7', textTransform: 'uppercase' }}>Digital E-book</span>
                <h3 style={{ margin: '4px 0', fontSize: 15 }}>{entry.product?.name || 'E-book'}</h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>{entry.product?.digital?.author || 'Unknown author'}</div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>Purchased {new Date(entry.activatedAt).toLocaleDateString('en-IN')} · {entry.order?.orderNo}</div>
                <button
                  type="button"
                  disabled={!entry.downloadAvailable || downloading === entry.id}
                  onClick={() => download(entry)}
                  className="pd-add-to-cart-btn"
                  style={{ marginTop: 10, width: 'auto', padding: '9px 16px', opacity: entry.downloadAvailable ? 1 : .55 }}
                >
                  {downloading === entry.id ? 'Preparing…' : entry.downloadAvailable ? 'Download PDF' : 'Unavailable'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default DigitalLibraryPage;
