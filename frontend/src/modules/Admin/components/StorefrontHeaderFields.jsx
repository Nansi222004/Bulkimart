import React, { useState } from 'react';
import { adminPost } from '../../../utils/adminApi';
import { DEFAULT_HEADER, DEFAULT_COUNTDOWN } from '../../../utils/storefront';
import { EFFECT_PRESETS, EFFECT_LABELS } from '../../../../../backend/shared/celebration.mjs';
// Sale times are entered and shown in IST, like every other Studio schedule.
const local = value => value ? new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16) : '';
const iso = value => value ? new Date(`${value}:00+05:30`).toISOString() : null;
const targets = [{ value: 'none', label: 'No button' }, { value: 'categories', label: 'All categories' }, { value: 'hot-deals', label: 'Hot deals' }, { value: 'smart-buy', label: 'Smart Buy' }, { value: 'campaign', label: 'A deal campaign page' }];
const MEDIA_RULES = {
  image: { accept: 'image/jpeg,image/png,image/webp', types: ['image/jpeg', 'image/png', 'image/webp'], maxMb: 5, error: 'Choose a JPEG, PNG or WebP image up to 5 MB.' },
  video: { accept: 'video/mp4,video/webm', types: ['video/mp4', 'video/webm'], maxMb: 15, error: 'Choose an MP4 or WebM video up to 15 MB.' },
};
// Uploads straight to the server (same endpoint as banner media); only the returned URL is saved.
function HeaderMediaUpload({ label, kind, value, onChange, onBusy }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), rule = MEDIA_RULES[kind];
  const upload = async file => {
    if (!file || busy) return;
    if (!rule.types.includes(file.type) || file.size > rule.maxMb * 1024 * 1024) { setError(rule.error); return; }
    setBusy(true); onBusy(true); setError('');
    try {
      const body = new FormData(); body.append('media', file);
      const result = await adminPost('/storefront/media', body);
      if (result.data?.type !== kind || !result.data.url) throw new Error('The upload did not return a saved file. Please try again.');
      onChange(result.data.url);
    } catch (err) { setError(err.message || 'Upload failed'); }
    finally { setBusy(false); onBusy(false); }
  };
  return <div className="studio-field">
    <span>{label}</span>
    {value && (kind === 'video'
      ? <video className="studio-media-thumb" src={value} muted loop autoPlay playsInline />
      : <img className="studio-media-thumb" src={value} alt="" />)}
    <div className="studio-pair">
      <label className="studio-upload-button">{busy ? 'Uploading…' : value ? `Replace ${kind}` : `Upload ${kind}`}
        <input type="file" hidden disabled={busy} accept={rule.accept} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
      {value && <button type="button" disabled={busy} onClick={() => onChange('')}>Remove {kind}</button>}
    </div>
    <small className="studio-help">{kind === 'video' ? 'MP4 or WebM, up to 15 MB. Fills the whole sub-header — use a wide video (e.g. 1280 × 400).' : 'JPEG, PNG or WebP, up to 5 MB. Fills the whole sub-header behind the text — use a wide image (e.g. 1600 × 500); edges may be trimmed to fit.'}</small>
    {error && <p className="studio-error" role="alert">{error}</p>}
  </div>;
}
// `subheaderOnly`: the theme exists just for this strip, so it is always on.
export default function StorefrontHeaderFields({ value, onChange, deals = [], onBusy = () => {}, subheaderOnly = false }) {
  const h = { ...DEFAULT_HEADER, ...value, countdown: { ...DEFAULT_COUNTDOWN, ...value?.countdown } }, c = h.countdown;
  const change = patch => onChange({ ...h, ...patch });
  const timer = patch => change({ countdown: { ...c, ...patch } });
  const text = (key, label, max) => <label className="studio-field" key={key}>{label}<input maxLength={max} value={h[key]} onChange={event => change({ [key]: event.target.value })} /></label>;
  return <fieldset className="studio-effect-fields studio-header-fields"><legend>{subheaderOnly ? 'Sub-header' : 'Festive header'}</legend>
    {!subheaderOnly && <label className="studio-check"><input type="checkbox" checked={h.enabled} onChange={event => change({ enabled: event.target.checked })} />Show festive header below search and categories</label>}
    {h.enabled && <>
      {text('title', 'Header title', 60)}
      {text('subtitle', 'Promotional subtitle', 120)}
      <div className="studio-pair">
        <label className="studio-field">Header height (120–320 px)<input type="number" min="120" max="320" step="10" value={h.height} onChange={event => change({ height: Number(event.target.value) })} /></label>
        <label className="studio-field">Subheader animation
          <select value={h.animationPreset || ''} onChange={event => change({ animationPreset: event.target.value })}>
            <option value="">Match main header animation</option>
            <option value="none">No animation in subheader</option>
            {EFFECT_PRESETS.map(p => <option key={p} value={p}>{EFFECT_LABELS[p] || p}</option>)}
          </select>
        </label>
      </div>
      <HeaderMediaUpload label="Sub-header image (optional)" kind="image" value={h.image} onChange={image => change({ image })} onBusy={onBusy} />
      <HeaderMediaUpload label="Sub-header video (optional)" kind="video" value={h.video} onChange={video => change({ video })} onBusy={onBusy} />
      {h.video && <p className="studio-help">The video plays muted and on loop. The image above is shown while it loads, and to customers who turned off motion. Videos are cut to at most 15 seconds.</p>}
      <div className="studio-colors"><label>Header background<input type="color" value={h.background} onChange={event => change({ background: event.target.value })} /></label><label>Header text<input type="color" value={h.text} onChange={event => change({ text: event.target.value })} /></label></div>
      <div className="studio-pair">
        <label className="studio-field">Button destination<select value={h.target} onChange={event => change({ target: event.target.value, ...(event.target.value === 'campaign' ? {} : { campaignId: '' }) })}>{targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
        {h.target !== 'none' && text('cta', 'Button text', 24)}
      </div>
      {h.target === 'campaign' && <label className="studio-field">Deal campaign<select value={h.campaignId} onChange={event => change({ campaignId: event.target.value })}><option value="">Select a deal campaign</option>{deals.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>}
      <label className="studio-check"><input type="checkbox" checked={c.enabled} onChange={event => timer({ enabled: event.target.checked })} />Show sale countdown</label>
      {c.enabled && <>
        <label className="studio-field">Sale title<input maxLength={40} value={c.title} onChange={event => timer({ title: event.target.value })} /></label>
        <div className="studio-pair">
          <label className="studio-field">Sale start · IST<input type="datetime-local" value={local(c.startAt)} onChange={event => timer({ startAt: iso(event.target.value) })} /></label>
          <label className="studio-field">Sale end · IST<input type="datetime-local" value={local(c.endAt)} onChange={event => timer({ endAt: iso(event.target.value) })} /></label>
        </div>
        <label className="studio-check"><input type="checkbox" checked={c.showRemaining} onChange={event => timer({ showRemaining: event.target.checked })} />During the sale, count down to the end</label>
        <label className="studio-field">After the sale ends, show (leave empty to hide)<input maxLength={60} value={c.expiredText} onChange={event => timer({ expiredText: event.target.value })} /></label>
      </>}
      <p className="studio-help">Before the start time customers see “Starts in”; during the sale “Ends in”; afterwards the countdown hides or shows your text. Times are Asia/Kolkata (IST). Header text needs 4.5:1 contrast with its background.</p>
    </>}
  </fieldset>;
}
