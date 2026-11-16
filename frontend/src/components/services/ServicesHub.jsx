// The Services tab on the mobile website — the same screen as the customer app's Services tab
// (mobile-user/src/components/services/ServicesHub.jsx): a Parcel | Legal Services toggle at the top and the
// selected service below. Colours come from the admin's storefront theme (CSS variables), never a fixed palette.
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ClipboardList, History, MapPin, Package, Scale, Search } from 'lucide-react';
import { serviceIcon } from './serviceIcons';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import { parcelMoney, parcelRequest } from '../parcels/parcelApi';
import { parcelBookingEnabled } from '../parcels/parcelAvailability';
import { parcelCustomerStatus } from '../parcels/ParcelCustomerStatus';
import { ParcelVehicleIcon } from '../parcels/ParcelBookingFlow';
import { useLegalApi } from './LegalServices';
import './ServicesHub.css';

const ID = /^[a-f\d]{24}$/i;
const ACTIVE = ['payment_pending', 'searching_for_driver', 'needs_admin_assignment', 'driver_assigned', 'driver_arriving', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff'];
const signedIn = () => { try { return Boolean(localStorage.getItem('userToken')); } catch { return false; } };
// In-app navigation, the same way the storefront already moves between its pages (pushState + popstate).
const go = (path) => { window.history.pushState(null, '', path); window.dispatchEvent(new Event('popstate')); };


// Header tabs: big cards with the icon above the label; the selected card joins a tinted strip with its tagline.
export const SERVICE_TABS = [
  ['parcel', 'Parcel', Package, 'Doorstep pickup | Live tracking'],
  ['legal', 'Legal Services', Scale, 'Expert paperwork | Prices include GST'],
];

export default function ServicesHub() {
  // /services?tab=legal (the home page's Services tile) opens with Legal Services selected.
  const [tab, setTabState] = useState(() => new URLSearchParams(window.location.search).get('tab') === 'legal' ? 'legal' : 'parcel');
  const setTab = (next) => {
    setTabState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'legal') params.set('tab', 'legal'); else params.delete('tab');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : ''));
  };
  return <section className="services-hub" aria-label="Services">
    <header className="services-hub-head">
      {/* Quick links to the customer's own history: legal requests and parcel deliveries. */}
      <div className="services-hub-topbar">
        <h1>Services</h1>
        <nav className="services-hub-shortcuts" aria-label="My services">
          <button type="button" onClick={() => go(signedIn() ? '/legal-services/requests' : '/account')}>
            <ClipboardList size={20} aria-hidden="true" /><span>My requests</span>
          </button>
          <button type="button" onClick={() => go(signedIn() ? '/parcel-delivery/history' : '/account')}>
            <History size={20} aria-hidden="true" /><span>My parcels</span>
          </button>
        </nav>
      </div>
      <div className="services-hub-toggle" role="tablist">
        {SERVICE_TABS.map(([key, label, Icon]) => {
          const on = key === tab;
          return <button key={key} type="button" role="tab" aria-selected={on} className={on ? 'active' : ''} onClick={() => setTab(key)}>
            <Icon size={24} aria-hidden="true" /><span>{label}</span>
          </button>;
        })}
      </div>
      <div className="services-hub-tagline" aria-hidden="true" />
    </header>
    {tab === 'parcel' ? <ParcelPanel /> : <LegalPanel />}
  </section>;
}

function Section({ title, action, onAction, children }) {
  return <div className="services-hub-section">
    <div className="services-hub-section-head">
      <h2>{title}</h2>
      {action ? <button type="button" className="services-hub-link" onClick={onAction}>{action}</button> : null}
    </div>
    {children}
  </div>;
}

