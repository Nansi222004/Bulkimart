// Storefront animation layer (web: components/Celebration.jsx + Canvas 2D renderer).
// The web renderer runs unchanged against a canvas-compatible recorder; each frame becomes a few batched SVG
// paths. Always clipped to its host (festive header, hero art, splash card, section banner); never full-screen.
// Reduced motion follows the admin's choice: hide, or show a still frame ('static').
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { startCelebration } from '../lib/celebrationRenderer';
import { effectActive } from '../shared/celebration';
import { useStorefrontNow } from '../context/StorefrontContext';

const FRAME_MS = 1000 / 24;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

// --- Canvas 2D subset used by the renderer, recorded in absolute coordinates (translate/rotate only) ---
function createRecorder() {
  let m = [1, 0, 0, 1, 0, 0];
  let style = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px serif' };
  const stack = [];
  let d = '';
  let batches = new Map();
  let texts = [];
  const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const angle = () => Math.atan2(m[1], m[0]);
  const f = n => Math.round(n * 10) / 10;
  const push = (kind, color, width) => {
    if (!d) return;
    const alpha = Math.max(0, Math.min(1, style.globalAlpha));
    if (alpha <= 0.005) return;
    const key = `${kind}|${color}|${f(alpha * 20) / 20}|${width || 0}`;
    const batch = batches.get(key) || { kind, color, alpha: f(alpha * 20) / 20, width, d: '' };
    batch.d += d;
    batches.set(key, batch);
  };
  const ctx = {
    get fillStyle() { return style.fillStyle; }, set fillStyle(v) { style.fillStyle = v; },
    get strokeStyle() { return style.strokeStyle; }, set strokeStyle(v) { style.strokeStyle = v; },
    get lineWidth() { return style.lineWidth; }, set lineWidth(v) { style.lineWidth = v; },
    get globalAlpha() { return style.globalAlpha; }, set globalAlpha(v) { style.globalAlpha = v; },
    get font() { return style.font; }, set font(v) { style.font = v; },
    textAlign: 'center', textBaseline: 'middle',
    save() { stack.push({ m: [...m], style: { ...style } }); },
    restore() { const s = stack.pop(); if (s) { m = s.m; style = s.style; } },
    setTransform(a, b, c, dd, e, ff) { m = [a, b, c, dd, e, ff]; },
    translate(x, y) { m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[0] * -s + m[2] * c, m[1] * -s + m[3] * c, m[4], m[5]]; },
    clearRect() { batches = new Map(); texts = []; },
    beginPath() { d = ''; },
    closePath() { d += 'Z'; },
    moveTo(x, y) { const [a, b] = pt(x, y); d += `M${f(a)} ${f(b)}`; },
    lineTo(x, y) { const [a, b] = pt(x, y); d += `L${f(a)} ${f(b)}`; },
    bezierCurveTo(x1, y1, x2, y2, x, y) { const p1 = pt(x1, y1), p2 = pt(x2, y2), p = pt(x, y); d += `C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p[0])} ${f(p[1])}`; },
    arc(x, y, r) { const [cx, cy] = pt(x, y); d += `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}Z`; },
    ellipse(x, y, rx, ry, rot) {
      const [cx, cy] = pt(x, y), a = rot + angle(), deg = f(a * 180 / Math.PI);
      const sx = cx + rx * Math.cos(a), sy = cy + rx * Math.sin(a), ox = cx - rx * Math.cos(a), oy = cy - rx * Math.sin(a);
      d += `M${f(sx)} ${f(sy)}A${f(rx)} ${f(ry)} ${deg} 1 0 ${f(ox)} ${f(oy)}A${f(rx)} ${f(ry)} ${deg} 1 0 ${f(sx)} ${f(sy)}Z`;
    },
    rect(x, y, w, h) { const p = [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]; d += `M${p.map(q => `${f(q[0])} ${f(q[1])}`).join('L')}Z`; },
    fill() { push('fill', style.fillStyle); },
    stroke() { push('stroke', style.strokeStyle, style.lineWidth); },
    fillRect(x, y, w, h) { const saved = d; d = ''; ctx.rect(x, y, w, h); push('fill', style.fillStyle); d = saved; },
    fillText(text, x, y) { const [a, b] = pt(x, y); texts.push({ text, x: a, y: b, size: parseFloat(style.font) || 12, alpha: style.globalAlpha }); },
  };
  return { ctx, frame: () => ({ batches: [...batches.values()], texts: [...texts] }) };
}

function Layer({ effect, width, height, still }) {
  const [frame, setFrame] = useState({ batches: [], texts: [] });
  const signature = JSON.stringify(effect);
  useEffect(() => {
    const recorder = createRecorder();
    const visibilityListeners = new Set();
    const appState = AppState.addEventListener('change', () => visibilityListeners.forEach(fn => fn()));
    const doc = {
      get hidden() { return AppState.currentState !== 'active'; },
      addEventListener: (_, fn) => visibilityListeners.add(fn),
      removeEventListener: (_, fn) => visibilityListeners.delete(fn),
    };
    let last = 0, pending = 0, alive = true;
    const env = {
      devicePixelRatio: 1,
      // Throttled to ~24 fps; one pending frame at a time.
      requestAnimationFrame: cb => {
        const tick = time => {
          if (!alive) return;
          if (time - last < FRAME_MS) { pending = requestAnimationFrame(tick); return; }
          last = time; pending = 0; cb(time); if (alive) setFrame(recorder.frame());
        };
        pending = requestAnimationFrame(tick);
        return pending;
      },
      cancelAnimationFrame: () => { if (pending) cancelAnimationFrame(pending); pending = 0; },
      addEventListener() {}, removeEventListener() {},
    };
    const canvas = { getContext: () => recorder.ctx, getBoundingClientRect: () => ({ width, height }), ownerDocument: doc };
    const stop = startCelebration(canvas, effect, env, { still });
    setFrame(recorder.frame());
    return () => { alive = false; stop(); appState.remove(); };
  }, [signature, width, height, still]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Svg width={width} height={height} pointerEvents="none">
    {frame.batches.map((b, i) => <Path key={i} d={b.d} fill={b.kind === 'fill' ? b.color : 'none'} stroke={b.kind === 'stroke' ? b.color : 'none'} strokeWidth={b.width || 0} opacity={b.alpha} />)}
    {frame.texts.map((t, i) => <SvgText key={`t${i}`} x={t.x} y={t.y + t.size * 0.35} fontSize={t.size} textAnchor="middle" opacity={t.alpha}>{t.text}</SvgText>)}
  </Svg>;
}

/** Decorative layer only. A published, active effect always plays; reduced motion follows the admin fallback. */
export default function Celebration({ effect }) {
  const now = useStorefrontNow();
  const reduced = useReducedMotion();
  const [size, setSize] = useState(null);
  const still = reduced && effect?.reducedMotion === 'static';
  const enabled = effectActive(effect, now) && (!reduced || still);
  const lastSize = useRef(null);
  if (!enabled) return null;
  return <View pointerEvents="none" style={styles.layer} importantForAccessibility="no-hide-descendants"
    onLayout={e => { const { width, height } = e.nativeEvent.layout; const key = `${Math.round(width)}x${Math.round(height)}`; if (lastSize.current !== key) { lastSize.current = key; setSize({ width, height }); } }}>
    {size && size.width > 0 && size.height > 0 && <Layer effect={effect} width={size.width} height={size.height} still={still} />}
  </View>;
}

const styles = StyleSheet.create({ layer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', zIndex: 1 } });
