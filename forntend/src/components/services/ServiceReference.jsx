import React from 'react';
import './serviceReference.css';

export const shortServiceReference = (value, prefix = 'SR') => {
  const id = String(value?._id || value || '');
  return id ? `${prefix}-${id.slice(-6).toUpperCase()}` : '—';
};

export default function ServiceReference({ value, prefix = 'SR', label = 'Request ID' }) {
  const id = String(value?._id || value || '');
  return <code className="service-reference" title={id || undefined} aria-label={id ? `${label}: ${id}` : label}>{shortServiceReference(value, prefix)}</code>;
}
