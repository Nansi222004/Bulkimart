import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './StorefrontMedia';
import { startCelebration } from '../../../utils/celebrationRenderer';
import { effectActive } from '../../../../../backend/shared/celebration.mjs';
const key = 'bulkimart:decorations-disabled';
let memoryPreference = false;
const readPreference = () => { try { return localStorage.getItem(key) === '1'; } catch { return memoryPreference; } };
export function useDecorationPreference() {
  const [disabled, setDisabled] = useState(readPreference);
  useEffect(() => { const update = () => setDisabled(readPreference()); const local = event => setDisabled(event.detail); window.addEventListener('storage', update); window.addEventListener('bulkimart:decorations', local); return () => { window.removeEventListener('storage', update); window.removeEventListener('bulkimart:decorations', local); }; }, []);
  return [disabled, value => { memoryPreference = value; try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* Preference survives route changes in memory. */ } setDisabled(value); window.dispatchEvent(new CustomEvent('bulkimart:decorations', { detail: value })); }];
}
export default function Celebration({ effect, now = Date.now(), contained = false, preview = false }) {
  const canvas = useRef(null), reduced = useReducedMotion(), [disabled] = useDecorationPreference();
  const enabled = effectActive(effect, now) && !reduced && (preview || !disabled);
  // Server refresh returns new objects; stable settings must not restart a completed effect.
  const signature = JSON.stringify(effect);
  useEffect(() => { if (enabled && canvas.current) return startCelebration(canvas.current, effect); }, [enabled, signature]);
  return enabled ? <canvas ref={canvas} aria-hidden="true" className="sf-celebration" style={{ position: contained ? 'absolute' : 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: contained ? 1 : 250 }} /> : null;
}
export function DecorationToggle() {
  const [disabled, setDisabled] = useDecorationPreference();
  return <button type="button" className="sf-decoration-toggle" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>{disabled ? 'Enable celebrations' : 'Turn off celebrations'}</button>;
}
