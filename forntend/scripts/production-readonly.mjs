// Public HTTP/Engine.IO diagnostics only: no credentials, orders or payments.
import { io } from 'socket.io-client';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'https://bulkimart.in';
const api = 'https://api.bulkimart.in';
const report = { measuredAt: new Date().toISOString(), http: [], sockets: [] };
async function get(url, options = {}) {
  const start = performance.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  report.http.push({ url, method: options.method || 'GET', status: response.status, ms: Math.round(performance.now() - start),
    allowOrigin: response.headers.get('access-control-allow-origin'), cacheControl: response.headers.get('cache-control') });
  return { response, body };
}
const { body: html } = await get(origin);
report.viewport = html.match(/name="viewport" content="([^"]+)"/)?.[1];
const bundle = html.match(/src="([^"]+\.js)"/)?.[1];
const css = html.match(/href="([^"]+\.css)"/)?.[1];
report.bundle = bundle;
if (bundle) {
  const { body } = await get(new URL(bundle, origin));
  report.bundleSignals = Object.fromEntries(['Verifying your session', 'IDEMPOTENCY_CONFLICT', 'CHECKOUT_IN_PROGRESS', 'checkout session is no longer valid', api].map(value => [value, body.includes(value)]));
}
if (css) {
  const { body } = await get(new URL(css, origin));
  // Only layout declarations; no user or application data.
  report.unscopedHeadings = body.match(/(?:^|\})h[1-3](?:,[^{]+)?\{[^}]+\}/g)?.slice(0, 12);
}
await get(`${api}/api/auth/me`, { headers: { Origin: origin } });
await get(`${api}/api/auth/me`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
for (const transports of [['polling'], ['websocket'], ['polling', 'websocket']]) {
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const result = { transports, run, opened: false, upgraded: false };
    await new Promise(resolve => {
      const client = io(api, { autoConnect: false, reconnection: false, forceNew: true, transports, timeout: 8000 });
      let done = false;
      const finish = outcome => { if (done) return; done = true; result.outcome = outcome; result.ms = Math.round(performance.now() - start); clearTimeout(timer); client.disconnect(); resolve(); };
      const timer = setTimeout(() => finish('timeout'), 10000);
      client.io.on('open', () => {
        result.opened = true;
        result.transport = client.io.engine.transport.name;
        client.io.engine.on('upgrade', transport => { result.upgraded = true; result.transport = transport.name; });
      });
      client.on('connect', () => finish('unexpected anonymous namespace connection'));
      client.on('connect_error', error => {
        // Auth rejection is expected, and proves the polling SID survived its
        // namespace POST. Do not record URLs, SIDs or raw transport responses.
        finish(/Authentication required/.test(error.message) ? 'expected authentication rejection' : 'transport or handshake failure');
      });
      client.connect();
    });
    report.sockets.push(result);
  }
}
const output = resolve('../test-artifacts/production-readonly');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
