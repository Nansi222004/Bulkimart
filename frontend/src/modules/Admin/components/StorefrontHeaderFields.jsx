import React from 'react';
import { DEFAULT_HEADER, DEFAULT_COUNTDOWN } from '../../../utils/storefront';
// Sale times are entered and shown in IST, like every other Studio schedule.
const local = value => value ? new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16) : '';
const iso = value => value ? new Date(`${value}:00+05:30`).toISOString() : null;
const targets = [{ value: 'none', label: 'No button' }, { value: 'categories', label: 'All categories' }, { value: 'hot-deals', label: 'Hot deals' }, { value: 'smart-buy', label: 'Smart Buy' }, { value: 'campaign', label: 'A deal campaign page' }];
export default function StorefrontHeaderFields({ value, onChange, deals = [] }) {
  const h = { ...DEFAULT_HEADER, ...value, countdown: { ...DEFAULT_COUNTDOWN, ...value?.countdown } }, c = h.countdown;
  const change = patch => onChange({ ...h, ...patch });
  const timer = patch => change({ countdown: { ...c, ...patch } });
  const text = (key, label, max) => <label className="studio-field" key={key}>{label}<input maxLength={max} value={h[key]} onChange={event => change({ [key]: event.target.value })} /></label>;
  return <fieldset className="studio-effect-fields studio-header-fields"><legend>Festive header</legend>
    <label className="studio-check"><input type="checkbox" checked={h.enabled} onChange={event => change({ enabled: event.target.checked })} />Show festive header below search and categories</label>
    {h.enabled && <>
      {text('title', 'Header title', 60)}
      {text('subtitle', 'Promotional subtitle', 120)}
      <div className="studio-pair">
        <label className="studio-field">Header height (120–320 px)<input type="number" min="120" max="320" step="10" value={h.height} onChange={event => change({ height: Number(event.target.value) })} /></label>
        <label className="studio-field">Header artwork URL (optional)<input type="url" placeholder="https://… .webp" value={h.image} onChange={event => change({ image: event.target.value.trim() })} /></label>
      </div>
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
