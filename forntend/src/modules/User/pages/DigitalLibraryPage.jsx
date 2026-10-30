import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';

const DigitalLibraryPage = () => {
  const { setActiveNav } = useUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);
  // Books already fetched this visit: their PDF is kept so View can reuse it and the button can say Downloaded.
  const [downloaded, setDownloaded] = useState({});
  const [viewing, setViewing] = useState(null);
  const pdfUrls = useRef({});
  useEffect(() => () => Object.values(pdfUrls.current).forEach((url) => URL.revokeObjectURL(url)), []);

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

  const pdfUrlFor = async (entry) => {
    if (pdfUrls.current[entry.id]) return pdfUrls.current[entry.id];
    const response = await fetch(apiUrl(`/api/digital/library/${entry.id}/download`), { headers: headers() });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Download is temporarily unavailable');
    }
    const blob = await response.blob();
    return (pdfUrls.current[entry.id] = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
  };

  const download = async (entry) => {
    setDownloading(entry.id);
    setError('');
    try {
      const url = await pdfUrlFor(entry);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${entry.product?.name || 'ebook'}.pdf`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // The blob stays alive for the visit: a phone starts saving it after the click returns,
      // and View reuses it. It is freed when this page closes.
      setDownloaded((current) => ({ ...current, [entry.id]: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  };

  const view = async (entry) => {
    // Opened first, inside the tap, so the browser does not treat it as a blocked pop-up.
    const tab = window.open('', '_blank');
    setViewing(entry.id);
    setError('');
    try {
      const url = await pdfUrlFor(entry);
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch (err) {
      tab?.close();
      setError(err.message);
    } finally {
      setViewing(null);
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
                <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--sf-primary)', textTransform: 'uppercase' }}>Digital E-book</span>
                <h3 style={{ margin: '4px 0', fontSize: 15 }}>{entry.product?.name || 'E-book'}</h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>{entry.product?.digital?.author || 'Unknown author'}</div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>Purchased {new Date(entry.activatedAt).toLocaleDateString('en-IN')} · {entry.order?.orderNo}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    disabled={!entry.downloadAvailable || downloading === entry.id}
                    onClick={() => download(entry)}
                    className="pd-add-to-cart-btn"
                    style={{ margin: 0, width: 'auto', padding: '9px 16px', opacity: entry.downloadAvailable ? 1 : .55 }}
                  >
                    {downloading === entry.id ? 'Preparing…' : !entry.downloadAvailable ? 'Unavailable' : downloaded[entry.id] ? 'Downloaded ✓' : 'Download PDF'}
                  </button>
                  {entry.downloadAvailable && <button
                    type="button"
                    disabled={viewing === entry.id}
                    onClick={() => view(entry)}
                    style={{ padding: '9px 16px', borderRadius: 12, border: '1.5px solid var(--sf-primary, #0f9f91)', background: '#fff', color: 'var(--sf-primary, #0f9f91)', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {viewing === entry.id ? 'Opening…' : 'View PDF'}
                  </button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default DigitalLibraryPage;
