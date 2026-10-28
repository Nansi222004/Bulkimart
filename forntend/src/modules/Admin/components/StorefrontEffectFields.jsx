import React from 'react';
import { DEFAULT_EFFECT, EFFECT_PRESETS, EFFECT_COLORS, DRIFTING_PRESETS, INTENSITY, MAX_COMBINED, MAX_CUSTOM, DEFAULT_CUSTOM, CUSTOM_MOTIONS, CUSTOM_SHAPES, effectPresets, effectLabel } from '../../../../../backend/shared/celebration.mjs';
const local = value => value ? new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16) : '';
// Quantity means different things per preset; only relevant settings are shown.
const quantityLabel = presets => presets.length > 1 ? 'Particle quantity (per animation)' : ({ lights: 'Bulbs on the light string', fireworks: 'Sparks per burst (×2)' })[presets[0]] || 'Particle quantity';
const newCustomId = () => `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sameCustom = (a, b) => ['name', 'motion', 'shape', 'emoji'].every(key => a[key] === b[key]) && a.colors.join() === b.colors.join();
// Swatches with add/remove controls; `label` names each picker for assistive technology.
const colorPicker = (colors, set, label) => <div className="studio-swatches">
  {colors.map((color, i) => <label className="studio-swatch" key={i}><input aria-label={label(i)} type="color" value={color} onChange={event => set(colors.map((old, index) => index === i ? event.target.value : old))} /><span>{color.toUpperCase()}</span></label>)}
  <button type="button" className="studio-swatch-action" aria-label="Add color" title="Add color" disabled={colors.length >= 6} onClick={() => set([...colors, '#FFD700'])}>+</button>
  <button type="button" className="studio-swatch-action" aria-label="Remove color" title="Remove color" disabled={colors.length <= 1} onClick={() => set(colors.slice(0, -1))}>−</button>
</div>;
// `library` lists custom animations saved on other themes and campaigns so they can be reused.
export default function StorefrontEffectFields({ value, onChange, bannerOnly = false, allowBanner = false, deals = [], library = [] }) {
  const e = { ...DEFAULT_EFFECT, ...(bannerOnly ? { scope: 'banner' } : {}), ...value };
  const change = patch => onChange({ ...e, ...patch });
  const customs = e.customs || [], presets = e.enabled ? effectPresets(e) : [];
  // The first selected built-in preset owns the shared colour pickers.
  const builtIn = list => list.find(p => EFFECT_PRESETS.includes(p)), primary = builtIn(presets);
  const select = next => {
    if (!next.length) return change({ enabled: false, presets: [] });
    const nextPrimary = builtIn(next);
    change({ enabled: true, presets: next, preset: next[0], ...(nextPrimary && nextPrimary !== primary ? { colors: [...EFFECT_COLORS[nextPrimary]] } : {}) });
  };
  const togglePreset = preset => select(presets.includes(preset) ? presets.filter(p => p !== preset) : [...presets, preset]);
  const updateCustom = (id, patch) => change({ customs: customs.map(c => c.id === id ? { ...c, ...patch } : c) });
  // A new or reused animation is selected straight away when there is room.
  const addCustom = (template = {}) => {
    const custom = { ...DEFAULT_CUSTOM, name: `Custom ${customs.length + 1}`, ...template, id: newCustomId(), colors: [...(template.colors || DEFAULT_CUSTOM.colors)] };
    const next = presets.length < MAX_COMBINED ? [...presets, custom.id] : presets;
    change({ customs: [...customs, custom], enabled: true, presets: next, preset: next[0] });
  };
  const removeCustom = id => {
    const next = presets.filter(p => p !== id), fallback = EFFECT_PRESETS.includes(e.preset) ? e.preset : DEFAULT_EFFECT.preset;
    change({ customs: customs.filter(c => c.id !== id), presets: next, preset: next[0] || fallback, ...(next.length ? {} : { enabled: false }) });
  };
  const reusable = library.filter((c, i) => c && !customs.some(own => sameCustom(own, c)) && library.findIndex(other => other && sameCustom(other, c)) === i);
  const drifting = presets.some(p => DRIFTING_PRESETS.includes(p) || ['fall', 'rise'].includes(customs.find(c => c.id === p)?.motion));
  const number = (key, label, min, max, step) => <label className="studio-field" key={key}>{label}<input type="number" min={min} max={max} step={step} value={e[key]} onChange={event => change({ [key]: Number(event.target.value) })} /></label>;
  return <fieldset className="studio-effect-fields"><legend>Festive animation</legend>
    <label className="studio-check studio-switch"><input type="checkbox" checked={e.enabled} onChange={event => change({ enabled: event.target.checked })} />Enable festive animation</label>
    <div className="studio-effect-section" role="group" aria-label="Animation types">
      <div className="studio-section-title"><strong>Animation types</strong><span>{presets.length}/{MAX_COMBINED} selected · combine up to {MAX_COMBINED}</span></div>
      <div className="studio-preset-options">{[...EFFECT_PRESETS, ...customs.map(c => c.id)].map(p => <label className="studio-chip" data-custom={!EFFECT_PRESETS.includes(p) || undefined} key={p}><input type="checkbox" checked={presets.includes(p)} disabled={!presets.includes(p) && presets.length >= MAX_COMBINED} onChange={() => togglePreset(p)} />{effectLabel(e, p)}</label>)}</div>
    </div>
    <div className="studio-effect-section studio-custom-animations" role="group" aria-label="Custom animations">
      <div className="studio-section-title"><strong>Custom animations</strong><span>{customs.length}/{MAX_CUSTOM}</span></div>
      <p className="studio-help">Pick how it moves, a shape or any emoji (🪔 ✨ 🎈) and its colours. It is saved with this {bannerOnly ? 'banner' : 'configuration'} and appears in the animation types above.</p>
      {customs.map(c => <div className="studio-custom-animation" key={c.id}>
        <div className="studio-custom-head">
          <label className="studio-field">Name<input maxLength={40} value={c.name} onChange={event => updateCustom(c.id, { name: event.target.value })} /></label>
          <button type="button" className="studio-link-danger" onClick={() => removeCustom(c.id)}>{`Delete ${c.name || 'custom animation'}`}</button>
        </div>
        <div className="studio-pair">
          <label className="studio-field">Motion<select value={c.motion} onChange={event => updateCustom(c.id, { motion: event.target.value })}>{Object.entries(CUSTOM_MOTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="studio-field">Shape<select value={c.shape} onChange={event => updateCustom(c.id, { shape: event.target.value })}>{Object.entries(CUSTOM_SHAPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        {c.shape === 'emoji' && <label className="studio-field">Emoji or symbol<input maxLength={16} placeholder="🪔" value={c.emoji} onChange={event => updateCustom(c.id, { emoji: event.target.value })} /></label>}
        {colorPicker(c.colors, colors => updateCustom(c.id, { colors }), i => `${c.name || 'Custom animation'} color ${i + 1}`)}
      </div>)}
      <div className="studio-custom-actions">
        <button type="button" className="studio-secondary" disabled={customs.length >= MAX_CUSTOM} onClick={() => addCustom()}>+ Create custom animation</button>
        {reusable.length > 0 && customs.length < MAX_CUSTOM && <label className="studio-field">Reuse a custom animation<select value="" onChange={event => event.target.value !== '' && addCustom(reusable[Number(event.target.value)])}><option value="">From another theme or campaign…</option>{reusable.map((c, i) => <option key={i} value={i}>{c.name} · {CUSTOM_MOTIONS[c.motion]} {c.shape === 'emoji' ? c.emoji : CUSTOM_SHAPES[c.shape]}</option>)}</select></label>}
      </div>
    </div>
    {e.enabled && <div className="studio-effect-section">
      <div className="studio-section-title"><strong>Settings</strong></div>
      {!bannerOnly && <label className="studio-field">Animation scope<select value={e.scope} onChange={event => change({ scope: event.target.value })}>{['storefront', 'homepage', 'campaign', ...(allowBanner ? ['banner'] : [])].map(s => <option key={s} value={s}>{s === 'campaign' ? 'Campaign page' : s}</option>)}</select></label>}
      {e.scope === 'campaign' && <label className="studio-field">Target campaign page<select value={e.campaignId} onChange={event => change({ campaignId: event.target.value })}><option value="">Select a deal campaign</option>{deals.map(d => <option key={d._id} value={d._id}>{d.name}</option>)}</select></label>}
      {primary && <div className="studio-field">Colours{presets.length > 1 && <span className="studio-field-hint">Apply to {effectLabel(e, primary)}. Other built-in animations keep their own palette; custom animations use their own colours.</span>}
        {colorPicker(e.colors, colors => change({ colors }), i => `Particle color ${i + 1}`)}</div>}
      <div className="studio-effect-grid">
        <label className="studio-field">Intensity<select value={e.intensity} onChange={event => change({ intensity: event.target.value })}>{Object.keys(INTENSITY).map(level => <option key={level} value={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}</select></label>
        {number('density', quantityLabel(presets), 1, 100, 1)}
        {number('speed', 'Speed', 0.2, 3, 0.1)}
        {number('size', 'Particle size', 0.5, 2, 0.1)}
        {number('opacity', 'Opacity', 0.05, 0.8, 0.05)}
        {number('duration', 'Duration (seconds, 0 = loop)', 0, 120, 1)}
        {drifting && <label className="studio-field">Drift direction<select value={e.direction} onChange={event => change({ direction: event.target.value })}><option value="down">Straight down</option><option value="left">Drift left</option><option value="right">Drift right</option></select></label>}
        <label className="studio-field">Reduced-motion fallback<select value={e.reducedMotion} onChange={event => change({ reducedMotion: event.target.value })}><option value="hide">Hide animation</option><option value="static">Show a still frame</option></select></label>
        {['startAt', 'endAt'].map(key => <label className="studio-field" key={key}>{key === 'startAt' ? 'Effect start · IST' : 'Effect end · IST'}<input type="datetime-local" value={local(e[key])} onChange={event => change({ [key]: event.target.value ? new Date(`${event.target.value}:00+05:30`).toISOString() : null })} /></label>)}
      </div>
    </div>}
    <p className="studio-help">The animation is drawn only inside the festive header (or the top storefront header when no festive header is set) and never over the rest of the page. Effect dates are optional and stay within the parent publication schedule. Reduced motion and customer opt-out are respected.</p>
  </fieldset>;
}
