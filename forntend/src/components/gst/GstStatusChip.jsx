import React, { useEffect, useState } from 'react';
import { gstApi } from './gstApi';

const SHORT = { pending: 'Pending', under_review: 'Under review', additional_information_required: 'Info needed',
  approved: 'Approved', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' };

// Header shortcut for a seller who applied for GST registration assistance: always shows where it stands.
// Renders nothing when there is no request, or while the status is still loading.
export default function GstStatusChip({ onOpen }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    gstApi(false, '/me').then(row => { if (alive && row?.status) setStatus(row.status); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!status) return null;
  const needsAction = status === 'additional_information_required';
  return <button type="button" className={`gst-header-chip${needsAction ? ' needs-action' : ''}`} onClick={onOpen} title="GST registration assistance — open My applications">
    <span aria-hidden="true">🧾</span> GST: {SHORT[status] || status}
  </button>;
}
