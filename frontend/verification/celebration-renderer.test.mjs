import test from 'node:test';
import assert from 'node:assert/strict';
import { startCelebration } from '../src/utils/celebrationRenderer.js';
import { DEFAULT_EFFECT, EFFECT_PRESETS, MAX_PARTICLES, effectApplies, particleCount } from '../../backend/shared/celebration.mjs';
function fixture() {
  const calls = [], frames = new Map(), doc = new EventTarget(), events = new EventTarget(); let id = 0, disconnected = 0, visible;
  doc.hidden = false;
  const ctx = new Proxy({}, { get: (_target, key) => (...args) => calls.push([key, ...args]), set: () => true });
  const canvas = { ownerDocument: doc, getContext: () => ctx, getBoundingClientRect: () => ({ width: 390, height: 500 }) };
  const env = { devicePixelRatio: 4, requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), ResizeObserver: class { observe() {} disconnect() { disconnected++; } }, IntersectionObserver: class { constructor(callback) { visible = callback; } observe() {} disconnect() { disconnected++; } } };
  const tick = time => { const entry = frames.entries().next().value; if (!entry) return; frames.delete(entry[0]); entry[1](time); };
  return { canvas, env, doc, events, frames, calls, tick, show: value => visible([{ isIntersecting: value }]), get disconnected() { return disconnected; } };
}
for (const preset of EFFECT_PRESETS) test(`${preset} draws bounded particles at capped resolution and cleans up`, () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset, density: 1000 }, h.env);
  assert.equal(h.frames.size, 0); h.show(true); assert.equal(h.frames.size, 1);
  h.tick(1); h.tick(34);
  const shape = { snowfall: 'arc', petals: 'ellipse', sparkles: 'moveTo', confetti: 'rect', lights: 'arc', fireworks: 'arc' }[preset];
  // Lights: halo + bulb for floor(390/16) bulbs. Fireworks: one burst of 33 sparks. Others: 100 capped particles.
  assert.equal(h.calls.filter(c => c[0] === shape).length, { lights: 2 * 2 * 24, fireworks: 2 * 33 }[preset] ?? 200);
  assert.equal(h.canvas.width, 780); assert.equal(h.canvas.height, 1000);
  h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.frames.size, 0);
  h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.frames.size, 1);
  h.show(false); assert.equal(h.frames.size, 0); h.show(true); assert.equal(h.frames.size, 1);
  stop(); assert.equal(h.frames.size, 0); assert.equal(h.disconnected, 2);
  const count = h.calls.length; h.events.dispatchEvent(new Event('resize')); h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.frames.size, 0); assert.equal(h.calls.length, count);
});
test('duration stops rendering permanently; hidden time does not consume visible duration', () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, duration: 1 }, h.env); h.show(true); h.tick(1);
  h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange'));
  h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange')); h.tick(100001); assert.equal(h.frames.size, 1);
  for (let i = 1; i <= 25; i++) h.tick(100001 + i * 50);
  assert.equal(h.frames.size, 0); h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.frames.size, 0); stop();
  const slow = fixture(), stopSlow = startCelebration(slow.canvas, { ...DEFAULT_EFFECT, duration: 1 }, slow.env);
  slow.show(true); slow.tick(1); slow.tick(1501); assert.equal(slow.frames.size, 0); stopSlow();
});
test('route targeting excludes product overlays and unrelated campaign pages', () => {
  assert.equal(effectApplies({ scope: 'homepage' }, { activeNav: 'home' }), true);
  for (const route of [{ activeNav: 'checkout' }, { activeNav: 'home', selectedProduct: {} }, { activeNav: 'home', selectedCampaignId: 'other' }]) assert.equal(effectApplies({ scope: 'homepage' }, route), false);
  assert.equal(effectApplies({ scope: 'campaign', campaignId: 'deal' }, { selectedCampaignId: 'deal' }), true);
  assert.equal(effectApplies({ scope: 'campaign', campaignId: 'deal' }, { selectedCampaignId: 'other' }), false);
});
const arcsPerFrame = (h, from) => h.calls.slice(from).filter(c => c[0] === 'arc').length;
test('intensity scales particle quantity and never exceeds the particle cap', () => {
  assert.equal(particleCount({ density: 40, intensity: 'low' }), 20);
  assert.equal(particleCount({ density: 40, intensity: 'medium' }), 40);
  assert.equal(particleCount({ density: 40, intensity: 'high' }), 60);
  assert.equal(particleCount({ density: 100, intensity: 'high' }), MAX_PARTICLES);
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'snowfall', density: 10, intensity: 'low' }, h.env); h.show(true); h.tick(1);
  assert.equal(h.calls.filter(c => c[0] === 'arc').length, 5); stop();
});
test('fireworks keep at most three bursts and 100 sparks at maximum intensity over time', () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'fireworks', density: 100, intensity: 'high', speed: 3, duration: 0 }, h.env); h.show(true);
  let peak = 0;
  for (let i = 0; i < 400; i++) { const from = h.calls.length; h.tick(1 + i * 16); peak = Math.max(peak, arcsPerFrame(h, from)); }
  assert.ok(peak > 0 && peak <= MAX_PARTICLES, `peak sparks ${peak}`); assert.equal(h.frames.size, 1); stop();
});
test('duration 0 loops while visible instead of stopping', () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, duration: 0 }, h.env); h.show(true);
  for (let i = 0; i < 200; i++) h.tick(1 + i * 50);
  assert.equal(h.frames.size, 1); stop(); assert.equal(h.frames.size, 0);
});
test('reduced-motion still frame draws once and schedules no animation frames', () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'lights' }, h.env, { still: true });
  assert.equal(h.frames.size, 0); assert.equal(h.calls.filter(c => c[0] === 'arc').length, 48);
  h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.frames.size, 0); stop();
  const f = fixture(), stopFireworks = startCelebration(f.canvas, { ...DEFAULT_EFFECT, preset: 'fireworks' }, f.env, { still: true });
  assert.ok(f.calls.some(c => c[0] === 'arc')); assert.equal(f.frames.size, 0); stopFireworks();
});
test('lights and fireworks stay inside the canvas box at maximum size and intensity', () => {
  for (const preset of ['lights', 'fireworks']) {
    const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset, direction: 'right', density: 100, intensity: 'high', size: 2, duration: 0 }, h.env); h.show(true);
    for (let i = 0; i < 120; i++) h.tick(1 + i * 16);
    // Lights and fireworks draw in canvas coordinates: every centre stays within the 390×500 box.
    for (const [, x, y] of h.calls.filter(c => c[0] === 'arc')) assert.ok(x >= 0 && x <= 390 && y >= 0 && y <= 500, `${preset} drew outside its box at ${x},${y}`);
    stop();
  }
});
test('drift direction moves falling particles sideways', () => {
  const random = Math.random; Math.random = () => 0.5;
  try {
    const xAfter = direction => { const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'snowfall', density: 1, direction, duration: 0 }, h.env); h.show(true); for (let i = 0; i < 40; i++) h.tick(1 + i * 50); stop(); return h.calls.filter(c => c[0] === 'translate').at(-1)[1]; };
    const down = xAfter('down'); assert.ok(xAfter('right') > down + 10); assert.ok(xAfter('left') < down - 10);
  } finally { Math.random = random; }
});
test('combined presets share one canvas loop and each keeps its own palette', () => {
  const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'lights', presets: ['lights', 'snowfall'], colors: ['#123456'], density: 1000 }, h.env); h.show(true);
  h.tick(1); h.tick(34);
  assert.equal(h.frames.size, 1, 'One animation frame drives every preset');
  assert.equal(h.calls.filter(c => c[0] === 'clearRect').length, 2, 'The canvas is cleared once per frame, not once per preset');
  // Lights: 2 frames × 2 arcs × 24 bulbs; snowfall: 2 frames × 100 flakes.
  assert.equal(h.calls.filter(c => c[0] === 'arc').length, 2 * 2 * 24 + 200);
  stop(); assert.equal(h.frames.size, 0);
});
const custom = patch => ({ id: 'custom-a', name: 'Mine', motion: 'fall', shape: 'star', emoji: '', colors: ['#00FF00'], ...patch });
test('custom animations draw their own shape, emoji and motion inside the canvas box', () => {
  for (const [def, call] of [[custom(), 'lineTo'], [custom({ shape: 'heart', motion: 'rise' }), 'bezierCurveTo'], [custom({ shape: 'emoji', emoji: '🪔', motion: 'twinkle' }), 'fillText'], [custom({ shape: 'diamond', motion: 'burst' }), 'lineTo']]) {
    const h = fixture(), stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: def.id, presets: [def.id], customs: [def], density: 30, size: 2, duration: 0 }, h.env); h.show(true);
    for (let i = 0; i < 60; i++) h.tick(1 + i * 16);
    assert.ok(h.calls.some(c => c[0] === call), `${def.motion} ${def.shape} uses ${call}`);
    if (def.shape === 'emoji') assert.ok(h.calls.filter(c => c[0] === 'fillText').every(c => c[1] === '🪔'));
    for (const [, x, y] of h.calls.filter(c => c[0] === 'translate')) assert.ok(x >= -20 && x <= 410 && y >= 0 && y <= 500, `${def.motion} drew outside its box at ${x},${y}`);
    stop();
  }
});
test('rising custom animations move upwards and unknown preset ids draw nothing', () => {
  const h = fixture(), def = custom({ motion: 'rise', shape: 'circle' });
  const stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, presets: [def.id, 'custom-gone'], customs: [def], density: 1 }, h.env); h.show(true);
  h.tick(1); h.tick(34); h.tick(67);
  const ys = h.calls.filter(c => c[0] === 'translate').map(c => c[2]);
  assert.equal(ys.length, 3); assert.ok(ys[2] < ys[1] || ys[2] - ys[1] > 400, 'Particle rises (or wraps to the bottom)');
  stop();
});
test('festive lanterns rise out of the top and return from the bottom, looping indefinitely', () => {
  for (const height of [500, 120]) {
    const h = fixture(); h.canvas.getBoundingClientRect = () => ({ width: 390, height });
    const stop = startCelebration(h.canvas, { ...DEFAULT_EFFECT, preset: 'lights', duration: 0 }, h.env); h.show(true);
    // Two minutes of frames: the default duration loops, so the animation never stops.
    for (let i = 0; i < 2400; i++) h.tick(1 + i * 50);
    assert.equal(h.frames.size, 1, 'Still animating after two minutes');
    const first = h.calls.filter(c => c[0] === 'translate').filter((_, i) => i % 3 === 0).map(c => c[2]);
    const wraps = first.filter((y, i) => i && y > first[i - 1] + height / 2).length;
    assert.ok(first.slice(1, 20).every((y, i) => y <= first[i] + 1e-9 || y > first[i] + height / 2), 'Lanterns move upwards');
    assert.ok(Math.min(...first) < 0 && Math.max(...first) > height, 'Lanterns leave through the top and enter from below');
    assert.ok(wraps >= 2, `The lantern restarts from the bottom repeatedly (${wraps} cycles at ${height}px)`);
    assert.equal(h.calls.some(c => c[0] === 'fillText'), false);
    stop();
  }
});
