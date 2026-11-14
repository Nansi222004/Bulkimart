import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import AccountPageHeader from '../components/AccountPageHeader';

const POLICY_TABS = [
  { slug: 'user-policy', label: 'User', icon: '👤' },
  { slug: 'seller-policy', label: 'Seller', icon: '🏪' },
];

/** /privacy-policy — the admin-managed privacy policy as its own page. Readable without signing in. */
const PrivacyPolicyPage = () => {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('role');
    return POLICY_TABS.some((t) => t.slug === `${requested}-policy`) ? `${requested}-policy` : 'user-policy';
  });
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(apiUrl(`/api/privacy-policy/${tab}`))
      .then((res) => res.json())
      .then((body) => { if (alive) setPolicy(body.success && body.data ? body.data : null); })
      .catch(() => { if (alive) setPolicy(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab]);

  return (
    <div className="account-subpage">
      <AccountPageHeader title="Privacy Policy" />
      <div className="account-subpage-body" style={{ gap: 16 }}>
        <div role="tablist" aria-label="Whose policy" style={{ display: 'grid', gridTemplateColumns: `repeat(${POLICY_TABS.length}, 1fr)`, gap: '8px' }}>
          {POLICY_TABS.map((t) => {
            const isActive = tab === t.slug;
            return (
              <button key={t.slug} type="button" role="tab" aria-selected={isActive} onClick={() => setTab(t.slug)}
                style={{
                  padding: '10px 6px', borderRadius: '12px',
                  border: isActive ? '2px solid var(--sf-action, #D91430)' : '1px solid #cbd5e1',
                  backgroundColor: isActive ? 'var(--sf-highlight, #FFF0B3)' : '#ffffff',
                  color: isActive ? 'var(--sf-action-hover, #B50918)' : '#475569',
                  fontSize: '12px', fontWeight: isActive ? '800' : '600', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                  boxShadow: isActive ? '0 2px 8px color-mix(in srgb, var(--sf-primary, #B50918) 14%, transparent)' : 'none',
                }}>
                <span style={{ fontSize: '16px' }} aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ backgroundColor: '#ffffff', padding: '30px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Loading privacy policy...</p>
          </div>
        ) : !policy ? (
          <div style={{ backgroundColor: '#ffffff', padding: '30px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Privacy policy content unavailable for this role.</p>
          </div>
        ) : (
          <>
            <div style={{ backgroundColor: '#ffffff', padding: '16px 20px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'var(--sf-highlight, #FFF0B3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sf-action-hover, #B50918)', flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{policy.roleTitle}</h2>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    Version {policy.version || '1.0.0'} • Updated {new Date(policy.effectiveDate || policy.updatedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </div>
              {policy.summary && <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.6', color: '#475569' }}>{policy.summary}</p>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(policy.sections || []).map((sec, idx) => (
                <section key={sec.id || idx} style={{ backgroundColor: '#ffffff', padding: '14px 16px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                  <h3 style={{ fontSize: '13px', color: '#0f172a', margin: '0 0 4px', fontWeight: 700 }}>{sec.title}</h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>{sec.content}</p>
                  {sec.points && sec.points.length > 0 && (
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: '18px', fontSize: '11.5px', color: '#475569', lineHeight: '1.6' }}>
                      {sec.points.map((pt, pIdx) => <li key={pIdx}>{pt}</li>)}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PrivacyPolicyPage;
