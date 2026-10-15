import React, { useEffect, useRef, useState } from 'react';
import { IMAGE_ACCEPT, validateSearchImage } from '../utils/imageSearch';
import './ImageSearchSheet.css';

export function ImageSearchButton({ onClick, className = '' }) {
  return <button type="button" className={`image-search-icon ${className}`} onClick={onClick} aria-label="Search by image" title="Search by image">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h4l2-3h4l2 3h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg>
  </button>;
}
export default function ImageSearchSheet({ open, onClose, onSearch, loading, maxBytes = 5 * 1024 * 1024 }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState(''), [error, setError] = useState('');
  const camera = useRef(), gallery = useRef(), dialog = useRef();
  useEffect(() => { if (!open) { setFile(null); setError(''); } }, [open]);
  useEffect(() => { if (!file) { setPreview(''); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement; dialog.current?.focus();
    const key = event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = Array.from(dialog.current?.querySelectorAll('button:not(:disabled),input:not([hidden])') || []);
        if (!nodes.length) return;
        if (document.activeElement === dialog.current) { event.preventDefault(); (event.shiftKey ? nodes.at(-1) : nodes[0]).focus(); return; }
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', key); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, [open, onClose]);
  const select = event => {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    try { validateSearchImage(selected, maxBytes); setFile(selected); setError(''); }
    catch (failure) { setFile(null); setError(failure.message); }
  };
  const search = async () => {
    try { validateSearchImage(file, maxBytes); setError(''); if (await onSearch(file)) onClose(); }
    catch (failure) { if (failure.name !== 'AbortError') setError(failure.message || 'Unable to search. Please try again.'); }
  };
  if (!open) return null;
  return <div className="image-search-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className="image-search-sheet" role="dialog" aria-modal="true" aria-labelledby="image-search-title">
      <div className="image-search-sheet-head"><h2 id="image-search-title">Search by image</h2><button type="button" onClick={onClose} aria-label="Close image search">×</button></div>
      <p>Find similar product photos. Use a clear, well-lit picture.</p>
      <input hidden ref={camera} type="file" accept="image/*" capture="environment" onChange={select} aria-label="Take a product photo" />
      <input hidden ref={gallery} type="file" accept={IMAGE_ACCEPT} onChange={select} aria-label="Upload a product image" />
      <div className="image-search-choices"><button type="button" disabled={loading} onClick={() => camera.current?.click()}>Take Photo</button><button type="button" disabled={loading} onClick={() => gallery.current?.click()}>Upload Image</button></div>
      <small>JPG, JPEG, PNG or WEBP · up to {(maxBytes / 1024 / 1024).toFixed(1)} MiB. Camera capture depends on your device.</small>
      {preview && <div className="image-search-preview"><img src={preview} alt="Selected product image" onError={() => { setFile(null); setError('This image cannot be previewed. Choose another image.'); }} /><button type="button" disabled={loading} onClick={() => { setFile(null); setError(''); }}>Remove image</button></div>}
      {error && <p className="image-search-error" role="alert">{error}</p>}
      {loading && <p role="status" aria-live="polite">Finding similar products…</p>}
      <button type="button" className="image-search-submit" disabled={!file || loading} onClick={search}>{loading ? 'Searching…' : 'Search image'}</button>
    </section>
  </div>;
}
