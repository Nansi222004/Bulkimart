import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Category filters for customers (Developer Guide §9): the attributes Admin marked "customer filter" for this
 * category, e.g. Size and Colour for clothing, RAM and Storage for phones. value: { code: [optionValue, …] }.
 */
export default function CategoryFilterBar({ categoryId, value, onChange }) {
  const [filters, setFilters] = useState([]);
  const [open, setOpen] = useState('');

  useEffect(() => {
    setFilters([]); setOpen('');
    if (!categoryId) return undefined;
    let cancelled = false;
    fetch(apiUrl(`/api/catalog/filters?category=${encodeURIComponent(categoryId)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        const list = (body.data?.filters || []).map((f) => (f.fieldType === 'boolean' ? { ...f, options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] } : f));
        setFilters(list.filter((f) => f.options?.length));
      })
      .catch(() => { /* filters are optional */ });
    return () => { cancelled = true; };
  }, [categoryId]);

  if (!filters.length) return null;
  const active = Object.values(value || {}).reduce((n, list) => n + (list?.length || 0), 0);
  const toggle = (code, optionValue) => {
    const current = new Set(value?.[code] || []);
    if (current.has(optionValue)) current.delete(optionValue); else current.add(optionValue);
    onChange({ ...(value || {}), [code]: [...current] });
  };
  const current = filters.find((f) => f.code === open);
  const chip = (on) => ({ border: `1.5px solid ${on ? 'var(--primary, #0f766e)' : 'var(--border-color, #e2e8f0)'}`, background: on ? 'var(--primary-light, #ecfeff)' : '#fff', color: on ? 'var(--primary, #0f766e)' : '#334155', borderRadius: 18, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' });

  return (
    <div style={{ margin: '4px 0 12px' }} aria-label="Filters">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {filters.map((f) => {
          const count = value?.[f.code]?.length || 0;
          return (
            <button key={f.code} type="button" aria-expanded={open === f.code} onClick={() => setOpen(open === f.code ? '' : f.code)} style={chip(count > 0)}>
              {f.label}{count ? ` · ${count}` : ''} ▾
            </button>
          );
        })}
        {active ? <button type="button" onClick={() => onChange({})} style={chip(false)}>Clear ({active})</button> : null}
      </div>
      {current ? (
        <div role="group" aria-label={current.label} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, padding: 10, border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 10 }}>
          {current.options.map((o) => {
            const on = (value?.[current.code] || []).includes(o.value);
            return (
              <label key={o.value} style={{ ...chip(on), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={on} onChange={() => toggle(current.code, o.value)} />
                {o.label}{current.unit && current.fieldType !== 'boolean' ? ` ${current.unit}` : ''}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
