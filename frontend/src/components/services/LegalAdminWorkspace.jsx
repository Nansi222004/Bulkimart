import React, { useEffect, useState } from 'react';
import ServicesPanel from './ServicesPanel';
import { BriefcaseBusiness, Users } from 'lucide-react';
import './adminServices.css';

// Older customer-request notifications link with ?legalRequest=<id>; they open the same simple application view.
function legalLinkToApplication() {
  const params = new URLSearchParams(window.location.search), id = params.get('legalRequest');
  if (!id || !/^[a-f\d]{24}$/i.test(id)) return false;
  window.history.replaceState(null, '', `/admin/services?application=${id}`);
  return true;
}

// Admin services: the service catalogue with seller applications, and customer requests.
// Both use the same steps: review → more information → work → completed, or reject (paid fees go back to the wallet).
export default function AdminServicesWorkspace() {
  const [section, setSection] = useState(() => legalLinkToApplication() ? 'customers' : 'catalogue');
  useEffect(() => {
    const open = () => { if (legalLinkToApplication()) { setSection('customers'); window.dispatchEvent(new Event('service-application-open')); } };
    window.addEventListener('app:locationchange', open); window.addEventListener('legal-request-open', open);
    return () => { window.removeEventListener('app:locationchange', open); window.removeEventListener('legal-request-open', open); };
  }, []);
  const choose = next => { if (next === section) return; window.history.replaceState(null, '', '/admin/services'); setSection(next); };
  return <section className="admin-services-workspace"><nav className="admin-services-sections" aria-label="Service workspaces">
    <button type="button" onClick={() => choose('catalogue')} aria-pressed={section === 'catalogue'}><BriefcaseBusiness size={22} aria-hidden="true" /><span><strong>Services and seller applications</strong><small>Create services and handle seller applications.</small></span></button>
    <button type="button" onClick={() => choose('customers')} aria-pressed={section === 'customers'}><Users size={22} aria-hidden="true" /><span><strong>Customer requests</strong><small>Review and complete requests from customers.</small></span></button>
  </nav>{section === 'customers' ? <ServicesPanel key="customers" admin applicant="customer" /> : <ServicesPanel key="catalogue" admin />}</section>;
}
