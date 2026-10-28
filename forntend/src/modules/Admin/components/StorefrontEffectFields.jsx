import React from 'react';
import { DEFAULT_EFFECT, EFFECT_PRESETS, EFFECT_LABELS, EFFECT_COLORS, DRIFTING_PRESETS, INTENSITY, MAX_COMBINED, effectPresets } from '../../../../../backend/shared/celebration.mjs';
const local = value => value ? new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16) : '';
// Quantity means different things per preset; only relevant settings are shown.
const quantityLabel = presets => presets.length > 1 ? 'Particle quantity (per animation)' : ({ lights: 'Bulbs on the light string', fireworks: 'Sparks per burst (×2)' })[presets[0]] || 'Particle quantity';
export default function StorefrontEffectFields({ value, onChange, bannerOnly = false, allowBanner = false, deals = [] }) {
  const e = { ...DEFAULT_EFFECT, ...(bannerOnly ? { scope: 'banner' } : {}), ...value };
  const change = patch => onChange({ ...e, ...patch });
  const presets = e.enabled ? effectPresets(e) : [];
  // The first selected preset is the primary one and owns the colour pickers.
  const togglePreset = preset => {
    const next = presets.includes(preset) ? presets.filter(p => p !== preset) : [...presets, preset];
    if (!next.length) return change({ enabled: false, presets: [] });
    change({ enabled: true, presets: next, preset: next[0], ...(next[0] !== presets[0] ? { colors: [...EFFECT_COLORS[next[0]]] } : {}) });
  };
  const number = (key, label, min, max, step) => <label className="studio-field" key={key}>{label}<input type="number" min={min} max={max} step={step} value={e[key]} onChange={event => change({ [key]: Number(event.target.value) })} /></label>;
  return <fieldset className="studio-effect-fields"><legend>Festive animation</legend>
    <label className="studio-check"><input type="checkbox" checked={e.enabled} onChange={event => change({ enabled: event.target.checked })} />Enable festive animation</label>
    <div className="studio-field" role="group" aria-label="Animation types">Animation types (choose up to {MAX_COMBINED})
      <div className="studio-preset-options">{EFFECT_PRESETS.map(p => <label className="studio-check" key={p}><input type="checkbox" checked={presets.includes(p)} disabled={!presets.includes(p) && presets.length >= MAX_COMBINED} onChange={() => togglePreset(p)} />{EFFECT_LABELS[p]}</label>)}</div></div>
    {e.enabled && <>
      {!bannerOnly && <label className="studio-field">Animation scope<select value={e.scope} onChange={event => change({ scope: event.target.value })}>{['storefront', 'homepage', 'campaign', ...(allowBanner ? ['banner'] : [])].map(s => <option key={s} value={s}>{s === 'campaign' ? 'Campaign page' : s}</option>)}</select></label>}
      {e.scope === 'campaign' && <label className="studio-field">Target campaign page<select value={e.campaignId} onChange={event => change({ campaignId: event.target.value })}><option value="">Select a deal campaign</option>{deals.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>}
      <label className="studio-field">Intensity<select value={e.intensity} onChange={event => change({ intensity: event.target.value })}>{Object.keys(INTENSITY).map(level => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}</select></label>
      {presets.length > 1 && <p className="studio-help">Colours below apply to {EFFECT_LABELS[presets[0]]}; the other animations use their own palette.</p>}
      <div className="studio-colors">{e.colors.map((color, i) => <label key={i}>Color {i + 1}<input aria-label={`Particle color ${i + 1}`} type="color" value={color} onChange={event => change({ colors: e.colors.map((c, index) => index === i ? event.target.value : c) })} /></label>)}</div>
      <button type="button" disabled={e.colors.length >= 6} onClick={() => change({ colors: [...e.colors, '#FFD700'] })}>Add color</button><button type="button" disabled={e.colors.length <= 1} onClick={() => change({ colors: e.colors.slice(0, -1) })}>Remove color</button>
      {number('density', quantityLabel(presets), 1, 100, 1)}
      {number('speed', 'Speed', 0.2, 3, 0.1)}
      {number('size', 'Particle size', 0.5, 2, 0.1)}
      {number('opacity', 'Opacity', 0.05, 0.8, 0.05)}
      {presets.some(p => DRIFTING_PRESETS.includes(p)) &&<label className="studio-field">Drift direction<select value={e.direction} onChange={event => change({ direction: event.target.value })}><option value="down">Straight down</option><option value="left">Drift left</option><option value="right">Drift right</option></select></label>}
      {number('duration', 'Duration (seconds per viewing)', 0, 120, 1)}
      <label className="studio-field">Reduced-motion fallback<select value={e.reducedMotion} onChange={event => change({ reducedMotion: event.target.value })}><option value="hide">Hide animation</option><option value="static">Show a still frame</option></select></label>
      {['startAt', 'endAt'].map(key => <label className="studio-field" key={key}>{key === 'startAt' ? 'Effect start · IST' : 'Effect end · IST'}<input type="datetime-local" value={local(e[key])} onChange={event => change({ [key]: event.target.value ? new Date(`${event.target.value}:00+05:30`).toISOString() : null })} /></label>)}
    </>}
    <p className="studio-help">The animation is drawn only inside the festive header (or the top storefront header when no festive header is set) and never over the rest of the page. A duration of 0 loops while the header is visible. Effect dates are optional and stay within the parent publication schedule. Reduced motion and customer opt-out are respected.</p>
  </fieldset>;
}