export function ParcelPanel() {
  const [state, setState] = useState('loading'), [vehicles, setVehicles] = useState([]), [recent, setRecent] = useState([]);
  const loggedIn = signedIn();
  useEffect(() => {
    const ctl = new AbortController();
    const get = async (path) => {
      const r = await boundedFetch(apiUrl(`/api/parcel-delivery/${path}`), { signal: ctl.signal });
      if (!r.ok) throw new Error('unavailable');
      return (await r.json()).data;
    };
    (async () => {
      const flags = await get('capabilities');
      if (!parcelBookingEnabled(flags)) { if (!ctl.signal.aborted) setState('disabled'); return; }
      const policy = await get('catalogue');
      if (ctl.signal.aborted) return;
      setVehicles(Array.isArray(policy?.vehicles) ? policy.vehicles : []);
      setState(policy?.ready === true ? 'enabled' : 'disabled');
    })().catch(() => { if (!ctl.signal.aborted) setState('error'); });
    if (loggedIn) parcelRequest('customer', '/bookings?page=1', { signal: ctl.signal })
      .then((b) => { if (!ctl.signal.aborted && Array.isArray(b.data)) setRecent(b.data.slice(0, 3)); }).catch(() => {});
    return () => ctl.abort();
  }, [loggedIn]);
  const book = () => go('/parcel-delivery/book');
  const track = (id) => go(`/parcel-delivery/track/${id}`);
  const active = recent.find((b) => ACTIVE.includes(b.status));
  const past = recent.filter((b) => b !== active).slice(0, 2);
  const open = state === 'enabled';

  return <div className="services-hub-panel">
    {active ? <button type="button" className="services-hub-live" onClick={() => track(active._id)}>
      <span className="services-hub-live-dot" aria-hidden="true" />
      <span className="services-hub-grow"><small>PARCEL IN PROGRESS</small><strong>{parcelCustomerStatus(active.status)}</strong></span>
      <span className="services-hub-live-track">Track</span><ChevronRight size={18} aria-hidden="true" />
    </button> : null}

    {/* The customer's real task first: from where, to where. */}
    <button type="button" className="services-hub-route" onClick={open ? book : undefined} disabled={!open} aria-label="Book a parcel: choose pickup and drop">
      <h2>Send a parcel</h2>
      <p className="services-hub-muted">Doorstep pickup, live tracking, cash or online payment</p>
      <span className="services-hub-route-row"><span className="services-hub-stop" aria-hidden="true" /><span className="services-hub-field">Pickup location</span></span>
      <span className="services-hub-route-line" aria-hidden="true" />
      <span className="services-hub-route-row"><MapPin size={16} className="services-hub-pin" aria-hidden="true" /><span className="services-hub-field">Drop location</span></span>
      {state === 'loading' ? <p className="services-hub-note" role="status">Checking availability…</p>
        : state === 'error' ? <p className="services-hub-note" role="alert">Could not check availability. Refresh the page to try again.</p>
          : !open ? <p className="services-hub-note">New bookings are paused right now. Your existing parcels are still tracked.</p>
            : <span className="services-hub-primary">Book a parcel</span>}
    </button>

    {vehicles.length > 0 && <Section title="Vehicles">
      <p className="services-hub-muted services-hub-sub">Pick the one that fits your parcel while booking.</p>
      <div className="services-hub-vehicles">
        {vehicles.map((v) => <div key={v.id} className="services-hub-vehicle">
          <ParcelVehicleIcon icon={v.icon} size={34} />
          <strong>{v.name}</strong>
          {v.maxWeightKg ? <small className="services-hub-muted">Up to {v.maxWeightKg} kg</small> : null}
        </div>)}
      </div>
    </Section>}

    <Section title="How it works">
      <ol className="services-hub-steps">
        {[['Book', 'Add pickup, drop and parcel details. See the fare before you confirm.'],
          ['Hand over', 'Share the pickup code with the delivery partner when they arrive.'],
          ['Track & receive', 'Follow it live. The receiver shares the delivery code to complete.']].map(([title, body], i) =>
          <li key={title}><span className="services-hub-step-no">{i + 1}</span><span><strong>{title}</strong><span className="services-hub-muted">{body}</span></span></li>)}
      </ol>
    </Section>

    <Section title="Recent parcels" action={loggedIn ? 'See all' : undefined} onAction={() => go('/parcel-delivery/history')}>
      {past.length ? past.map((b) => <button key={b._id} type="button" className="services-hub-recent" onClick={() => track(b._id)}>
        <ParcelVehicleIcon icon={b.service?.icon || 'parcel'} size={26} />
        <span className="services-hub-grow">
          <strong>{b.service?.name || 'Parcel'} · {parcelMoney(b.feePaise)}</strong>
          <small className="services-hub-muted">{parcelCustomerStatus(b.status)} · {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>)
        : <p className="services-hub-muted">{loggedIn ? 'Your parcels will appear here.' : 'Sign in to see your parcels.'}</p>}
    </Section>
  </div>;
}

export function LegalPanel() {
  const request = useLegalApi();
  const [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [items, setItems] = useState([]), [state, setState] = useState('loading');
  useEffect(() => { const id = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(id); }, [query]);
  useEffect(() => {
    const ctl = new AbortController(); setState('loading');
    request(`/api/customer-services?q=${encodeURIComponent(search)}&page=1`, { signal: ctl.signal }).then((b) => {
      if (ctl.signal.aborted) return;
      setItems(Array.isArray(b.data) ? b.data.filter((s) => ID.test(s?._id || '')) : []); setState('ready');
    }).catch((e) => { if (!ctl.signal.aborted && e.name !== 'AbortError') setState('error'); });
    return () => ctl.abort();
  }, [request, search]);
  const open = useCallback((id) => go(`/legal-services/${id}`), []);
  // Buy opens the service straight at its order form; paying needs the details/documents that service asks for.
  const buy = useCallback((id) => go(`/legal-services/${id}?buy=1`), []);
  return <div className="services-hub-panel">
    <label className="services-hub-search">
      <Search size={18} aria-hidden="true" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} placeholder="Search company setup, trademark, GST…" aria-label="Search services" />
    </label>
    <Section title="Business & legal services">
      <p className="services-hub-muted services-hub-sub">Prices include GST. Our experts handle the paperwork.</p>
      {state === 'loading' ? <p className="services-hub-muted" role="status">Loading services…</p>
        : state === 'error' ? <p className="services-hub-muted" role="alert">Services could not be loaded. Refresh the page to try again.</p>
          : !items.length ? <p className="services-hub-muted">{search ? 'No service matches your search.' : 'No services are available right now.'}</p>
            : <div className="services-hub-list">
              {items.map((s) => {
                const Icon = serviceIcon(s.name), paise = s.fee?.totalPaise;
                return <article key={s._id} className="services-hub-card">
                  <div className="services-hub-card-top">
                    <span className="services-hub-icon-tile"><Icon size={22} aria-hidden="true" /></span>
                    <span className="services-hub-grow">
                      <strong>{s.name}</strong>
                      {s.description ? <small className="services-hub-muted">{s.description}</small> : null}
                    </span>
                  </div>
                  <div className="services-hub-card-foot">
                    <span className="services-hub-price-row">
                      <span className={paise > 0 ? 'services-hub-price' : 'services-hub-price services-hub-muted'}>{paise > 0 ? `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Price after review'}</span>
                      {paise > 0 ? <small className="services-hub-muted">incl. GST</small> : null}
                    </span>
                    <span className="services-hub-tile-actions">
                      <button type="button" className="services-hub-view" onClick={() => open(s._id)} aria-label={`View ${s.name}`}>View</button>
                      <button type="button" className="services-hub-buy" onClick={() => buy(s._id)} aria-label={`Buy ${s.name}`}>Buy now</button>
                    </span>
                  </div>
                </article>;
              })}
            </div>}
    </Section>
  </div>;
}
