import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';

export default function GstIntakeStatus() {
  const [state, setState] = useState('loading'), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState('loading');
    boundedFetch(apiUrl('/api/sellers/gst-assistance/capabilities'), { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || typeof body.data?.enabled !== 'boolean') throw Error('Invalid capability response');
        if (!controller.signal.aborted) setState(body.data.enabled ? 'enabled' : 'disabled');
      }).catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [attempt]);
  return <div className={`gst-intake-status gst-intake-${state}`} role="status">
    <strong>{state === 'enabled' ? 'Accepting GST assistance requests' : state === 'disabled' ? 'GST assistance intake is disabled' : state === 'error' ? 'Could not check GST assistance intake' : 'Checking GST assistance intake…'}</strong>
    {state === 'disabled' && <p>Sellers cannot select “Apply through Bulkimart” on this backend. Enable GST_ASSISTANCE_ENABLED and, for production, GST_ASSISTANCE_PRODUCTION_ENABLED in the deployed backend environment, then restart it.</p>}
    <button type="button" disabled={state === 'loading'} onClick={() => setAttempt(n => n + 1)}>Recheck intake</button>
  </div>;
}
