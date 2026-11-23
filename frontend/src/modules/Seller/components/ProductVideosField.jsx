import React, { useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';

// Product videos (backend: POST /api/products/media/video, services/productVideo.service.js).
// Each clip uploads straight away to Bulkimart's own server with a progress bar; the product form then
// saves the returned links in `videos`. Same limits as the server, checked here first to save a wasted upload.
export const MAX_PRODUCT_VIDEOS = 2;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 60;

/** Duration of a local video file, or null when the browser cannot read it. */
const readDuration = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
  video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
  video.onerror = () => done(null);
  video.src = url;
});

const uploadVideo = (file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', apiUrl('/api/products/media/video'));
  const token = localStorage.getItem('sellerToken');
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
    if (xhr.status >= 200 && xhr.status < 300 && body?.data?.url) resolve(body.data);
    else reject(new Error(body?.message || 'Video upload failed. Please try again.'));
  };
  xhr.onerror = () => reject(new Error('Network error while uploading the video.'));
  const fd = new FormData();
  fd.append('video', file);
  xhr.send(fd);
});

export default function ProductVideosField({ value, onChange, disabled }) {
  const videos = Array.isArray(value) ? value : [];
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const uploading = progress !== null;

  const pick = async (file) => {
    setError('');
    if (!file) return;
    if (!/\.(mp4|m4v)$/i.test(file.name) && file.type !== 'video/mp4') { setError('Choose an MP4 video.'); return; }
    if (file.size > MAX_VIDEO_BYTES) { setError('The video must be 50 MB or smaller.'); return; }
    const seconds = await readDuration(file);
    if (seconds !== null && seconds > MAX_SECONDS + 0.5) { setError(`The video must be ${MAX_SECONDS} seconds or shorter (this one is ${Math.round(seconds)} s).`); return; }
    setProgress(0);
    try {
      const data = await uploadVideo(file, setProgress);
      onChange([...videos, data.url].slice(0, MAX_PRODUCT_VIDEOS));
    } catch (e) {
      setError(e.message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="onboarding-form-group">
      <label className="onboarding-label">Product Videos (optional, up to {MAX_PRODUCT_VIDEOS})</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {videos.map((url, i) => (
          <div key={url} style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 8, background: 'var(--bg-card)' }}>
            <video src={url} controls preload="metadata" playsInline style={{ width: '100%', maxHeight: 180, borderRadius: 6, background: '#000' }} />
            <button type="button" disabled={disabled || uploading} onClick={() => onChange(videos.filter((_, j) => j !== i))}
              style={{ marginTop: 6, width: '100%', border: '1px solid #fca5a5', background: '#fff5f5', color: '#b91c1c', borderRadius: 8, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Remove video
            </button>
          </div>
        ))}
        {videos.length < MAX_PRODUCT_VIDEOS && (
          <div
            role="button" tabIndex={0} aria-label="Upload a product video"
            onClick={() => !disabled && !uploading && inputRef.current?.click()}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled && !uploading) inputRef.current?.click(); }}
            style={{ border: '1.5px dashed var(--border-color)', borderRadius: 10, minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, cursor: disabled || uploading ? 'not-allowed' : 'pointer', background: 'var(--bg-page)', textAlign: 'center' }}>
            {uploading ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)' }}>Uploading… {Math.round(progress * 100)}%</span>
                <div style={{ width: '80%', height: 6, background: 'var(--border-color)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--primary)' }} />
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 28 }}>🎬</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Click to upload a video</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>MP4 (H.264), up to 60 s, 1080p, 50 MB</span>
              </>
            )}
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="video/mp4,.mp4,.m4v" style={{ display: 'none' }}
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 12, margin: '6px 0 0' }}>{error}</p>}
      <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 6 }}>
        Videos are saved with the product when you click Save. iPhone videos: set Camera → Formats → "Most Compatible" so they record as MP4 (H.264).
      </span>
    </div>
  );
}
