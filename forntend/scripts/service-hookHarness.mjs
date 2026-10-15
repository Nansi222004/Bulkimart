import React from 'react';

// Controlled hook/effect execution for the actual components. Fetch deliberately
// ignores AbortSignal, exercising generation guards as well as cancellation.
// This is not a DOM/browser E2E harness.
export function hookHarness(Component, props = {}, path = '/admin/services', contextValue, storage) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  const target = new EventTarget(); let url = new URL(path, 'http://localhost');
  globalThis.window = { location: { get search() { return url.search; }, get pathname() { return url.pathname; } },
    history: { pushState(_s, _t, next) { url = new URL(next, url); }, replaceState(_s, _t, next) { url = new URL(next, url); } },
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target), confirm: () => true };
  globalThis.localStorage = storage?.localStorage || { getItem: () => 'fixture-only-token' };
  if (storage?.sessionStorage) globalThis.sessionStorage = storage.sessionStorage;
  const requests = [], slots = []; let cursor = 0, dirty = true, tree, effects = [], updates = 0, unmounted = false;
  globalThis.fetch = (requestUrl, options = {}) => new Promise((resolve, reject) => requests.push({ url: requestUrl, options, reject,
    resolve(data, status = 200) { resolve({ ok: status < 400, status, json: async () => data }); } }));
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const dispatcher = {
    useContext(context) { cursor++; return contextValue ?? context._currentValue; },
    useState(init) {
      const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof init === 'function' ? init() : init };
      return [slots[i].value, next => { const v = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(v, slots[i].value)) { slots[i].value = v; dirty = true; updates++; } }];
    },
    useRef(init) { const i = cursor++; return slots[i] ??= { current: init }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const flush = () => {
    for (let count = 0; dirty && !unmounted; count++) {
      if (count > 30) throw new Error('Component render loop');
      dirty = false; cursor = 0; effects = [];
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, old = internals.H;
      try { internals.H = dispatcher; tree = Component(props); } finally { internals.H = old; }
      for (const effect of effects) effect();
    }
    return tree;
  };
  function find(predicate, node = tree) {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { if (child === undefined) continue; const found = find(predicate, child); if (found) return found; }
  }
  const unmount = () => { if (!unmounted) { unmounted = true; slots.forEach(s => s?.cleanup?.()); } };
  flush();
  return { requests, flush, find, get updates() { return updates; }, get tree() { return tree; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); return flush(); },
    click(label) { const button = find(n => n.type === 'button' && n.props.children === label); if (!button) throw new Error(`Button not found: ${label}`); const result = button.props.onClick(); flush(); return result; },
    unmount, close() { unmount(); for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } },
  };
}
