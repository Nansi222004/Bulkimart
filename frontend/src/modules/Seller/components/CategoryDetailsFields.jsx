import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Admin-configured category fields on the seller website (Developer Guide §3): loaded for the chosen category
 * (subcategories inherit their parents' fields) and drawn by type. Product-level fields go in `specs`,
 * variant-defining ones (Size, Colour, RAM …) on each variant's `options`. The server checks the same rules.
 */
export function useCategoryFields(categoryId) {
  const [fields, setFields] = useState([]);
  const [state, setState] = useState('idle');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFields([]);
    if (!categoryId) { setState('idle'); return undefined; }
    let cancelled = false;
    setState('loading');
    fetch(apiUrl(`/api/catalog/fields?category=${encodeURIComponent(categoryId)}`))
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) throw new Error(body?.message || 'Could not load category fields');
        setFields(Array.isArray(body?.data?.fields) ? body.data.fields : []);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [categoryId, attempt]);
  return { fields, state, retry: () => setAttempt((n) => n + 1) };
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Same required / format checks the server makes, shown before the upload. */
/**
 * Pre-fills the category's Admin-set default values into fields the seller has left empty (new listings only).
 * Never overwrites what the seller typed; each variant gets defaults for its variant fields (e.g. Size).
 */
export function applyFieldDefaults(form, fields) {
  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const withDefaults = (fields || []).filter((f) => !isEmpty(f.defaultValue));
  if (!withDefaults.length) return form;
  const specs = { ...(form.specs || {}) };
  for (const f of withDefaults.filter((x) => !x.isVariant)) if (isEmpty(specs[f.code])) specs[f.code] = f.defaultValue;
  const variantDefaults = withDefaults.filter((x) => x.isVariant);
  const variants = variantDefaults.length ? (form.variants || []).map((v) => {
    const options = { ...(v.options || {}) };
    for (const f of variantDefaults) if (isEmpty(options[f.code])) options[f.code] = f.defaultValue;
    return { ...v, options };
  }) : form.variants;
  return { ...form, specs, variants };
}

