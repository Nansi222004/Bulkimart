import React, { useEffect, useState } from 'react';

/**
 * Title bar for Legal Services and Send a Parcel, matching the customer app:
 * the storefront's header colour (admin theme), a Back button and the page
 * title — no storefront search or category strip.
 *
 * Back steps up within the service (e.g. a service's detail → its list),
 * and from the service's own start page returns to Home.
 */
const TITLES = {
  'legal-services': (path) => (/^\/legal-services\/requests/.test(path) ? 'My Legal Requests' : 'Legal Services'),
  'parcel-delivery': (path) => (/^\/parcel-delivery\/history/.test(path) ? 'Delivery History'
    : /^\/parcel-delivery\/track/.test(path) ? 'Track Parcel' : 'Send a Parcel'),
};

export default function ServiceAppBar({ section, onHome }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener('app:locationchange', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('app:locationchange', update); };
  }, []);

  // Back returns to the Services tab these pages are opened from (on the matching toggle). The one step that stays
  // inside the service: a single legal request goes back to the My requests list.
  const back = () => {
    const clean = path.replace(/\/+$/, '');
    if (section === 'legal-services' && /^\/legal-services\/requests\/[^/]+$/.test(clean)) {
      window.history.pushState(null, '', '/legal-services/requests');
      window.dispatchEvent(new Event('app:locationchange'));
      return;
    }
    // Opened from the Account page (My Legal Service Requests): Back returns there.
    if (window.history.state?.fromNav === 'account') {
      window.history.pushState({ nav: 'account' }, '', '/account');
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      return;
    }
    if (TITLES[section]) {
      window.history.pushState({ nav: 'services' }, '', section === 'legal-services' ? '/services?tab=legal' : '/services');
      window.dispatchEvent(new Event('popstate'));
      return;
    }
    onHome();
  };

  return (
    <header className="service-appbar">
      <button type="button" className="service-appbar-back" onClick={back} aria-label="Back">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
      </button>
      <p className="service-appbar-title">{(TITLES[section] || (() => ''))(path)}</p>
    </header>
  );
}
