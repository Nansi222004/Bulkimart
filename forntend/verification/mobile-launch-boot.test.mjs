import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const cacheKey = 'bulkimart:experience:quick:mobile:';
const fixture = () => ({ version: 'current', banners: [], sections: [], validUntil: new Date(Date.now() + 30000).toISOString(),
  splash: { id: 'campaign', revision: 1, banner: { image: 'https://fixture.invalid/art.webp' }, config: { frequency: 'launch' }, endAt: new Date(Date.now() + 30000).toISOString() } });
function boot({ data = fixture(), seen = false, denied = false, connected = true, live = null, path = '/grocery--home' } = {}) {
  const images = [], timers = [], values = new Map([[cacheKey, JSON.stringify(data)]]);
  const storage = { getItem(key) { if (denied) throw Error('denied'); return seen && key.startsWith('bulkimart:splash:') ? '1' : values.get(key) || null; }, setItem(key, value) { if (denied) throw Error('denied'); values.set(key, value); } };
  const element = { isConnected: connected, style: { setProperty() {} }, classList: { add() {} }, parentNode: { appendChild(image) { images.push(image); } } };
  const context = { location: { origin: 'https://fixture.invalid', pathname: path, search: '', hash: '' }, document: { querySelector: () => element },
    matchMedia: () => ({ matches: true }), localStorage: storage,
    Image: class { remove() { const index = images.indexOf(this); if (index !== -1) images.splice(index, 1); } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
    window: { sessionStorage: storage, localStorage: storage, matchMedia: () => ({ matches: true }), fetch: true },
    fetch: async () => ({ ok: true, json: async () => ({ data: live }) }) };
  runInNewContext(script, context);
  return { images, timers, values, context };
}

test('boot paints fresh cached artwork and never consumes its frequency before React takes over', () => {
  const result = boot();
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].src, fixture().splash.banner.image);
  assert.equal([...result.values.keys()].some(key => key.startsWith('bulkimart:splash:')), false);
  result.timers[0].fn(); assert.equal(result.images.length, 0, 'Preview cannot outlive the publication');
});
for (const frequency of ['session', 'daily', 'version']) test(`boot respects already-seen ${frequency} campaigns`, () => {
  const data = fixture(); data.splash.config.frequency = frequency;
  assert.equal(boot({ data, seen: true }).images.length, 0);
});
for (const reason of ['expired cache', 'expired campaign', 'future campaign', 'schedule boundary', 'no campaign']) test(`boot skips ${reason}`, () => {
  const data = fixture(), past = new Date(Date.now() - 1000).toISOString();
  if (reason === 'expired cache') data.validUntil = past;
  if (reason === 'expired campaign') data.splash.endAt = past;
  if (reason === 'future campaign') data.splash.startAt = new Date(Date.now() + 60000).toISOString();
  if (reason === 'schedule boundary') data.scheduleUntil = past;
  if (reason === 'no campaign') data.splash = null;
  assert.equal(boot({ data }).images.length, 0);
});
test('boot tolerates storage denial and does not insert artwork after React owns the root', async () => {
  const denied = boot({ denied: true, live: fixture() });
  await denied.context.window.__bulkimartEarlyExperience.promise;
  assert.equal(denied.images.length, 1, 'Live response still works without storage');
  const replaced = boot({ connected: false, live: fixture() });
  await replaced.context.window.__bulkimartEarlyExperience.promise;
  assert.equal(replaced.images.length, 0);
});
test('boot leaves checkout and partner routes alone', () => {
  for (const path of ['/checkout', '/seller', '/admin', '/delivery']) assert.equal(boot({ path }).images.length, 0);
});
