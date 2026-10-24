import React, { useEffect, useState } from 'react';
import { adminGet, adminPost, adminPatch, authGet, authPost } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import ModalPortal from '../../../components/ModalPortal';
import { PRESETS, DEFAULT_TOKENS, COLOR_KEYS, resolveTokens, themeStyle } from '../../../utils/storefront';
import StorefrontMedia from '../../User/components/StorefrontMedia';
import '../../User/Storefront.css';
import './StorefrontStudio.css';
const names = { theme: 'Themes', campaign: 'Promotional campaigns', section: 'Homepage sections' };
const blank = kind => ({ kind, name: '', description: '', scope: 'global', device: 'all', priority: 0, order: 0, startAt: '', endAt: '',
  config: kind === 'theme' ? { preset: 'Default Bulkimart', tokens: { ...DEFAULT_TOKENS } } : kind === 'campaign' ? { placement: 'hero', bannerId: '', themeId: '', frequency: 'session', duration: 5, countdown: false } : { title: '', source: 'recent', categoryId: '', campaignId: '', bannerId: '', maxPrice: 99, limit: 8, variant: 'plain' } });
// Admin scheduling is explicitly Asia/Kolkata, independent of the workstation timezone.
export const scheduleInput = value => value ? new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 16) : '';
export const scheduleISO = value => value ? new Date(`${value}:00+05:30`).toISOString() : null;
const displayDate = value => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'No limit';
function Field({ label, children }) { return <label className="studio-field"><span>{label}</span>{children}</label>; }
export default function StorefrontStudio() {
  const { triggerToast, setActiveTab } = useAdmin(), ui = useFeedback();
  const [kind, setKind] = useState('theme'), [rows, setRows] = useState([]), [search, setSearch] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [form, setForm] = useState(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [formError, setFormError] = useState(''), [preview, setPreview] = useState('mobile');
  const [banners, setBanners] = useState([]), [themes, setThemes] = useState([]), [deals, setDeals] = useState([]), [categories, setCategories] = useState([]);
  
  // Banner direct upload state
  const [showUploadBanner, setShowUploadBanner] = useState(false);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState('');
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerUploadError, setBannerUploadError] = useState('');
  const [newBannerForm, setNewBannerForm] = useState({
    title: '', subtitle: '', cta: 'Explore now', actionType: 'NONE', targetCategoryId: '', externalUrl: '',
  });

  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    const timer = setTimeout(() => adminGet(`/storefront?${new URLSearchParams({ kind, search, status, page, limit: 12 })}`).then(result => { if (!cancelled) { setRows(result.data); setPages(result.meta.pages); } }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); }), 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [kind, search, status, page, reload]);

  useEffect(() => {
    if (!form) return;
    let cancelled = false;
    Promise.all([authGet('/api/banners?all=true'), adminGet('/storefront?kind=theme&limit=100'), adminGet('/campaigns?limit=100'), form.scope === 'global' ? Promise.all(['grocery', 'ecommerce'].map(type => authGet(`/api/categories?type=${type}`))).then(results => ({ data: results.flatMap(r => r.data || []) })) : authGet(`/api/categories?type=${form.scope === 'quick' ? 'grocery' : 'ecommerce'}`)])
      .then(([b, t, d, c]) => { if (!cancelled) { setBanners(b.data || []); setThemes(t.data || []); setDeals(d.data || []); setCategories(Array.isArray(c.data) ? c.data : []); } }).catch(err => { if (!cancelled) setFormError(`Could not load selections: ${err.message}`); });
    return () => { cancelled = true; };
  }, [!!form, form?.scope, reload]);

  useEffect(() => { if (!dirty) return; const warn = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const change = patch => { setDirty(true); setForm(f => ({ ...f, ...patch })); };
  const config = patch => change({ config: { ...form.config, ...patch } });
  
  const open = row => {
    setForm(row ? { ...row, config: structuredClone(row.config), startAt: scheduleInput(row.startAt), endAt: scheduleInput(row.endAt) } : blank(kind));
    setDirty(false);
    setFormError('');
    setShowUploadBanner(false);
    setBannerFile(null);
    setBannerPreviewUrl('');
    setBannerUploadError('');
    setNewBannerForm({
      title: row?.name || '',
      subtitle: '',
      cta: 'Explore now',
      actionType: 'NONE',
      targetCategoryId: '',
      externalUrl: '',
    });
  };

  const close = async () => { if (busy) return; if (!dirty || await ui.ask('Discard unsaved changes?')) { setForm(null); setDirty(false); } };
  
  const bannerStorefrontLabel = (type) => {
    if (type === 'general') return 'All Storefronts (General)';
    if (type === 'grocery') return 'Quick Commerce';
    if (type === 'ecommerce') return 'Shop All';
    return type || 'General';
  };

  const selectedBanner = banners.find(b => b._id === form?.config.bannerId);
  const requiredType = form?.scope === 'quick' ? 'grocery' : form?.scope === 'shop-all' ? 'ecommerce' : 'general';
  const isBannerMismatched = Boolean(selectedBanner && selectedBanner.type !== 'general' && selectedBanner.type !== requiredType);

  const save = async publish => {
    if (busy) return; setBusy(true); setFormError('');
    try {
      if (publish && form.kind === 'campaign') {
        if (!form.config.bannerId) {
          throw new Error('Please select or upload a banner before publishing.');
        }
        if (isBannerMismatched) {
          throw new Error(`Banner storefront mismatch: Selected banner is set for "${bannerStorefrontLabel(selectedBanner?.type)}", but this campaign is set for "${form.scope === 'global' ? 'All Storefronts (global)' : form.scope}". Switch the campaign storefront or upload a matching banner.`);
        }
      }
      const payload = { ...form, startAt: scheduleISO(form.startAt), endAt: scheduleISO(form.endAt) };
      let result = form._id ? await adminPatch(`/storefront/${form._id}`, payload) : await adminPost('/storefront', payload);
      // Retain saved identity even when subsequent publication fails validation.
      setForm(f => ({ ...f, _id: result.data._id, revision: result.data.revision, status: 'draft' })); setDirty(false);
      if (publish) result = await adminPost(`/storefront/${result.data._id}/actions/publish`, { revision: result.data.revision });
      triggerToast(publish ? 'Published. Customers refresh within 30 seconds.' : 'Draft saved. Publish when ready.'); setForm(null); setReload(r => r + 1);
    } catch (err) { setFormError(err.message); setReload(r => r + 1); } finally { setBusy(false); }
  };

  const handleUploadBanner = async () => {
    if (!bannerFile) {
      setBannerUploadError('Please select a banner image file.');
      return;
    }
    const title = (newBannerForm.title || form.name || 'Campaign Banner').trim();
    if (!title) {
      setBannerUploadError('Please enter a banner title.');
      return;
    }

    setUploadingBanner(true);
    setBannerUploadError('');
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('subtitle', newBannerForm.subtitle || '');
      fd.append('cta', newBannerForm.cta || 'Explore now');
      const bannerType = form.scope === 'quick' ? 'grocery' : form.scope === 'shop-all' ? 'ecommerce' : 'general';
      fd.append('type', bannerType);
      fd.append('category', 'home');
      fd.append('actionType', newBannerForm.actionType || 'NONE');
      if (newBannerForm.actionType === 'CATEGORY' && newBannerForm.targetCategoryId) {
        fd.append('targetCategory', newBannerForm.targetCategoryId);
      }
      if (newBannerForm.actionType === 'EXTERNAL_URL' && newBannerForm.externalUrl) {
        fd.append('externalUrl', newBannerForm.externalUrl);
      }
      fd.append('placement', form.config?.placement === 'hero' ? 'HOME_HERO' : 'STUDIO');
      fd.append('priority', String(form.priority || 0));
      if (form.startAt) fd.append('startDate', scheduleISO(form.startAt));
      if (form.endAt) fd.append('endDate', scheduleISO(form.endAt));
      fd.append('isActive', 'true');
      fd.append('isDraft', 'false');
      fd.append('image', bannerFile);

      const result = await authPost('/api/banners', fd);
      const createdBanner = result.data || result;
      triggerToast('Banner uploaded and selected successfully!');
      setBanners(prev => [createdBanner, ...prev]);
      config({ bannerId: createdBanner._id });
      setShowUploadBanner(false);
      setBannerFile(null);
      setBannerPreviewUrl('');
    } catch (err) {
      setBannerUploadError(err.message || 'Failed to upload banner');
    } finally {
      setUploadingBanner(false);
    }
  };

  const action = async (row, name) => {
    if (busy) return;
    if (['archive', 'rollback'].includes(name) && !await ui.ask(`${name === 'archive' ? 'Archive' : 'Roll back'} “${row.name}”? ${name === 'archive' ? 'This removes it from the storefront and preserves its history.' : 'The previous publication will be validated and published again.'}`)) return;
    setBusy(true); setError('');
    try { await adminPost(`/storefront/${row._id}/actions/${name}`, { revision: row.revision }); setReload(r => r + 1); triggerToast('Configuration updated.'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const tokens = form?.kind === 'theme' ? resolveTokens(form.config.tokens) : themes.find(t => t._id === form?.config.themeId)?.config.tokens || DEFAULT_TOKENS;
  const select = (label, value, choices, onChange) => <Field label={label}><select value={value ?? ''} onChange={e => onChange(e.target.value)}>{choices.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}</select></Field>;
  const refs = list => [{ value: '', label: 'None selected' }, ...list.map(r => ({ value: r._id, label: r.name || r.title || r._id }))];
  const bannerRefs = list => [
    { value: '', label: 'None selected' },
    ...list.map(r => ({
      value: r._id,
      label: `${r.title || r.name || r._id} [${bannerStorefrontLabel(r.type)}]`,
    }))
  ];

  return <div className="studio-workspace">
    <header className="studio-header"><div><span className="studio-kicker">MARKETING & CMS</span><h1>Storefront Studio</h1><p>Design your everyday storefront and campaigns. Preview, schedule and publish.</p></div><button className="sa-btn-primary" onClick={() => open(null)}>+ Create {kind}</button></header>
    <nav className="studio-tabs" aria-label="Studio sections">{Object.entries(names).map(([key, label]) => <button key={key} aria-pressed={kind === key} onClick={() => { setKind(key); setPage(1); }}>{label}</button>)}<button onClick={() => setActiveTab('banners')}>Banner library ↗</button><button onClick={() => setActiveTab('campaigns')}>Deal pricing ↗</button></nav>
    <div className="studio-toolbar"><input aria-label="Search configurations" placeholder="Search by name…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><select aria-label="Filter by status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'].map(s => <option key={s}>{s}</option>)}</select><span>Schedules use Asia/Kolkata (IST)</span></div>
    {error && <p className="studio-error" role="alert">{error} <button onClick={() => setReload(r => r + 1)}>Retry</button></p>}
    {loading ? <p role="status">Loading configurations…</p> : !rows.length ? <div className="studio-empty"><h2>Room for your next idea</h2><p>Create a draft to start. Nothing appears to customers until you publish.</p></div> : <div className="studio-grid">{rows.map(row => <article key={row._id} className="studio-record">
      {row.kind === 'theme' && <div className="studio-palette">{['primary', 'secondary', 'accent', 'background'].map(key => <span key={key} style={{ background: row.config.tokens[key] }} />)}</div>}
      <div className="studio-record-top"><span className={`studio-status studio-status--${row.lifecycle}`}>{row.lifecycle}</span><span>{row.scope} · Priority {row.priority}</span></div><h2>{row.name}</h2><p>{row.description || `${row.kind === 'section' ? `${row.config.source} · Order ${row.order}` : row.config.placement || row.config.preset}`}</p>
      <dl><dt>From</dt><dd>{displayDate(row.startAt)}</dd><dt>Until</dt><dd>{displayDate(row.endAt)}</dd></dl>
      <div className="studio-actions"><button onClick={() => open(row)}>Edit & preview</button><button onClick={() => { open({ ...row, _id: undefined, revision: undefined, name: `${row.name} copy`.slice(0, 100), status: 'draft' }); setDirty(true); }}>Duplicate</button>
        <button disabled={busy} onClick={() => action(row, row.status === 'published' ? 'pause' : 'publish')}>{row.status === 'published' ? 'Pause' : 'Publish'}</button>
        {row.status !== 'archived' && <button disabled={busy} onClick={() => action(row, 'archive')}>Archive</button>}{row.canRollback && <button disabled={busy} onClick={() => action(row, 'rollback')}>Rollback</button>}
      </div>
    </article>)}</div>}
    <div className="studio-pagination"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, pages)}</span><button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div>
    {form && <ModalPortal className="studio-overlay" role="dialog" aria-modal="true" aria-label={`${form._id ? 'Edit' : 'Create'} ${form.kind}`} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <div className="studio-editor"><header><div><span className="studio-kicker">{form.kind.toUpperCase()} EDITOR</span><h2>{form.name || 'Untitled draft'}</h2></div><button disabled={busy} onClick={close} aria-label="Close editor">✕</button></header>
      <div className="studio-editor-body"><form id="studio-form" onSubmit={e => { e.preventDefault(); save(false); }}>
        <fieldset disabled={busy}><Field label="Name"><input required maxLength={100} value={form.name} onChange={e => change({ name: e.target.value })} /></Field><Field label="Internal description"><textarea maxLength={2000} value={form.description} onChange={e => change({ description: e.target.value })} /></Field>
        <div className="studio-pair">{select('Storefront', form.scope, ['global', 'quick', 'shop-all'], scope => change({ scope }))}{select('Device', form.device, ['all', 'mobile', 'desktop'], device => change({ device }))}</div>
        <div className="studio-pair"><Field label="Start · IST"><input type="datetime-local" value={form.startAt} onChange={e => change({ startAt: e.target.value })} /></Field><Field label="End · IST"><input type="datetime-local" value={form.endAt} onChange={e => change({ endAt: e.target.value })} /></Field></div>
        <Field label="Priority (higher wins)"><input type="number" min="0" max="1000" value={form.priority} onChange={e => change({ priority: Number(e.target.value) })} /></Field>
        {form.kind === 'theme' && <>{select('Apply theme', form.config.application || 'storefront', [{ value: 'storefront', label: 'Storefront default for this scope' }, { value: 'campaign', label: 'Only while a linked campaign is active' }], application => config({ application }))}{select('Theme preset', form.config.preset, Object.keys(PRESETS), preset => config({ preset, tokens: { ...PRESETS[preset] } }))}<div className="studio-colors">{COLOR_KEYS.map(key => <Field key={key} label={key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase())}><input type="color" value={tokens[key]} onChange={e => config({ tokens: { ...tokens, [key]: e.target.value } })} /></Field>)}</div>
          {Object.entries({ font: ['system', 'sans', 'serif'], card: ['rounded', 'square'], button: ['rounded', 'pill'], gradient: ['none', 'soft'], category: ['framed', 'minimal'], product: ['elevated', 'flat'], decoration: ['none', 'dots', 'confetti', 'lights'], motion: ['none', 'gentle'] }).map(([key, options]) => <React.Fragment key={key}>{select(key, tokens[key], options, value => config({ tokens: { ...tokens, [key]: value } }))}</React.Fragment>)}<p className="studio-help">Text and buttons require 4.5:1 contrast. Invalid combinations cannot be saved.</p><h3>Category artwork</h3><p className="studio-help">Select published artwork from Banner library. Tiles always open the selected category. Add only accurate campaign labels.</p>
{(form.config.categoryTiles || []).map((tile, index) => <div key={index} className="studio-category-tile">
{select('Tile category', tile.categoryId, refs(categories), categoryId => config({ categoryTiles: form.config.categoryTiles.map((t, i) => i === index ? { ...t, categoryId } : t) }))}
{select('Tile artwork', tile.bannerId, bannerRefs(banners.filter(b => !b.isArchived)), bannerId => config({ categoryTiles: form.config.categoryTiles.map((t, i) => i === index ? { ...t, bannerId } : t) }))}
<Field label="Campaign label (optional)"><input maxLength={24} value={tile.badge || ''} onChange={e => config({ categoryTiles: form.config.categoryTiles.map((t, i) => i === index ? { ...t, badge: e.target.value } : t) })} /></Field>
<button type="button" onClick={() => config({ categoryTiles: form.config.categoryTiles.filter((_, i) => i !== index) })}>Remove tile override</button></div>)}
<button type="button" disabled={(form.config.categoryTiles || []).length >= 24} onClick={() => config({ categoryTiles: [...(form.config.categoryTiles || []), { categoryId: '', bannerId: '', badge: '' }] })}>Add category artwork</button></>}
        
        {form.kind !== 'theme' && (
          <div className="studio-banner-section">
            <div className="studio-banner-header">
              <span className="studio-field-label">Banner artwork & destination</span>
              <div className="studio-banner-toggle-group">
                <button
                  type="button"
                  className={`studio-tab-pill ${!showUploadBanner ? 'active' : ''}`}
                  onClick={() => setShowUploadBanner(false)}
                >
                  Select Existing
                </button>
                <button
                  type="button"
                  className={`studio-tab-pill ${showUploadBanner ? 'active' : ''}`}
                  onClick={() => {
                    setShowUploadBanner(true);
                    if (!newBannerForm.title && form.name) {
                      setNewBannerForm(f => ({ ...f, title: form.name }));
                    }
                  }}
                >
                  + Upload New Banner
                </button>
              </div>
            </div>

            {!showUploadBanner ? (
              <>
                <Field label="">
                  <select
                    value={form.config.bannerId ?? ''}
                    onChange={e => config({ bannerId: e.target.value })}
                  >
                    {bannerRefs(banners.filter(b => !b.isArchived)).map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                {isBannerMismatched && (
                  <div className="studio-mismatch-warning">
                    <div className="studio-mismatch-icon">⚠️</div>
                    <div className="studio-mismatch-content">
                      <strong>Storefront Mismatch Warning:</strong>
                      <p>
                        Selected banner <em>"{selectedBanner?.title}"</em> is for{' '}
                        <strong>{bannerStorefrontLabel(selectedBanner?.type)}</strong>, but this campaign's storefront is{' '}
                        <strong>{form.scope === 'global' ? 'All Storefronts (global)' : form.scope === 'quick' ? 'Quick Commerce' : 'Shop All'}</strong>.
                      </p>
                      <div className="studio-mismatch-actions">
                        {selectedBanner?.type === 'grocery' && (
                          <button
                            type="button"
                            className="studio-btn-sm"
                            onClick={() => change({ scope: 'quick' })}
                          >
                            Switch Campaign to Quick Commerce
                          </button>
                        )}
                        {selectedBanner?.type === 'ecommerce' && (
                          <button
                            type="button"
                            className="studio-btn-sm"
                            onClick={() => change({ scope: 'shop-all' })}
                          >
                            Switch Campaign to Shop All
                          </button>
                        )}
                        <button
                          type="button"
                          className="studio-btn-sm studio-btn-primary"
                          onClick={() => {
                            setShowUploadBanner(true);
                            setNewBannerForm(f => ({ ...f, title: form.name }));
                          }}
                        >
                          Upload New Banner for {form.scope === 'global' ? 'All Storefronts' : form.scope}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <p className="studio-help">
                  Select a banner above, or click <strong>+ Upload New Banner</strong> to upload artwork directly into this campaign.
                </p>
              </>
            ) : (
              <div className="studio-banner-upload-card">
                <div className="studio-upload-header">
                  <h4>Upload New Banner Artwork</h4>
                  <span className="studio-scope-tag">
                    Storefront: {bannerStorefrontLabel(form.scope === 'quick' ? 'grocery' : form.scope === 'shop-all' ? 'ecommerce' : 'general')}
                  </span>
                </div>

                <Field label="Banner Image (JPEG, PNG, WebP) *">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setBannerFile(file);
                        setBannerPreviewUrl(URL.createObjectURL(file));
                      }
                    }}
                  />
                  {bannerPreviewUrl && (
                    <div className="studio-upload-thumb">
                      <img src={bannerPreviewUrl} alt="Banner preview" />
                    </div>
                  )}
                </Field>

                <Field label="Banner Title *">
                  <input
                    placeholder="e.g. Diwali Mega Sale"
                    value={newBannerForm.title}
                    onChange={e => setNewBannerForm(f => ({ ...f, title: e.target.value }))}
                  />
                </Field>

                <Field label="Subtitle / Tagline (Optional)">
                  <input
                    placeholder="e.g. Festive discounts up to 50% off"
                    value={newBannerForm.subtitle}
                    onChange={e => setNewBannerForm(f => ({ ...f, subtitle: e.target.value }))}
                  />
                </Field>

                <div className="studio-pair">
                  <Field label="Button CTA text">
                    <input
                      placeholder="e.g. Explore now"
                      value={newBannerForm.cta}
                      onChange={e => setNewBannerForm(f => ({ ...f, cta: e.target.value }))}
                    />
                  </Field>
                  <Field label="Action / Destination">
                    <select
                      value={newBannerForm.actionType}
                      onChange={e => setNewBannerForm(f => ({ ...f, actionType: e.target.value }))}
                    >
                      <option value="NONE">No link (informational)</option>
                      <option value="CATEGORY">Open a category</option>
                      <option value="EXTERNAL_URL">Open external URL</option>
                    </select>
                  </Field>
                </div>

                {newBannerForm.actionType === 'CATEGORY' && (
                  <Field label="Target Category">
                    <select
                      value={newBannerForm.targetCategoryId}
                      onChange={e => setNewBannerForm(f => ({ ...f, targetCategoryId: e.target.value }))}
                    >
                      <option value="">Select a category</option>
                      {categories.map(c => (
                        <option key={c._id} value={c._id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {newBannerForm.actionType === 'EXTERNAL_URL' && (
                  <Field label="External URL (HTTPS)">
                    <input
                      placeholder="https://..."
                      value={newBannerForm.externalUrl}
                      onChange={e => setNewBannerForm(f => ({ ...f, externalUrl: e.target.value }))}
                    />
                  </Field>
                )}

                {bannerUploadError && (
                  <p className="studio-error" role="alert">{bannerUploadError}</p>
                )}

                <div className="studio-upload-actions">
                  <button
                    type="button"
                    className="sa-btn-primary"
                    disabled={uploadingBanner || !bannerFile}
                    onClick={handleUploadBanner}
                  >
                    {uploadingBanner ? 'Uploading…' : '✓ Upload & Link to Campaign'}
                  </button>
                  <button
                    type="button"
                    disabled={uploadingBanner}
                    onClick={() => setShowUploadBanner(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {form.kind === 'campaign' && <>{select('Placement', form.config.placement, ['hero', 'splash', 'announcement'], placement => config({ placement }))}{select('Theme override', form.config.themeId, refs(themes), themeId => config({ themeId }))}
          {form.config.placement === 'splash' && <>{select('Frequency', form.config.frequency, [{ value: 'launch', label: 'Every eligible launch' }, { value: 'session', label: 'Once per browser tab session' }, { value: 'daily', label: 'Once per day (IST)' }, { value: 'version', label: 'Once per publication version' }], frequency => config({ frequency }))}<Field label="Auto-close after seconds (2–15)"><input type="number" min="2" max="15" value={form.config.duration} onChange={e => config({ duration: Number(e.target.value) })} /></Field><label className="studio-check"><input type="checkbox" checked={form.config.countdown} onChange={e => config({ countdown: e.target.checked })} />Show countdown to configured end time</label><p className="studio-help">A visible Skip control is always available. One splash maximum per app launch. Audience: all visitors to the selected storefront.</p></>}
        </>}
        {form.kind === 'section' && <><Field label="Customer-facing title"><input maxLength={100} value={form.config.title} onChange={e => config({ title: e.target.value })} /></Field>{select('Product collection', form.config.source, [{ value: 'recent', label: 'Recently added' }, { value: 'featured', label: 'Featured / curated picks' }, { value: 'category', label: 'Category collection' }, { value: 'price', label: 'Under a price' }, { value: 'campaign', label: 'Flash sale / accepted deal products' }, { value: 'wholesale', label: 'Wholesale discovery' }], source => config({ source }))}
          {form.config.source === 'category' && select('Category', form.config.categoryId, refs(categories), categoryId => config({ categoryId }))}
          {form.config.source === 'campaign' && select('Deal campaign', form.config.campaignId, refs(deals), campaignId => config({ campaignId }))}
          {form.config.source === 'price' && <Field label="Maximum price (INR)"><input type="number" min="1" value={form.config.maxPrice} onChange={e => config({ maxPrice: Number(e.target.value) })} /></Field>}
          <div className="studio-pair"><Field label="Display order (lower first)"><input type="number" min="0" max="1000" value={form.order} onChange={e => change({ order: Number(e.target.value) })} /></Field><Field label="Product limit"><input type="number" min="1" max="24" value={form.config.limit} onChange={e => config({ limit: Number(e.target.value) })} /></Field></div>{select('Appearance', form.config.variant, ['plain', 'soft', 'accent'], variant => config({ variant }))}{select('Layout', form.config.layout || 'rail', ['rail', 'grid'], layout => config({ layout }))}
<label className="studio-check"><input type="checkbox" checked={!!form.config.appearance?.background} onChange={e => config({ appearance: e.target.checked ? { background: DEFAULT_TOKENS.highlight, text: DEFAULT_TOKENS.text, accent: DEFAULT_TOKENS.primary } : {} })} />Custom section colors</label>
{form.config.appearance?.background && <div className="studio-colors">{['background', 'text', 'accent'].map(key => <Field key={key} label={'Section ' + key}><input type="color" value={form.config.appearance[key]} onChange={e => config({ appearance: { ...form.config.appearance, [key]: e.target.value } })} /></Field>)}</div>}
        </>}
        </fieldset>
      </form><aside className="studio-preview-pane"><div className="studio-preview-toggle"><button aria-pressed={preview === 'mobile'} onClick={() => setPreview('mobile')}>Mobile</button><button aria-pressed={preview === 'desktop'} onClick={() => setPreview('desktop')}>Desktop</button></div>
        <div className={`studio-preview studio-preview--${preview} sf-storefront`} style={themeStyle(tokens)} data-decoration={tokens.decoration} data-motion={tokens.motion} data-category={tokens.category} data-product={tokens.product}><div className="studio-preview-header">BULKIMART <small>Quick · ShopAll</small><div className="studio-preview-search">Search products and categories</div></div>
          {selectedBanner ? <><StorefrontMedia banner={{ ...selectedBanner, id: selectedBanner._id }} device={preview} active={false} /><div className="studio-preview-copy"><span className="sf-eyebrow">PREVIEW</span><h2>{selectedBanner.title}</h2><p>{selectedBanner.subtitle}</p><span className="sf-cta">{selectedBanner.cta || 'Explore now'} →</span></div></> : <div className="studio-preview-copy"><span className="sf-eyebrow">YOUR STOREFRONT</span><h2>{form.kind === 'section' ? form.config.title || form.name : 'A little more to love.'}</h2><p>Discover your next favourite on Bulkimart.</p><span className="sf-cta">Explore collection →</span><div className="studio-preview-cards"><article className="sf-product"><div className="sf-product-body"><strong>Product preview</strong><span className="sf-rating">Prices and ratings from catalog</span><button type="button" className="sf-add">Add to cart +</button></div></article></div></div>}
        <div className="studio-preview-collection" style={form.kind === 'section' ? { background: form.config.appearance?.background, color: form.config.appearance?.text, borderColor: form.config.appearance?.accent } : undefined}>
<strong>{form.kind === 'section' ? form.config.title || 'Collection preview' : 'Shop by category'}</strong><div className="studio-preview-category"><span>Category artwork</span></div><small>{form.kind === 'section' ? (form.config.layout || 'rail') + ' layout · live catalog after publication' : 'Published category artwork appears here'}</small></div>
<div className="studio-preview-nav"><strong>⌂ Home</strong><span>▦ Categories</span><span>♧ Cart</span></div>
</div><p className="studio-help">Appearance preview only. Published content uses live, eligible catalog data.</p></aside></div>
      <footer>{form.status === 'published' && <p>Saving a draft removes this configuration from the live storefront until republished.</p>}{formError && <p className="studio-error" role="alert">{formError}</p>}<div className="studio-actions"><button disabled={busy} onClick={close}>Cancel</button><button disabled={busy} type="submit" form="studio-form">{busy ? 'Saving…' : 'Save draft'}</button><button disabled={busy || !form.name.trim()} className="sa-btn-primary" onClick={() => save(true)}>{form.startAt ? 'Publish schedule' : 'Publish now'}</button></div></footer>
      </div>
    </ModalPortal>}
  </div>;
}
