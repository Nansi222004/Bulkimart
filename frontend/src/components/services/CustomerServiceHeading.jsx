import React from 'react';
import { Package, Scale } from 'lucide-react';
import './customerServicePages.css';

export default function CustomerServiceHeading({ parcel = false, title, children }) {
  const Icon = parcel ? Package : Scale;
  return <header className="customer-service-heading">
    <span className="customer-service-icon"><Icon size={24} aria-hidden="true" /></span>
    <div><h1>{title || (parcel ? 'Send a Parcel' : 'Legal Services')}</h1>{children}</div>
  </header>;
}
