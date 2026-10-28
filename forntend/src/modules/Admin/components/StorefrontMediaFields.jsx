import React, { useEffect, useRef, useState } from 'react';
import { adminPost } from '../../../utils/adminApi';
import './StorefrontStudio.css';
// Reads an image's shape once loaded, so admins can be warned before a tall image lands in the desktop slot.
export function useImageShape(url) {
  const [shape, setShape] = useState(null);
  useEffect(() => {
    setShape(null);
    if (!url || typeof Image === 'undefined') return undefined;
    let live = true; const image = new Image();
    image.onload = () => { if (live && image.naturalWidth && image.naturalHeight) setShape(image.naturalHeight > image.naturalWidth * 1.05 ? 'portrait' : image.naturalWidth > image.naturalHeight * 1.05 ? 'landscape' : 'square'); };
    image.src = url;
    return () => { live = false; };
  }, [url]);
  return shape;
}
export const MEDIA_SIZE_HINTS = { image: 'Wide (landscape) artwork for computers and tablets, e.g. 1600 × 900 px.', mobileImage: 'Tall (portrait) artwork for phones, e.g. 1080 × 1920 px. Phones use the desktop image if this is empty.' };
export default function StorefrontMediaFields({ value, onChange, onBusy = () => {}, desktopImage = true }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), uploading = useRef(false);
  const type = value.mediaType || (value.video ? 'video' : 'image');
  const desktopShape = useImageShape(desktopImage ? value.image : ''), mobileShape = useImageShape(value.mobileImage);
  const warning = key => key === 'image' && desktopShape === 'portrait' ? 'This desktop image is tall (portrait), so computers show it as a narrow card. Upload a wide image here and put the tall one in Mobile image.'
    : key === 'mobileImage' && mobileShape === 'landscape' ? 'This mobile image is wide (landscape), so phones will crop it. Upload a tall image for phones.'
    : key === 'mobileImage' && !value.mobileImage && desktopShape === 'landscape' ? 'No mobile image yet: phones will crop the wide desktop image to fill the screen.' : '';
  const upload = async (file, key, video) => {
    if (!file || uploading.current) return;
    const allowed = video ? ['video/mp4', 'video/webm'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > (video ? 15 : 5) * 1024 * 1024) { setError(video ? 'Choose MP4 or WebM up to 15 MB.' : 'Choose JPEG, PNG or WebP up to 5 MB.'); return; }
    uploading.current = true; setBusy(true); onBusy(true); setError('');
    try { const body = new FormData(); body.append('media', file); const result = await adminPost('/storefront/media', body); if (result.data.type !== (video ? 'video' : 'image')) throw new Error('Unexpected media type returned'); onChange({ [key]: result.data.url }); }
    catch (err) { setError(err.message); }
    finally { uploading.current = false; setBusy(false); onBusy(false); }
  };
  const field = (key, label, video = false) => <div className="studio-field" key={key}><label>{label}<input aria-label={label} type="text" value={value[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={video ? 'https://…/clip.mp4' : 'HTTPS or /uploads/ image URL'} /></label><input aria-label={`Upload ${label}`} type="file" accept={video ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp'} onChange={e => { upload(e.target.files?.[0], key, video); e.target.value = ''; }} /><button type="button" disabled={!value[key]} onClick={() => onChange({ [key]: '' })}>Remove {label.toLowerCase()}</button>
    {!video && MEDIA_SIZE_HINTS[key] && <small className="studio-help">{MEDIA_SIZE_HINTS[key]}</small>}
    {!video && value[key] && <img className="studio-media-thumb" src={value[key]} alt="" />}
    {!video && warning(key) && <p className="studio-media-warning" role="status">{warning(key)}</p>}</div>;
  return <fieldset disabled={busy}><legend>Banner media</legend>
    <label className="studio-field">Media type<select value={type} onChange={e => onChange({ mediaType: e.target.value })}><option value="image">Image</option><option value="video">Video</option></select></label>
    {desktopImage && field('image', type === 'video' ? 'Poster / image fallback (required)' : 'Desktop image (required)')}
    {field('mobileImage', 'Mobile image / poster')}
    {type === 'video' && <>{field('video', 'Desktop video (required)', true)}{field('mobileVideo', 'Mobile video', true)}
      {['autoplay', 'muted', 'loop', 'playsInline'].map(key => <label className="studio-check" key={key}><input type="checkbox" checked={value[key] !== false} onChange={e => onChange({ [key]: e.target.checked, ...(key === 'autoplay' && e.target.checked ? { muted: true } : {}) })} />{key === 'playsInline' ? 'Play inline' : key}</label>)}
      <p className="studio-help">Autoplay requires muted audio. Include all promotional information in the heading, description and poster. Uploads are optimized to at most 15 seconds.</p></>}
    {busy && <p role="status">Uploading media…</p>}{error && <p className="studio-error" role="alert">{error}</p>}
  </fieldset>;
}
