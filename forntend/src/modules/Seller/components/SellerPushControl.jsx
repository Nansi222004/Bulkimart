import React, { useEffect, useRef, useState } from 'react';
import { initPushNotifications } from '../../../utils/firebaseMessaging';

const messages = {
  denied: 'Notifications are blocked. Allow notifications in browser site settings, then retry.',
  default: 'Permission was not granted. Choose Enable to try again.',
  unconfigured: 'Push is not configured. Ask the administrator to configure Firebase and the Web Push VAPID key.',
  unsupported: 'Push is unavailable in this browser. Use a supported browser over HTTPS.',
  unauthenticated: 'Sign in again to enable order notifications.',
  session_changed: 'Your session changed. Sign in again to enable notifications.',
  worker_registration_failed: 'Could not start the notification service. Check your connection and retry.',
  registration_failed: 'Could not register this device with Bulkimart. Check your connection and retry.',
  unavailable: 'Could not create the push subscription. Check browser settings and your connection, then retry.',
  timeout: 'Notification setup timed out. Check your connection and retry.',
};

export default function SellerPushControl({ register = initPushNotifications }) {
  const [state, setState] = useState({ status: 'idle' });
  const busy = useRef(false);
  const alive = useRef(false);
  const run = async (requestPermission) => {
    if (busy.current) return;
    busy.current = true;
    setState({ status: 'pending' });
    try {
      const result = await register({ requestPermission });
      if (alive.current) setState(typeof result === 'string' && result
        ? { status: 'enabled' } : (result || { status: 'unavailable' }));
    } catch {
      if (alive.current) setState({ status: 'unavailable' });
    } finally { busy.current = false; }
  };
  useEffect(() => {
    alive.current = true;
    // Restore granted subscriptions and verify registration with the backend.
    // This never requests permission; permission requires the button click.
    run(false);
    return () => { alive.current = false; };
  }, [register]);
  const pending = state.status === 'pending';
  return <section className="seller-push-control" aria-label="Order notification settings" aria-busy={pending}>
    {state.status === 'enabled'
      ? <span className="seller-push-enabled" role="status">Notifications enabled</span>
      : <>
        <button className="seller-push-enable" type="button" disabled={pending} onClick={() => run(true)}>
          {pending ? 'Enabling notifications…' : 'Enable order notifications'}
        </button>
        <span className="seller-push-status" role="status" data-push-error={state.code || ''}>
          {pending ? 'Connecting this device…' : messages[state.status] || ''}
        </span>
      </>}
  </section>;
}
