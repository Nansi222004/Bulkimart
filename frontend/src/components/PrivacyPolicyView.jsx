import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/api';

/**
 * Read-only privacy policy (admin-managed CMS) for one audience:
 * slug 'seller-policy' or 'delivery-policy'. Used by the seller and delivery portals' Privacy Policy pages.
 */
const PrivacyPolicyView = ({ slug }) => {
  const [policy, setPolicy] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  const load = useCallback(async (signal) => {
    setState('loading');
    try {
      const res = await fetch(apiUrl(`/api/privacy-policy/${slug}`), { signal });
      const body = await res.json();
      if (!res.ok || !body.success || !body.data) throw new Error('unavailable');
      setPolicy(body.data);
      setState('ready');
    } catch (err) {
      if (err?.name !== 'AbortError') setState('error');
    }
  }, [slug]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const card = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '14px 16px' };
  if (state === 'loading') return <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: 13 }} role="status">Loading privacy policy…</div>;
  if (state === 'error') {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: 13 }} role="alert">
        <p style={{ margin: '0 0 10px' }}>Privacy policy is not available right now.</p>
        <button type="button" onClick={() => load()} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 }}>Retry</button>
      </div>
    );
  }

  const updated = new Date(policy.effectiveDate || policy.updatedAt);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: '#0f172a', minWidth: 0, overflowWrap: 'anywhere' }}>
      <div style={card}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{policy.roleTitle || 'Privacy policy'}</h2>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
          Version {policy.version || '1.0.0'}{Number.isNaN(updated.getTime()) ? '' : ` • Updated ${updated.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
        </p>
        {policy.summary && <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.6, color: '#475569' }}>{policy.summary}</p>}
      </div>
      {(policy.sections || []).map((sec, idx) => (
        <section key={sec.id || idx} style={card}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{sec.title}</h3>
          {sec.content && <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>{sec.content}</p>}
          {sec.points?.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
              {sec.points.map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
};

export default PrivacyPolicyView;
