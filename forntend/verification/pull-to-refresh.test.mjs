import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { attachPullGesture, THRESHOLD } = await vite.ssrLoadModule('/src/components/pullToRefresh/pullGesture.js');
const { registerRefresh, runRefresh } = await vite.ssrLoadModule('/src/utils/refreshRegistry.js');

// A minimal scroll element: records listeners, lets the test fire touches.
const fakeEl = (scrollTop = 0) => {
  const listeners = {};
  return {
    scrollTop,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: name => { delete listeners[name]; },
    fire: (name, y, x = 100, extra = {}) => {
      const event = { touches: [{ clientX: x, clientY: y }], target: { closest: () => null }, cancelable: true, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
      listeners[name]?.(event);
      return event;
    },
  };
};
const harness = (el, release = () => true) => {
  const log = [];
  const detach = attachPullGesture(el, { onProgress: value => log.push(value), onRelease: value => { log.push(['release', value]); return release(value); } });
  return { log, detach };
};

test('pulling far enough from the top and releasing triggers a refresh', () => {
  const el = fakeEl(), { log } = harness(el);
  el.fire('touchstart', 100);
  const move = el.fire('touchmove', 100 + THRESHOLD * 2 + 10);
  el.fire('touchend', 0);
  assert.equal(move.prevented, true); // the browser's own pull is suppressed
  assert.deepEqual(log.at(-1), ['release', THRESHOLD + 5]);
});

test('a short pull springs back without refreshing', () => {
  const el = fakeEl(), { log } = harness(el);
  el.fire('touchstart', 100); el.fire('touchmove', 130); el.fire('touchend', 0);
  assert.equal(log.at(-1), 0);
  assert.ok(!log.some(entry => Array.isArray(entry)));
});

test('nothing happens when the page is scrolled down, or for upward and sideways drags', () => {
  for (const [top, dy, dx] of [[40, 200, 0], [0, -80, 0], [0, 20, 90]]) {
    const el = fakeEl(top), { log } = harness(el);
    el.fire('touchstart', 100, 100);
    const move = el.fire('touchmove', 100 + dy, 100 + dx);
    el.fire('touchend', 0);
    assert.equal(move.prevented, false);
    assert.deepEqual(log, []);
  }
});

test('a pull that starts on a map or slider is left to it, and the gesture can be disabled', () => {
  const el = fakeEl(), { log } = harness(el);
  el.fire('touchstart', 100, 100, { target: { closest: () => ({}) } });
  el.fire('touchmove', 300); el.fire('touchend', 0);
  assert.deepEqual(log, []);
  const off = fakeEl(), seen = [];
  attachPullGesture(off, { isDisabled: () => true, onProgress: value => seen.push(value), onRelease: () => true });
  off.fire('touchstart', 100); off.fire('touchmove', 300); off.fire('touchend', 0);
  assert.deepEqual(seen, []);
});

test('detaching removes the listeners', () => {
  const el = fakeEl(), { log, detach } = harness(el);
  detach();
  el.fire('touchstart', 100); el.fire('touchmove', 300);
  assert.deepEqual(log, []);
});

test('the page on screen decides what refreshing does; none registered means no handler', async () => {
  assert.equal(await runRefresh(), false);
  const calls = [];
  const off1 = registerRefresh(async () => { calls.push('list'); });
  const off2 = registerRefresh(async () => { calls.push('detail'); });
  assert.equal(await runRefresh(), true);
  assert.deepEqual(calls, ['detail']); // the most recent page wins
  off2(); await runRefresh();
  assert.deepEqual(calls, ['detail', 'list']);
  off1();
  assert.equal(await runRefresh(), false);
});

test.after(async () => { await vite.close(); });
