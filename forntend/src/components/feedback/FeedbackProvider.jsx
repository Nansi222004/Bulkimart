import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { feedback, feedbackScope } from '../../utils/feedback';
import './feedback.css';
import useVisualViewport from '../../hooks/useVisualViewport';
import { lockModal, isTopModal } from '../../utils/modalLayer';

export function useFeedback() {
  const owner = useRef({ active: true });
  const scope = feedbackScope();
  useEffect(() => { const current = owner.current; current.active = true; return () => { current.active = false; feedback.cancelOwner(current); }; }, []);
  return useMemo(() => feedback.scoped(owner.current, scope), [scope]);
}

export default function FeedbackProvider({ children }) {
  const state = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
  const dialogRef = useRef(null);
  const bounds = useVisualViewport(Boolean(state.dialog));
  useEffect(() => {
    let scope = feedbackScope(), path = window.location.pathname;
    const changed = () => {
      const next = feedbackScope(), nextPath = window.location.pathname;
      if (next !== scope || nextPath !== path) feedback.clear();
      scope = next; path = nextPath;
    };
    const events = ['storage', 'popstate', 'app:locationchange', 'bulkimart:session-changed', 'bulkimart:seller-session-changed', 'bulkimart:admin-session-changed'];
    events.forEach(event => window.addEventListener(event, changed));
    const timer = setInterval(changed, 500);
    return () => { clearInterval(timer); events.forEach(event => window.removeEventListener(event, changed)); feedback.clear(); };
  }, []);
  useEffect(() => {
    const timers = state.toasts.filter(item => item.expires).map(item => setTimeout(() => feedback.dismiss(item.id), Math.max(0, item.expires - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);
  useEffect(() => {
    if (!state.dialog) return;
    const previous = document.activeElement, layer = dialogRef.current;
    const unlock = lockModal(layer);
    dialogRef.current?.querySelector('[data-initial-focus]')?.focus();
    const keydown = event => {
      if (!isTopModal(layer)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); feedback.cancel(); }
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')].filter(el => el.getClientRects().length);
      if (!controls.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      unlock();
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus?.();
    };
  }, [state.dialog?.id]);
  const request = state.dialog;
  return <>{children}{createPortal(<>
    <div className="feedback-toasts" aria-label="Notifications">{state.toasts.map(item => <div className={`feedback-toast feedback-toast--${item.type}`} key={item.id} role={item.type === 'error' ? 'alert' : 'status'}>
      <span className="feedback-toast-icon" aria-hidden="true">{{ success: '✓', error: '!', warning: '⚠', info: 'i' }[item.type]}</span>
      <div><strong>{{ success: 'Success', error: 'Error', warning: 'Warning', info: 'Information' }[item.type]}</strong><p>{item.message}</p></div>
      <button type="button" aria-label="Dismiss notification" onClick={() => feedback.dismiss(item.id)}>×</button>
    </div>)}</div>
    {request && <div className="feedback-backdrop" style={bounds ? {...bounds,right:'auto',bottom:'auto'} : undefined} onClick={event => { if (event.target === event.currentTarget) feedback.cancel(); }}>
      <section ref={dialogRef} className="feedback-dialog" role="alertdialog" aria-modal="true" aria-labelledby="feedback-title" aria-describedby="feedback-description" aria-busy={request.busy} tabIndex={-1}>
        <h2 id="feedback-title">{request.title || 'Please confirm'}</h2>
        <p id="feedback-description">{request.message}</p>
        <form onSubmit={event => { event.preventDefault(); void feedback.accept(); }}>
          {request.input && <label htmlFor="feedback-value">{request.inputLabel || 'Details'}{request.required === false ? ' (optional)' : ''}<textarea id="feedback-value" data-initial-focus rows={3} maxLength={request.maxLength || 2000} value={request.value} disabled={request.busy} aria-invalid={!!request.error} aria-describedby={request.error ? 'feedback-error' : undefined} onChange={event => feedback.change(event.target.value)} /></label>}
          {request.error && <p id="feedback-error" className="feedback-error" role="alert">{request.error}</p>}
          {request.busy && <p role="status">Working… Please wait.</p>}
          <div className="feedback-actions"><button data-initial-focus={!request.input || undefined} type="button" disabled={request.busy} onClick={() => feedback.cancel()}>{request.cancelLabel || 'Cancel'}</button><button type="submit" className={request.destructive ? 'feedback-destructive' : 'feedback-primary'} disabled={request.busy}>{request.busy ? 'Working…' : request.confirmLabel || 'Continue'}</button></div>
        </form>
      </section>
    </div>}
  </>, document.body)}</>;
}
