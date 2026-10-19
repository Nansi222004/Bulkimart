export function friendlyMessage(value, fallback = 'Something went wrong. Please try again.') {
  const message = typeof value === 'string' ? value : '';
  if (!message.trim() || /\b(?:Bearer\s+\S+|E11000|MongoServerError|TypeError|ReferenceError|stack trace|secret[_ -]?key|access[_ -]?token)\b|\n\s*at\s/i.test(message)) return fallback;
  return message.slice(0, 2500);
}

export function feedbackScope() {
  if (typeof window === 'undefined') return 'server';
  const role = window.location.pathname.split('/')[1];
  const key = role === 'seller' ? 'sellerToken' : role === 'admin' ? 'adminToken' : role === 'delivery' ? 'deliveryToken' : 'userToken';
  try { return `${role === 'seller' || role === 'admin' || role === 'delivery' ? role : 'customer'}:${localStorage.getItem(key) || 'guest'}`; }
  catch { return `${key}:guest`; }
}

export const logoutDecision = { title: 'Log out?', message: 'Are you sure you want to log out of your account?', cancelLabel: 'Stay logged in', confirmLabel: 'Log out' };

export function decisionOptions(value) {
  if (typeof value !== 'string') return value;
  if (/log\s*out|sign out/i.test(value)) return logoutDecision;
  const destructive = /delete|remove|cancel|reject|revoke|suspend|disable|discard|unpublish/i.test(value);
  const title = /discard/i.test(value) ? 'Discard unsaved changes?' : /delete|remove/i.test(value) ? 'Delete this item?' : /cancel.*order/i.test(value) ? 'Cancel this order?' : 'Please confirm';
  return { title, message: value, destructive, confirmLabel: /discard/i.test(value) ? 'Discard changes' : /delete|remove/i.test(value) ? 'Delete' : /cancel/i.test(value) ? 'Confirm cancellation' : 'Continue', cancelLabel: 'Cancel' };
}

export function createFeedbackController({ scope = feedbackScope, now = Date.now } = {}) {
  let state = { dialog: null, toasts: [] }, sequence = 0;
  const listeners = new Set();
  const publish = next => { state = next; listeners.forEach(fn => fn()); };
  const valid = request => request.scope === scope() && request.owner?.active !== false;
  const finish = (request, result) => {
    if (state.dialog?.id !== request.id) return;
    publish({ ...state, dialog: null }); request.resolve(result);
  };
  const controller = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    captureScope: scope,
    clear() {
      const active = state.dialog;
      publish({ dialog: null, toasts: [] });
      active?.resolve(active.input ? null : false);
    },
    cancelOwner(owner) { if (state.dialog?.owner === owner) finish(state.dialog, state.dialog.input ? null : false); },
    dismiss(id) { publish({ ...state, toasts: state.toasts.filter(item => item.id !== id) }); },
    notify(message, options = {}) {
      const boundScope = options.scope ?? scope();
      if (boundScope !== scope() || options.owner?.active === false) return;
      const text = friendlyMessage(message);
      const type = options.type || (/failed|unable|could not|error|invalid|denied|exceed|try again/i.test(text) ? 'error' : /success|saved|copied|updated|added|deleted|submitted/i.test(text) ? 'success' : 'info');
      // An operation error belongs to its open confirmation as well as its caller.
      if (type === 'error' && state.dialog?.busy && valid(state.dialog)) {
        publish({ ...state, dialog: { ...state.dialog, error: text } }); return;
      }
      const duration = options.persistent ? 0 : options.duration ?? (type === 'error' ? 12000 : Math.min(12000, Math.max(5000, text.length * 65)));
      const item = { id: ++sequence, message: text, type, scope: boundScope, expires: duration ? now() + duration : null };
      publish({ ...state, toasts: [...state.toasts.filter(row => row.message !== text), item].slice(-3) });
      return item.id;
    },
    ask(options, binding = {}) { return controller.open(options, null, false, binding); },
    collect(message, options = {}, binding = {}) { return controller.open({ title: 'Add details', message, confirmLabel: 'Continue', ...options }, options.action || null, true, binding); },
    perform(options, action, binding = {}) { return controller.open(options, action, false, binding); },
    open(options, action, input, binding) {
      // A second click cannot queue a second mutation or share an affirmative result.
      if (state.dialog || binding.owner?.active === false || (binding.scope && binding.scope !== scope())) return Promise.resolve(input ? null : false);
      return new Promise(resolve => {
        const request = { ...decisionOptions(options), id: ++sequence, action, input, value: '', busy: false, error: '', scope: binding.scope ?? scope(), owner: binding.owner, resolve };
        publish({ ...state, dialog: request });
      });
    },
    change(value) { if (state.dialog && !state.dialog.busy) publish({ ...state, dialog: { ...state.dialog, value, error: '' } }); },
    cancel() { const request = state.dialog; if (request && !request.busy) finish(request, request.input ? null : false); },
    async accept() {
      const request = state.dialog;
      if (!request || request.busy) return;
      if (!valid(request)) { finish(request, request.input ? null : false); return; }
      if (request.input && request.required !== false && !request.value.trim()) {
        publish({ ...state, dialog: { ...request, error: 'Please enter a value before continuing.' } }); return;
      }
      if (!request.action) { finish(request, request.input ? request.value.trim() : true); return; }
      publish({ ...state, dialog: { ...request, busy: true, error: '' } });
      try {
        const result = await request.action(request.value.trim());
        if (state.dialog?.id !== request.id) return;
        if (!valid(request)) { finish(request, false); return; }
        if (result === false || result?.ok === false) throw new Error(result?.message || state.dialog.error || 'The action could not be completed. Please try again.');
        if (state.dialog.error) { publish({ ...state, dialog: { ...state.dialog, busy: false } }); return; }
        finish(request, result ?? true);
      } catch (error) {
        if (state.dialog?.id === request.id && valid(request)) publish({ ...state, dialog: { ...state.dialog, busy: false, error: friendlyMessage(error?.message) } });
        else finish(request, false);
      }
    },
    scoped(owner, boundScope) {
      const binding = { owner, scope: boundScope };
      return { ask: options => controller.ask(options, binding), collect: (message, options) => controller.collect(message, options, binding), perform: (options, action) => controller.perform(options, action, binding), notify: (message, options) => controller.notify(message, { ...options, ...binding }) };
    },
  };
  return controller;
}

export const feedback = createFeedbackController();
