import React from 'react';
import { DEFAULT_EFFECT, EFFECT_PRESETS } from '../../../../../backend/shared/celebration.mjs';
const local = value => value ? new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16) : '';
export default function StorefrontEffectFields({ value, onChange, bannerOnly = false, allowBanner = false, deals = [] }) {
  const e = { ...DEFAULT_EFFECT, ...(bannerOnly ? { scope: 'banner' } : {}), ...value };
  const change = patch => onChange({ ...e, ...patch });
  return <fieldset className="studio-effect-fields"><legend>Celebration animation</legend>
    <label className="studio-check"><input type="checkbox" checked={e.enabled} onChange={event => change({ enabled: event.target.checked })} />Enable decorative effect</label>
    <label className="studio-field">Preset<select value={e.preset} onChange={event => change({ preset: event.target.value, colors: event.target.value === 'sparkles' ? ['#FFD700', '#FFF1A8'] : event.target.value === 'snowfall' ? ['#FFFFFF', '#DDEEFF'] : event.target.value === 'petals' ? ['#FFB7C5', '#FF69B4'] : DEFAULT_EFFECT.colors })}>{EFFECT_PRESETS.map(p => <option key={p} value={p}>{({ snowfall: 'Snowfall', confetti: 'Confetti', petals: 'Flower petals', sparkles: 'Golden sparkles' })[p]}</option>)}</select></label>
    {!bannerOnly && <label className="studio-field">Animation scope<select value={e.scope} onChange={event => change({ scope: event.target.value })}>{['storefront', 'homepage', 'campaign', ...(allowBanner ? ['banner'] : [])].map(s => <option key={s} value={s}>{s === 'campaign' ? 'Campaign page' : s}</option>)}</select></label>}
    {e.scope === 'campaign' && <label className="studio-field">Target campaign page<select value={e.campaignId} onChange={event => change({ campaignId: event.target.value })}><option value="">Select a deal campaign</option>{deals.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>}
    <div className="studio-colors">{e.colors.map((color, i) => <label key={i}>Color {i + 1}<input aria-label={`Particle color ${i + 1}`} type="color" value={color} onChange={event => change({ colors: e.colors.map((c, index) => index === i ? event.target.value : c) })} /></label>)}</div>
    <button type="button" disabled={e.colors.length >= 6} onClick={() => change({ colors: [...e.colors, '#FFD700'] })}>Add color</button><button type="button" disabled={e.colors.length <= 1} onClick={() => change({ colors: e.colors.slice(0, -1) })}>Remove color</button>
    {Object.entries({ speed: [0.2, 3, 0.1], density: [1, 100, 1], opacity: [0.05, 0.8, 0.05], duration: [1, 120, 1] }).map(([key, [min, max, step]]) => <label className="studio-field" key={key}>{key === 'duration' ? 'Duration (seconds per viewing)' : key}<input type="number" min={min} max={max} step={step} value={e[key]} onChange={event => change({ [key]: Number(event.target.value) })} /></label>)}
    {['startAt', 'endAt'].map(key => <label className="studio-field" key={key}>{key === 'startAt' ? 'Effect start · IST' : 'Effect end · IST'}<input type="datetime-local" value={local(e[key])} onChange={event => change({ [key]: event.target.value ? new Date(`${event.target.value}:00+05:30`).toISOString() : null })} /></label>)}
    <p className="studio-help">Effect dates are optional and stay within the parent publication schedule. Storefront and device targeting are inherited. Reduced motion and customer opt-out disable effects.</p>
  </fieldset>;
}