export function validateCategoryDetails(form, fields) {
  const errs = [];
  for (const f of fields.filter((x) => !x.isVariant)) {
    const v = form.specs?.[f.code];
    if (blank(v)) { if (f.required) errs.push(`${f.label} is required`); continue; }
    if (['number', 'decimal'].includes(f.fieldType) && !Number.isFinite(Number(v))) errs.push(`${f.label} must be a number`);
    if (f.fieldType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errs.push(`${f.label} must be a date`);
  }
  const variantFields = fields.filter((x) => x.isVariant);
  const seen = new Set();
  (form.variants || []).forEach((variant, i) => {
    const name = variant.name ? `“${variant.name}”` : `Variant ${i + 1}`;
    for (const f of variantFields) if (f.required && blank(variant.options?.[f.code])) errs.push(`${name}: ${f.label} is required`);
    if (variantFields.length) {
      const key = variantFields.map((f) => String(variant.options?.[f.code] ?? '')).join('|');
      if (key.replace(/\|/g, '') && seen.has(key)) errs.push(`${name} has the same ${variantFields.map((f) => f.label).join(' / ')} as another variant`);
      seen.add(key);
    }
  });
  if (form.hsnCode && !/^\d{4,8}$/.test(String(form.hsnCode).trim())) errs.push('HSN code must be 4 to 8 digits');
  if (form.barcode && !/^\d{8,14}$/.test(String(form.barcode).trim())) errs.push('Barcode must be 8 to 14 digits');
  if (!blank(form.dispatchDays) && !(Number.isInteger(Number(form.dispatchDays)) && Number(form.dispatchDays) >= 0 && Number(form.dispatchDays) <= 30)) errs.push('Dispatch time must be 0 to 30 days');
  const pkg = [form.pkgLength, form.pkgBreadth, form.pkgHeight];
  if (pkg.some((v) => !blank(v))) {
    if (pkg.some((v) => blank(v))) errs.push('Enter all three package measurements (length, breadth, height) or leave them all empty');
    else if (pkg.some((v) => !(Number(v) > 0 && Number(v) <= 500))) errs.push('Package measurements must be more than 0 and at most 500 cm');
  }
  return errs;
}

/** Uploads a photo (or, for 'file' fields, a PDF) to POST /api/catalog/uploads and returns the stored link. */
export async function uploadCatalogFile(file, kind = 'image') {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file);
  const res = await fetch(apiUrl('/api/catalog/uploads'), {
    method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('sellerToken') || ''}` }, body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.url) throw new Error(body.message || 'Upload failed. Please try again.');
  return body.data.url;
}

/** File picker that uploads at once; shows a preview / file link with a Remove button once uploaded. */
export function CategoryUploadInput({ id, kind = 'image', value, onChange, disabled }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accept = kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf';
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File is larger than 5 MB.'); return; }
    if (kind === 'image' && file.type === 'application/pdf') { setError('This field needs a photo, not a PDF.'); return; }
    setBusy(true); setError('');
    try { onChange(await uploadCatalogFile(file, kind)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const isImage = typeof value === 'string' && /^https:///i.test(value) && !/.pdf($|?)/i.test(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {busy ? <span style={{ fontSize: 12.5 }}>Uploading…</span> : value ? (
        <>
          {isImage ? <img src={value} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ fontSize: 12.5 }}>File uploaded ✓</span>}
          <button type="button" disabled={disabled} onClick={() => onChange('')} style={{ fontSize: 12.5, color: '#dc2626', background: 'none', border: 0, cursor: 'pointer' }}>Remove</button>
        </>
      ) : (
        <input id={id} type="file" accept={accept} disabled={disabled} onChange={pick} />
      )}
      {error ? <span role="alert" style={{ fontSize: 12, color: '#dc2626', width: '100%' }}>{error}</span> : null}
    </div>
  );
}

const label = (f) => `${f.label}${f.unit ? ` (${f.unit})` : ''}${f.required ? ' *' : ''}`;

/** One field, drawn by its type. */
export function CategoryFieldInput({ field: f, value, onChange, disabled, idPrefix = 'cf' }) {
  const id = `${idPrefix}-${f.code}`;
  const common = { id, disabled, className: 'onboarding-input' };
  let control;
  switch (f.fieldType) {
    case 'select':
      control = (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select {f.label.toLowerCase()}</option>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'multiselect': {
      const chosen = new Set(Array.isArray(value) ? value : []);
      control = (
        <div role="group" aria-labelledby={`${id}-l`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {f.options.map((o) => (
            <label key={o.value} style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 14 }}>
              <input type="checkbox" disabled={disabled} checked={chosen.has(o.value)} onChange={(e) => {
                const next = new Set(chosen); if (e.target.checked) next.add(o.value); else next.delete(o.value); onChange([...next]);
              }} />{o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'boolean':
      control = (
        <select {...common} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'true')}>
          <option value="">Choose</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      );
      break;
    case 'number':
    case 'decimal':
      control = <input {...common} type="number" step={f.fieldType === 'number' ? 1 : 'any'} min={f.validation?.min} max={f.validation?.max} placeholder={f.placeholder || ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'date':
      control = <input {...common} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'longtext':
      control = <textarea {...common} rows={3} maxLength={f.validation?.maxLength || 5000} placeholder={f.placeholder || ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'image':
    case 'file':
      control = (
        <CategoryUploadInput id={id} kind={f.fieldType} value={value} onChange={onChange} disabled={disabled} />
      );
      break;
    default:
      control = <input {...common} type="text" maxLength={f.validation?.maxLength || 200} placeholder={f.placeholder || ''} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label id={`${id}-l`} htmlFor={id} className="onboarding-label">{label(f)}</label>
      {control}
      {f.helpText ? <small style={{ color: 'var(--text-secondary)' }}>{f.helpText}</small> : null}
    </div>
  );
}
