import React, { useEffect, useRef } from 'react';

export default function FinanceReview({ title, values, busy, onConfirm, onCancel }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="finance-panel finance-review" aria-label="Review financial configuration">
    <h3 ref={heading} tabIndex={-1}>{title}</h3>
    <p>Check these values. Nothing is saved until you confirm.</p>
    <dl>{Object.entries(values).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value ?? 'Not set')}</dd></div>)}</dl>
    <button type="button" disabled={busy} onClick={onConfirm}>Confirm save</button>
    <button type="button" disabled={busy} onClick={onCancel}>Back to editing</button>
  </section>;
}
