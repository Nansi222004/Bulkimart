import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../../utils/api';
const mediaSrc = src => src?.startsWith('/uploads/') ? apiUrl(src) : src;
// True once the image has loaded (or failed, or maxWait passed), so a timed splash counts its
// seconds from when the artwork is on screen rather than from when the download started.
export function useMediaReady(src, maxWait = 4000) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (!src) return;
    let done = false; const finish = () => { if (!done) { done = true; setLoaded(src); } };
    if (typeof Image === 'undefined') { finish(); return; }
    const image = new Image(); image.onload = image.onerror = finish; image.src = mediaSrc(src);
    if (image.complete) finish();
    const timer = setTimeout(finish, maxWait);
    return () => { done = true; clearTimeout(timer); image.onload = image.onerror = null; };
  }, [src, maxWait]);
  return !src || loaded === src;
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return reduced;
}
export default function StorefrontMedia({ banner, device, active = true, eager = false }) {
  const reduced = useReducedMotion(), video = useRef(null);
  const [failedVideo, setFailedVideo] = useState(false), [failedImage, setFailedImage] = useState(false);
  const [visible, setVisible] = useState(eager || typeof IntersectionObserver === 'undefined');
  const image = device === 'mobile' && banner.mobileImage || banner.image;
  const source = banner.mediaType === 'image' ? '' : device === 'mobile' && banner.mobileVideo || banner.video;
  const fallBackVideo = () => {
    // Native video controls can own focus when a failed video is removed.
    // Keep keyboard focus in the promotion during the poster transition.
    if (video.current && document.activeElement === video.current) video.current.closest('[role="dialog"], .sf-hero')?.querySelector('button')?.focus();
    setFailedVideo(true);
  };
  useEffect(() => { setFailedVideo(false); setFailedImage(false); }, [banner.id, source, image]);
  useEffect(() => {
    if (eager || !video.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '100px' });
    observer.observe(video.current); return () => observer.disconnect();
  }, [eager, source, active, reduced, failedVideo]);
  useEffect(() => {
    const element = video.current;
    if (!element || !active || reduced || failedVideo || !visible) return;
    let cancelled = false, timeout;
    element.src = mediaSrc(source);
    const play = () => {
      if (document.hidden) { element.pause(); return; }
      if (banner.autoplay !== false) {
        // Autoplay is always silent, even for malformed cached configuration.
        element.muted = true;
        try { element.play()?.catch(() => { if (!cancelled) fallBackVideo(); }); } catch { fallBackVideo(); }
      }
    };
    const loaded = () => clearTimeout(timeout);
    timeout = setTimeout(() => { if (!cancelled && element.readyState < 2) fallBackVideo(); }, 10000);
    element.addEventListener('loadeddata', loaded); document.addEventListener('visibilitychange', play); play();
    return () => { cancelled = true; clearTimeout(timeout); element.removeEventListener('loadeddata', loaded); document.removeEventListener('visibilitychange', play); element.pause(); element.removeAttribute('src'); element.load(); };
  }, [active, reduced, failedVideo, source, visible, banner.autoplay]);
  if (active && source && !reduced && !failedVideo) return <video ref={video} src={visible ? mediaSrc(source) : undefined} poster={mediaSrc(image)} autoPlay={banner.autoplay !== false} muted={banner.autoplay !== false || banner.muted !== false} loop={banner.loop !== false} playsInline={banner.playsInline !== false} controls preload={visible ? 'metadata' : 'none'} onError={fallBackVideo} aria-label={banner.title || 'Promotion'} />;
  if (failedImage || !image) return <div className="sf-media-fallback" role="img" aria-label="Promotional image unavailable">{banner.title || 'Discover Bulkimart'}</div>;
  return <img src={mediaSrc(image)} alt={banner.title || 'Bulkimart promotion'} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" onError={() => setFailedImage(true)} />;
}
