import test from 'node:test';
import assert from 'node:assert/strict';
import { startCelebration } from '../src/utils/celebrationRenderer.js';
import { DEFAULT_EFFECT, EFFECT_PRESETS, effectApplies } from '../../backend/shared/celebration.mjs';
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
  const shape = { snowfall: 'arc', petals: 'ellipse', sparkles: 'moveTo', confetti: 'rect' }[preset];
  assert.equal(h.calls.filter(c => c[0] === shape).length, 200);
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
