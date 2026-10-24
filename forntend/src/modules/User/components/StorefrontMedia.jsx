import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
const mediaSrc = src => src?.startsWith('/uploads/') ? apiUrl(src) : src;
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return reduced;
}
export default function StorefrontMedia({ banner, device, active = true, eager = false }) {
  const reduced = useReducedMotion(), video = useRef(null);
  const [failedVideo, setFailedVideo] = useState(false), [failedImage, setFailedImage] = useState(false);
  const image = device === 'mobile' && banner.mobileImage || banner.image;
  const fallBackVideo = () => {
    // Native video controls can own focus when a failed video is removed.
    // Keep keyboard focus in the promotion during the poster transition.
    if (video.current && document.activeElement === video.current) video.current.closest('[role="dialog"], .sf-hero')?.querySelector('button')?.focus();
    setFailedVideo(true);
  };
  useEffect(() => { setFailedVideo(false); setFailedImage(false); }, [banner.id, banner.video, image]);
  useEffect(() => {
    const element = video.current;
    if (active && !reduced && !failedVideo && element) element.play()?.catch(fallBackVideo);
    return () => { if (element) { element.pause(); element.removeAttribute('src'); element.load(); } };
  }, [active, reduced, failedVideo, banner.video]);
  if (active && banner.video && !reduced && !failedVideo) return <video ref={video} src={mediaSrc(banner.video)} poster={mediaSrc(image)} muted playsInline controls preload="metadata" onError={fallBackVideo} aria-label={banner.title || 'Promotion'} />;
  if (failedImage || !image) return <div className="sf-media-fallback" role="img" aria-label="Promotional image unavailable">{banner.title || 'Discover Bulkimart'}</div>;
  return <img src={mediaSrc(image)} alt={banner.title || 'Bulkimart promotion'} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailedImage(true)} />;
}
