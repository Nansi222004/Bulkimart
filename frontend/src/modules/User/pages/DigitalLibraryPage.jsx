import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import ModalPortal from '../../../components/ModalPortal';

const DigitalLibraryPage = () => {
  const { setActiveNav } = useUser();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);
  // Books already fetched this visit or saved locally: button says Downloaded ✓.
  const [downloaded, setDownloaded] = useState({});
  const [viewing, setViewing] = useState(null);
  const [viewModal, setViewModal] = useState(null); // { title, url, entry }
  const pdfUrls = useRef({});
  useEffect(() => () => Object.values(pdfUrls.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('userToken') || ''}` });

  useEffect(() => {
    let alive = true;
    fetch(apiUrl('/api/digital/library'), { headers: headers() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Could not load your e-books');
        if (alive) {
          const list = body.data || [];
          setItems(list);
          const initialDownloaded = {};
          list.forEach((entry) => {
            if (entry.downloadCount > 0 || entry.lastDownloadedAt || localStorage.getItem(`downloaded_ebook_${entry.id}`)) {
              initialDownloaded[entry.id] = true;
            }
          });
          setDownloaded((prev) => ({ ...prev, ...initialDownloaded }));
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const pdfUrlFor = async (entry, isInline = false) => {
    if (pdfUrls.current[entry.id]) return pdfUrls.current[entry.id];
    const urlEndpoint = isInline
      ? `/api/digital/library/${entry.id}/download?inline=1`
      : `/api/digital/library/${entry.id}/download`;
    const response = await fetch(apiUrl(urlEndpoint), { headers: headers() });
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
      // Persist downloaded status in local storage and state
      localStorage.setItem(`downloaded_ebook_${entry.id}`, 'true');
      setDownloaded((current) => ({ ...current, [entry.id]: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(null);
    }
  };

  const view = async (entry) => {
    setViewing(entry.id);
    setError('');
    try {
      const url = await pdfUrlFor(entry, true);
      setViewModal({
        title: entry.product?.name || 'E-book Reader',
        url,
        entry
      });
    } catch (err) {
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
                  {entry.downloadAvailable && (
                    <button
                      type="button"
                      disabled={viewing === entry.id}
                      onClick={() => view(entry)}
                      style={{ padding: '9px 16px', borderRadius: 12, border: '1.5px solid var(--sf-primary, #0f9f91)', background: '#fff', color: 'var(--sf-primary, #0f9f91)', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {viewing === entry.id ? 'Opening…' : 'View PDF'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* In-App PDF Viewer Modal */}
      {viewModal && (
        <ModalPortal style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'stretch'
        }}>
          <div role="dialog" aria-modal="true" aria-label={viewModal.title} style={{
            width: '100%',
            maxWidth: '720px',
            height: '100dvh',
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 0 40px rgba(0,0,0,0.3)'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <button
                  type="button"
                  onClick={() => setViewModal(null)}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    width: '32px',
                    height: '32px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px'
                  }}
                  aria-label="Close PDF Viewer"
                >
                  ✕
                </button>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {viewModal.title}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => download(viewModal.entry)}
                  style={{
                    background: 'var(--primary, #D91430)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  {downloaded[viewModal.entry?.id] ? 'Downloaded ✓' : 'Download'}
                </button>
                <a
                  href={viewModal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  New tab ↗
                </a>
              </div>
            </div>

            {/* PDF View Container */}
            <div style={{ flex: 1, minHeight: 0, backgroundColor: '#525659', position: 'relative' }}>
              <object
                data={viewModal.url}
                type="application/pdf"
                width="100%"
                height="100%"
                style={{ width: '100%', height: '100%', border: 'none' }}
              >
                <iframe
                  src={viewModal.url}
                  title={viewModal.title}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              </object>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default DigitalLibraryPage;
