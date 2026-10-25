import React, { useEffect, useState } from 'react';
import { Package, BriefcaseBusiness } from 'lucide-react';
import { apiUrl } from '../../utils/api';
import { boundedFetch } from '../../utils/portalRequests';
import LegalServices from './LegalServices';
import { parcelBookingEnabled, parcelBookingReady } from '../parcels/parcelAvailability';
import './customerServices.css';

export function ServicesDiscovery() {
  return <a className="services-discovery" href="/services"><BriefcaseBusiness aria-hidden="true"/><span><strong>Services</strong><small>Explore services · Send a Parcel</small></span><span aria-hidden="true">→</span></a>;
}

export function LegalServiceCard() {
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    async function load() {
      const get = async path => {
        const r = await boundedFetch(apiUrl(path), { signal: c.signal });
        const b = await r.json();
        if (!r.ok || b.success === false) throw new Error('Availability check failed');
        return b;
      };
      const b = await get('/api/customer-services/capabilities');
      if (typeof b.data?.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      if (!b.data.catalogue) { if (!c.signal.aborted) setState('empty'); return; }
      const catalogue = await get('/api/customer-services?page=1&limit=1');
      if (!Array.isArray(catalogue.data) || !Number.isSafeInteger(catalogue.meta?.total) || catalogue.meta.total < 0 ||
        catalogue.data.length > 1 || catalogue.data.some(s => !/^[a-f\d]{24}$/i.test(s?._id || '')) ||
        (catalogue.meta.total > 0) !== (catalogue.data.length > 0)) throw new Error('Invalid catalogue');
      if (!c.signal.aborted) setState(catalogue.data.length ? 'enabled' : 'empty');
    }
    load().catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <article className="customer-service-card"><BriefcaseBusiness aria-hidden="true"/><h2>Legal Services</h2><p>Explore legal services and their requirements. Requests are reviewed by the team.</p>
    {state === 'enabled' ? <a className="service-book" href="/legal-services">Browse Legal Services</a> : state === 'loading' ? <p role="status">Checking legal services availability…</p> : state === 'error' ? <p role="alert">Legal services availability could not be checked. <button onClick={() => retry(n => n + 1)}>Retry legal availability</button></p> : <p role="status">No customer legal services are currently available. Please check back later.</p>}
  </article>;
}

export function HomeServiceEntries() {
  return <section className="home-service-entries" aria-label="Customer services"><LegalServiceCard/><ParcelServiceCard/></section>;
}

export function ParcelServiceCard() {
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    async function load() {
      const get = async path => {
        const r = await boundedFetch(apiUrl(`/api/parcel-delivery/${path}`), { signal: c.signal });
        if (!r.ok) throw new Error('Availability check failed');
        return (await r.json()).data;
      };
      const f = await get('capabilities');
      if (!f || typeof f.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      const enabled = parcelBookingEnabled(f);
      const policy = enabled ? await get('catalogue') : null;
      if (!c.signal.aborted) setState((enabled && (policy?.ready === true || parcelBookingReady(f, policy))) ? 'enabled' : !f.catalogue ? 'unavailable' : 'disabled');
    }
    load().catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <article className="customer-service-card customer-parcel-card"><Package size={42} strokeWidth={1.5} aria-hidden="true"/><h2>Send a Parcel</h2><p>Doorstep pickup. A delivery fee before you book. Your parcel, delivered with care.</p>
    {state === 'loading' ? <p role="status">Checking parcel availability…</p> : state === 'enabled' ? <p role="status">Ready to send? Get a delivery fee before confirming.</p> : state === 'error' ? <p role="alert">Parcel availability could not be checked. <button onClick={() => retry(n => n + 1)}>Retry parcel availability</button></p> : <p role="status">New deliveries are currently unavailable. You can still view your delivery history.</p>}
    <div className="customer-service-actions">{state === 'enabled' || state === 'unavailable' ? <a className="service-book" href="/parcel-delivery/book">Send a Parcel</a> : state === 'disabled' ? <button type="button" disabled>Send a Parcel</button> : null}<a href="/parcel-delivery/history">Delivery history</a></div>
  </article>;
}

export default function CustomerServices() {
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    boundedFetch(apiUrl('/api/customer-services/capabilities'), { signal: c.signal }).then(async r => {
      if (!r.ok) throw new Error('Availability check failed');
      const b = await r.json();
      if (b.success === false || typeof b.data?.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      if (!c.signal.aborted) setState(b.data.catalogue ? 'enabled' : 'disabled');
    }).catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <section className="customer-services" aria-label="Services"><a href="/">Back to home</a><h1>Services</h1><ParcelServiceCard/>
    {state === 'enabled' ? <LegalServices/> : state === 'loading' ? <p role="status">Checking services availability…</p> : state === 'error' ? <p role="alert">Services could not be loaded. <button onClick={() => retry(n => n + 1)}>Retry services</button></p> : <p role="status">No customer legal services are currently available. Please check back later.</p>}
  </section>;
}
