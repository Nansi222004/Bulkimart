import React, { useEffect, useState } from 'react';
import ModalPortal from './ModalPortal';
import { apiUrl } from '../utils/api';
import './RegistrationTerms.css';

export default function RegistrationTerms({ audience = 'user' }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setPolicy(null); setError('');
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/privacy-policy/${audience}-policy`), { signal: controller.signal });
        const body = await res.json();
        if (!res.ok || !body.success || !body.data || body.data.isPublished === false) throw new Error('This policy is currently unavailable. Please try again.');
        if (!cancelled) setPolicy(body.data);
      } catch (err) {
        if (!cancelled) setError('This policy could not be loaded. Please try again.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [open, audience, attempt]);
  return <>
    <button type="button" className="registration-terms-link" onClick={() => setOpen(true)} aria-haspopup="dialog">Terms &amp; Conditions</button>
    {open && <ModalPortal className="registration-policy-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <section className="registration-policy-dialog" role="dialog" aria-modal="true" aria-labelledby={`registration-policy-title-${audience}`}>
        <header><h2 id={`registration-policy-title-${audience}`}>Terms &amp; Conditions</h2><button type="button" aria-label="Close registration policy" onClick={() => setOpen(false)}>×</button></header>
        <div className="registration-policy-content">
          {loading && <p role="status">Loading policy…</p>}
          {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>Retry loading policy</button></div>}
          {policy && <>
            <h3>{policy.roleTitle}</h3>
            {policy.version && <p className="registration-policy-version">Version {policy.version}</p>}
            {policy.summary && <p>{policy.summary}</p>}
            {[...(policy.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((section, index) => <section key={section.id || index}>
              <h4>{section.title}</h4><p>{section.content}</p>
              {section.points?.length > 0 && <ul>{section.points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
            </section>)}
          </>}
        </div>
        <footer><button type="button" onClick={() => setOpen(false)}>Back to registration</button></footer>
      </section>
    </ModalPortal>}
  </>;
}
