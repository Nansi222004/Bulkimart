import React, { useEffect, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
export default function CouponsSection() {
  const { activeMode, currentUser, setActiveNav } = useUser(), { now } = useStorefront();
  const [coupons, setCoupons] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false; const controller = new AbortController(), session = captureUserSession();
    setCoupons([]); setError('');
    if (!currentUser || !session.token) return;
    const load = async () => {
      setLoading(true);
      try {
        const response = await boundedFetch(apiUrl(`/api/coupons/available?channel=${activeMode === 'quick' ? 'grocery' : 'ecommerce'}`), { signal: controller.signal, headers: { Authorization: `Bearer ${session.token}` } });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.data)) throw new Error('Offers could not be loaded. Please retry.');
        if (!cancelled && isCurrentUserSession(session)) { setCoupons(body.data); setError(''); }
      } catch (err) { if (!cancelled) { setCoupons([]); setError(err.message); } }
      finally { if (!cancelled) setLoading(false); }
    };
    load(); const timer = setInterval(load, 30000);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
  }, [activeMode, currentUser?._id, attempt]);
  const visible = coupons.filter(c => !c.expiresAt || Date.parse(c.expiresAt) > now);
  return <section className="sf-section"><div className="sf-section-heading"><div><span className="sf-eyebrow">OFFERS FOR YOUR BASKET</span><h2>Coupons & savings</h2></div></div>
    {!currentUser ? <p>Sign in to see available coupons. <button className="sf-cta" onClick={() => setActiveNav('account')}>Sign in</button></p> : error ? <p role="alert">{error} <button onClick={() => setAttempt(v => v + 1)}>Retry</button></p> : loading && !visible.length ? <p role="status">Checking available offers…</p> : !visible.length ? <p>No published coupons are available for this storefront right now.</p> : visible.map(c => <article className="sf-coupon" key={c.code}><div><h3>{c.title || c.code}</h3><p>{c.description}</p><p>{c.applicable ? c.freeShipping ? 'Delivery offer is eligible for your current basket.' : `Current basket saving: ₹${c.savingNow}` : c.reason}</p>{c.expiresAt && <small>Valid until {new Date(c.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</small>}</div><div><strong>{c.code}</strong><button className="sf-add" onClick={async () => { try { await navigator.clipboard.writeText(c.code); setMessage(`${c.code} copied`); } catch { setMessage(`Use code ${c.code} at checkout`); } }}>Copy code</button></div></article>)}
    {message && <p role="status">{message}</p>}{!!visible.length && <p>Eligibility and savings are checked again at checkout. <button className="sf-text-button" onClick={() => setActiveNav('cart')}>Open cart →</button></p>}
  </section>;
}
