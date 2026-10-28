import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from './StorefrontMedia';
import { startCelebration } from '../../../utils/celebrationRenderer';
import { effectActive } from '../../../../../backend/shared/celebration.mjs';
// Decorative layer only. It is always absolutely positioned inside its host
// (festive header, hero art, splash card or section banner), which clips it.
// There is deliberately no viewport-fixed mode.
export const LAYER_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 };
// A published, active effect always plays; there is no customer opt-out. Only the
// device's reduced-motion setting changes it, following the admin's fallback choice.
export default function Celebration({ effect, now = Date.now() }) {
  const canvas = useRef(null), reduced = useReducedMotion();
  const still = reduced && effect?.reducedMotion === 'static';
  const enabled = effectActive(effect, now) && (!reduced || still);
  // Server refresh returns new objects; stable settings must not restart a completed effect.
  const signature = JSON.stringify(effect);
  useEffect(() => { if (enabled && canvas.current) return startCelebration(canvas.current, effect, window, { still }); }, [enabled, signature, still]);
  return enabled ? <canvas ref={canvas} aria-hidden="true" className="sf-celebration" data-preset={effect.preset} style={LAYER_STYLE} /> : null;
}
