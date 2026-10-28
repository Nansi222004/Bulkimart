import React, { useEffect, useRef, useState } from 'react';
import { adminGet, adminPost, adminPatch, authGet, authPost } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import ModalPortal from '../../../components/ModalPortal';
import { PRESETS, PRESET_EFFECTS, DEFAULT_TOKENS, DEFAULT_HEADER, COLOR_KEYS, resolveTokens, themeStyle } from '../../../utils/storefront';
import { DEFAULT_EFFECT, EFFECT_COLORS } from '../../../../../backend/shared/celebration.mjs';
import StorefrontMedia from '../../User/components/StorefrontMedia';
import StorefrontMediaFields from './StorefrontMediaFields';
import StorefrontEffectFields from './StorefrontEffectFields';
import StorefrontHeaderFields from './StorefrontHeaderFields';
import Celebration from '../../User/components/Celebration';
import { FestiveHeader, normalizeHeader } from '../../User/components/FestiveHeader';
import StorefrontSplashPreview from './StorefrontSplashPreview';
import '../../User/Storefront.css';
import './StorefrontStudio.css';
const names = { theme: 'Themes', campaign: 'Promotional campaigns', section: 'Homepage sections' };
const blank = kind => ({ kind, name: '', description: '', scope: 'global', device: 'all', priority: 0, order: 0, startAt: '', endAt: '',
  config: kind === 'theme' ? { preset: 'Default Bulkimart', tokens: { ...DEFAULT_TOKENS }, header: { ...DEFAULT_HEADER } } : kind === 'campaign' ? { placement: 'hero', bannerId: '', themeId: '', frequency: 'session', duration: 5, countdown: false } : { title: '', source: 'recent', categoryId: '', campaignId: '', bannerId: '', maxPrice: 99, limit: 8, variant: 'plain' } });
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
  const operationBusy = useRef(false), uploadedBanner = useRef(null);
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
      .then(([b, t, d, c]) => { if (!cancelled) { const list = b.data || []; const linked = uploadedBanner.current; setBanners(linked && !list.some(row => row._id === linked._id) ? [linked, ...list] : list); setThemes(t.data || []); setDeals(d.data || []); setCategories(Array.isArray(c.data) ? c.data : []); } }).catch(err => { if (!cancelled) setFormError(`Could not load selections: ${err.message}`); });
    return () => { cancelled = true; };
  }, [!!form, form?.scope, reload]);

  // The preview countdown ticks only while one is configured; preview never publishes.
  const [clock, setClock] = useState(Date.now()), countdownOn = !!form?.config.header?.countdown?.enabled;
  useEffect(() => { if (!countdownOn) return; setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [countdownOn]);
  useEffect(() => { if (!dirty) return; const warn = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  useEffect(() => () => { if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl); }, [bannerPreviewUrl]);
  const change = patch => { setDirty(true); setForm(f => ({ ...f, ...patch })); };
  const config = patch => { setDirty(true); setForm(f => ({ ...f, config: { ...f.config, ...patch } })); };
  const cancelBannerUpload = () => { setShowUploadBanner(false); setBannerFile(null); setBannerPreviewUrl(''); setBannerUploadError(''); };
  
  const open = row => {
    // A live record with a saved draft opens its draft; the live version stays as listed.
    const source = row?.draft ? { ...row, ...row.draft.values } : row;
    setForm(row ? { ...source, config: structuredClone(source.config), startAt: scheduleInput(source.startAt), endAt: scheduleInput(source.endAt), draftRevision: row.draft?.revision || 0 } : blank(kind));
    setDirty(false);
    setFormError('');
    setShowUploadBanner(false);
    setBannerFile(null);
    setBannerPreviewUrl('');
    setBannerUploadError('');
    uploadedBanner.current = null;
    setNewBannerForm({
      title: row?.name || '',
      subtitle: '',
      cta: 'Explore now',
      actionType: 'NONE',
      targetCategoryId: '',
      externalUrl: '',
    });
  };

  const close = async () => { if (operationBusy.current || uploadingBanner) return; if (!dirty || await ui.ask('Discard unsaved changes?')) { setForm(null); setDirty(false); setBannerFile(null); setBannerPreviewUrl(''); } };
  
  const bannerStorefrontLabel = (type) => {
    if (type === 'general') return 'All Storefronts (General)';
    if (type === 'grocery') return 'Quick Commerce';
    if (type === 'ecommerce') return 'Shop All';
    return type || 'General';
  };

  const selectedBanner = banners.find(b => b._id === form?.config.bannerId);
  const requiredType = form?.scope === 'quick' ? 'grocery' : form?.scope === 'shop-all' ? 'ecommerce' : 'general';
  const isBannerMismatched = Boolean(selectedBanner && selectedBanner.type !== 'general' && selectedBanner.type !== requiredType);
  // A local file is previewable before upload, but only the returned server ID is saved.
  const artworkPreview = showUploadBanner && (bannerFile || newBannerForm.image) ? { ...newBannerForm, _id: bannerPreviewUrl, image: bannerPreviewUrl || newBannerForm.image, title: newBannerForm.title || form?.name || 'Campaign Banner' } : selectedBanner;
  const previewBanner = artworkPreview && form?.config.animation?.scope === 'banner' ? { ...artworkPreview, animation: { ...form.config.animation, startAt: null, endAt: null } } : artworkPreview;

  const save = async publish => {
    if (operationBusy.current || uploadingBanner) return; operationBusy.current = true; setBusy(true); setFormError('');
    try {
      const attachedBanner = showUploadBanner && (bannerFile || newBannerForm.image) ? await uploadBanner() : selectedBanner;
      const bannerId = attachedBanner?._id || form.config.bannerId;
      if (publish && form.kind === 'campaign') {
        if (!bannerId) {
          throw new Error('Please select or upload a banner before publishing.');
        }
        if (attachedBanner === selectedBanner && isBannerMismatched) {
          throw new Error(`Banner storefront mismatch: Selected banner is set for "${bannerStorefrontLabel(selectedBanner?.type)}", but this campaign is set for "${form.scope === 'global' ? 'All Storefronts (global)' : form.scope}". Switch the campaign storefront or upload a matching banner.`);
        }
      }
      const payload = { ...form, config: { ...form.config, ...(bannerId ? { bannerId } : {}) }, startAt: scheduleISO(form.startAt), endAt: scheduleISO(form.endAt) };
      let result = form._id ? await adminPatch(`/storefront/${form._id}`, payload) : await adminPost('/storefront', payload);
      // Retain saved identity even when subsequent publication fails validation.
      const liveDraft = !!result.data.draft;
      setForm(f => ({ ...f, _id: result.data._id, revision: result.data.revision, status: result.data.status, draftRevision: result.data.draft?.revision || 0 })); setDirty(false);
      if (publish) result = await adminPost(`/storefront/${result.data._id}/actions/publish`, { revision: result.data.revision, draftRevision: result.data.draft?.revision });
      triggerToast(publish ? 'Published. Customers refresh within 30 seconds.' : liveDraft ? 'Draft saved. The live version is unchanged until you publish this draft.' : 'Draft saved. Publish when ready.'); setForm(null); setReload(r => r + 1);
    } catch (err) { setFormError(err.message); setReload(r => r + 1); } finally { operationBusy.current = false; setBusy(false); }
  };

  const uploadBanner = async () => {
    if (!bannerFile && !newBannerForm.image) throw new Error('Please select an image or poster.');
    const title = (newBannerForm.title || form.name || 'Campaign Banner').trim();
    if (!title) {
      throw new Error('Please enter a banner title.');
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
      fd.append('placement', 'STUDIO');
      fd.append('priority', String(form.priority || 0));
      if (form.startAt) fd.append('startDate', scheduleISO(form.startAt));
      if (form.endAt) fd.append('endDate', scheduleISO(form.endAt));
      fd.append('isActive', 'true');
      fd.append('isDraft', 'false');
      fd.append('image', bannerFile || newBannerForm.image);
      for (const key of ['mediaType', 'mobileImage', 'video', 'mobileVideo', 'autoplay', 'muted', 'loop', 'playsInline']) if (newBannerForm[key] !== undefined) fd.append(key, String(newBannerForm[key]));

      const result = await authPost('/api/banners', fd);
      const createdBanner = result.data || result;
      if (!createdBanner?._id || !createdBanner.image) throw new Error('The upload did not return a saved banner. Please try again.');
      uploadedBanner.current = createdBanner;
      triggerToast('Banner uploaded and selected successfully!');
      setBanners(prev => [createdBanner, ...prev]);
      config({ bannerId: createdBanner._id });
      setShowUploadBanner(false);
      setBannerFile(null);
      setBannerPreviewUrl('');
      return createdBanner;
    } catch (err) {
      setBannerUploadError(err.message || 'Failed to upload banner');
      throw err;
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleUploadBanner = async () => {
    if (operationBusy.current) return;
    operationBusy.current = true; setFormError('');
    try { await uploadBanner(); } catch (err) { setFormError(err.message || 'Failed to upload banner'); }
    finally { operationBusy.current = false; }
  };

  const action = async (row, name) => {
    if (busy) return;
    if (['archive', 'rollback'].includes(name) && !await ui.ask(`${name === 'archive' ? 'Archive' : 'Roll back'} “${row.name}”? ${name === 'archive' ? 'This removes it from the storefront and preserves its history.' : 'The previous publication will be validated and published again.'}`)) return;
    setBusy(true); setError('');
    if (name === 'discard' && !await ui.ask(`Discard the unpublished changes to “${row.name}”? The live version is not affected.`)) return;
    try { await adminPost(`/storefront/${row._id}/actions/${name}`, { revision: row.revision, draftRevision: row.draftRevision ?? row.draft?.revision }); setReload(r => r + 1); triggerToast(name === 'discard' ? 'Draft discarded. The live version is unchanged.' : 'Configuration updated.'); return true; } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const tokens = form?.kind === 'theme' ? resolveTokens(form.config.tokens) : themes.find(t => t._id === form?.config.themeId)?.config.tokens || DEFAULT_TOKENS;
  // Choosing a festive preset suggests matching header colours and animation; every value stays editable.
  const applyPreset = preset => {
    const next = PRESETS[preset], suggested = PRESET_EFFECTS[preset], current = form.config.animation;
    config({ preset, tokens: { ...next }, header: { ...DEFAULT_HEADER, ...form.config.header, background: next.header, text: next.headerText },
      ...(suggested ? { animation: { ...DEFAULT_EFFECT, ...current, enabled: true, preset: suggested, presets: [suggested], colors: [...EFFECT_COLORS[suggested]] } } : {}) });
  };
  const previewHeader = normalizeHeader(form?.kind === 'theme' ? form.config.header : themes.find(t => t._id === form?.config.themeId)?.config.header);
  const festive = !!(previewHeader?.enabled && previewHeader.title);
  // Custom animations saved on other themes and listed campaigns can be reused here.
  const customLibrary = [...themes, ...rows].filter(r => r._id !== form?._id).flatMap(r => [r.config?.animation, r.draft?.config?.animation]).flatMap(a => a?.customs || []);
  const previewEffect = form?.config.animation && form.config.animation.scope !== 'banner' ? { ...form.config.animation, startAt: null, endAt: null } : null;
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
      {row.draft && <p className="studio-help" role="status">Unpublished draft saved {displayDate(row.draft.savedAt)}.{row.draft.stale ? ' The live version changed since; open, review and save it before publishing.' : ' Customers still see the live version.'}</p>}
      <div className="studio-actions"><button onClick={() => open(row)}>{row.draft ? 'Edit draft & preview' : 'Edit & preview'}</button><button onClick={() => { open({ ...row, draft: null, _id: undefined, revision: undefined, name: `${row.name} copy`.slice(0, 100), status: 'draft' }); setDirty(true); }}>Duplicate</button>
        <button disabled={busy} onClick={() => action(row, row.status === 'published' ? 'pause' : 'publish')}>{row.status === 'published' ? 'Pause' : row.draft ? 'Publish draft' : 'Publish'}</button>
        {row.draft && row.status === 'published' && <button disabled={busy || row.draft.stale} onClick={() => action(row, 'publish')}>Publish draft</button>}
        {row.draft && <button disabled={busy} onClick={() => action(row, 'discard')}>Discard draft</button>}
        {row.status !== 'archived' && <button disabled={busy} onClick={() => action(row, 'archive')}>Archive</button>}{row.canRollback && <button disabled={busy} onClick={() => action(row, 'rollback')}>Rollback</button>}
      </div>
    </article>)}</div>}
    <div className="studio-pagination"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1, pages)}</span><button disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div>
    {form && <ModalPortal className="studio-overlay" role="dialog" aria-modal="true" aria-label={`${form._id ? 'Edit' : 'Create'} ${form.kind}`} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      <div className="studio-editor"><header><div><span className="studio-kicker">{form.kind.toUpperCase()} EDITOR</span><h2>{form.name || 'Untitled draft'}</h2></div><button disabled={busy || uploadingBanner} onClick={close} aria-label="Close editor">✕</button></header>
      <div className="studio-editor-body"><form id="studio-form" onSubmit={e => { e.preventDefault(); save(false); }}>
        <fieldset disabled={busy || uploadingBanner}>
        {form.kind === 'campaign' && select('Placement', form.config.placement, [{ value: 'hero', label: 'Homepage banner' }, { value: 'splash', label: 'Splash screen · app launch' }, { value: 'announcement', label: 'Announcement' }], placement => config({ placement }))}
        <Field label="Name"><input required maxLength={100} value={form.name} onChange={e => change({ name: e.target.value })} /></Field><Field label="Internal description"><textarea maxLength={2000} value={form.description} onChange={e => change({ description: e.target.value })} /></Field>
        <div className="studio-pair">{select('Storefront', form.scope, ['global', 'quick', 'shop-all'], scope => change({ scope }))}{select('Device', form.device, ['all', 'mobile', 'desktop'], device => change({ device }))}</div>
        <div className="studio-pair"><Field label="Start · IST"><input type="datetime-local" value={form.startAt} onChange={e => change({ startAt: e.target.value })} /></Field><Field label="End · IST"><input type="datetime-local" value={form.endAt} onChange={e => change({ endAt: e.target.value })} /></Field></div>
        <Field label="Priority (higher wins)"><input type="number" min="0" max="1000" value={form.priority} onChange={e => change({ priority: Number(e.target.value) })} /></Field>
        {form.kind === 'theme' && <>{select('Apply theme', form.config.application || 'storefront', [{ value: 'storefront', label: 'Storefront default for this scope' }, { value: 'campaign', label: 'Only while a linked campaign is active' }], application => config({ application }))}{select('Theme preset', form.config.preset, Object.keys(PRESETS), applyPreset)}<div className="studio-colors">{COLOR_KEYS.map(key => <Field key={key} label={key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase())}><input type="color" value={tokens[key]} onChange={e => config({ tokens: { ...tokens, [key]: e.target.value } })} /></Field>)}</div>
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
                  onClick={cancelBannerUpload}
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
                        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
                          setBannerFile(null); setBannerPreviewUrl(''); e.target.value = '';
                          setBannerUploadError('Choose a JPEG, PNG or WebP image up to 5 MB.');
                          return;
                        }
                        setBannerFile(file);
                        setBannerPreviewUrl(URL.createObjectURL(file));
                        setBannerUploadError(''); setFormError(''); setDirty(true);
                      }
                    }}
                  />
                  {bannerPreviewUrl && (
                    <div className="studio-upload-thumb">
                      <img src={bannerPreviewUrl} alt="Banner preview" />
                    </div>
                  )}
                </Field>
                {bannerFile && <p className="studio-help" role="status">Image selected. Save draft or Publish will upload and attach it automatically.</p>}

                <StorefrontMediaFields value={newBannerForm} onBusy={setUploadingBanner} onChange={patch => { setNewBannerForm(f => ({ ...f, ...patch })); setDirty(true); }} />
                <button type="button" onClick={() => { setBannerFile(null); setBannerPreviewUrl(''); setDirty(true); }}>Remove selected local image</button>
                <Field label="Banner Title *">
                  <input
                    placeholder="e.g. Diwali Mega Sale"
                    value={newBannerForm.title}
                    onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, title: e.target.value })); }}
                  />
                </Field>

                <Field label="Subtitle / Tagline (Optional)">
                  <input
                    placeholder="e.g. Festive discounts up to 50% off"
                    value={newBannerForm.subtitle}
                    onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, subtitle: e.target.value })); }}
                  />
                </Field>

                <div className="studio-pair">
                  <Field label="Button CTA text">
                    <input
                      placeholder="e.g. Explore now"
                      value={newBannerForm.cta}
                      onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, cta: e.target.value })); }}
                    />
                  </Field>
                  <Field label="Action / Destination">
                    <select
                      value={newBannerForm.actionType}
                      onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, actionType: e.target.value })); }}
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
                      onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, targetCategoryId: e.target.value })); }}
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
                      onChange={e => { setDirty(true); setNewBannerForm(f => ({ ...f, externalUrl: e.target.value })); }}
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
                    disabled={uploadingBanner || (!bannerFile && !newBannerForm.image)}
                    onClick={handleUploadBanner}
                  >
                    {uploadingBanner ? 'Uploading…' : '✓ Upload & Link to Campaign'}
                  </button>
                  <button
                    type="button"
                    disabled={uploadingBanner}
                    onClick={cancelBannerUpload}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {form.kind === 'campaign' && <>{select('Theme override', form.config.themeId, refs(themes), themeId => config({ themeId }))}
          {form.config.placement === 'splash' && <>{select('Frequency', form.config.frequency, [{ value: 'launch', label: 'Every eligible launch' }, { value: 'session', label: 'Once per browser tab session' }, { value: 'daily', label: 'Once per day (IST)' }, { value: 'version', label: 'Once per publication version' }], frequency => config({ frequency }))}<Field label="Auto-close after seconds (2–15)"><input type="number" min="2" max="15" value={form.config.duration} onChange={e => config({ duration: Number(e.target.value) })} /></Field><label className="studio-check"><input type="checkbox" checked={form.config.countdown} onChange={e => config({ countdown: e.target.checked })} />Show countdown to configured end time</label><p className="studio-help">The splash closes automatically after the configured duration. One splash maximum per app launch. Audience: all visitors to the selected storefront.</p></>}
        </>}
        {form.kind === 'section' && <><Field label="Customer-facing title"><input maxLength={100} value={form.config.title} onChange={e => config({ title: e.target.value })} /></Field>{select('Product collection', form.config.source, [{ value: 'recent', label: 'Recently added' }, { value: 'featured', label: 'Featured / curated picks' }, { value: 'category', label: 'Category collection' }, { value: 'price', label: 'Under a price' }, { value: 'campaign', label: 'Flash sale / accepted deal products' }, { value: 'wholesale', label: 'Wholesale discovery' }], source => config({ source }))}
          {form.config.source === 'category' && select('Category', form.config.categoryId, refs(categories), categoryId => config({ categoryId }))}
          {form.config.source === 'campaign' && select('Deal campaign', form.config.campaignId, refs(deals), campaignId => config({ campaignId }))}
          {form.config.source === 'price' && <Field label="Maximum price (INR)"><input type="number" min="1" value={form.config.maxPrice} onChange={e => config({ maxPrice: Number(e.target.value) })} /></Field>}
          <div className="studio-pair"><Field label="Display order (lower first)"><input type="number" min="0" max="1000" value={form.order} onChange={e => change({ order: Number(e.target.value) })} /></Field><Field label="Product limit"><input type="number" min="1" max="24" value={form.config.limit} onChange={e => config({ limit: Number(e.target.value) })} /></Field></div>{select('Appearance', form.config.variant, ['plain', 'soft', 'accent'], variant => config({ variant }))}{select('Layout', form.config.layout || 'rail', ['rail', 'grid'], layout => config({ layout }))}
<label className="studio-check"><input type="checkbox" checked={!!form.config.appearance?.background} onChange={e => config({ appearance: e.target.checked ? { background: DEFAULT_TOKENS.highlight, text: DEFAULT_TOKENS.text, accent: DEFAULT_TOKENS.primary } : {} })} />Custom section colors</label>
{form.config.appearance?.background && <div className="studio-colors">{['background', 'text', 'accent'].map(key => <Field key={key} label={'Section ' + key}><input type="color" value={form.config.appearance[key]} onChange={e => config({ appearance: { ...form.config.appearance, [key]: e.target.value } })} /></Field>)}</div>}
        </>}
        {form.kind === 'theme' && <StorefrontHeaderFields value={form.config.header} onChange={header => config({ header })} deals={deals} />}
        {form.kind !== 'section' && <StorefrontEffectFields value={form.config.animation} onChange={animation => config({ animation })} allowBanner={form.kind === 'campaign'} deals={deals} library={customLibrary} />}
        </fieldset>
      </form><aside className="studio-preview-pane"><div className="studio-preview-toggle"><button aria-pressed={preview === 'mobile'} onClick={() => setPreview('mobile')}>Mobile</button><button aria-pressed={preview === 'desktop'} onClick={() => setPreview('desktop')}>Desktop</button></div>
        <div className={`studio-preview studio-preview--${preview} sf-storefront`} style={themeStyle(tokens)} data-decoration={tokens.decoration} data-motion={tokens.motion} data-category={tokens.category} data-product={tokens.product}>
        {form.kind === 'campaign' && form.config.placement === 'splash' ? <StorefrontSplashPreview banner={previewBanner} config={form.config} device={preview} endAt={form.endAt ? `${form.endAt}:00+05:30` : null} /> : <><div className="studio-preview-header"><Celebration effect={festive ? null : previewEffect} preview />BULKIMART <small>Quick · ShopAll</small><div className="studio-preview-search">Search products and categories</div></div>
          {/* Same bounded hosts as the storefront: festive header first, otherwise the top header. */}
          {festive && <FestiveHeader header={previewHeader} effect={previewEffect} now={clock} preview />}
          {previewBanner ? <><div className="studio-preview-art"><StorefrontMedia banner={{ ...previewBanner, id: previewBanner._id }} device={preview} eager /><Celebration effect={previewBanner.animation} preview /></div><div className="studio-preview-copy"><span className="sf-eyebrow">PREVIEW</span><h2>{previewBanner.title}</h2><p>{previewBanner.subtitle}</p><span className="sf-cta">{previewBanner.cta || 'Explore now'} →</span></div></> : <div className="studio-preview-copy studio-preview-hero"><span className="sf-eyebrow">YOUR STOREFRONT</span><h2>{form.kind === 'section' ? form.config.title || form.name : 'A little more to love.'}</h2><p>Discover your next favourite on Bulkimart.</p><span className="sf-cta">Explore collection →</span><div className="studio-preview-cards"><article className="sf-product"><div className="sf-product-body"><strong>Product preview</strong><span className="sf-rating">Prices and ratings from catalog</span><button type="button" className="sf-add">Add to cart +</button></div></article></div></div>}
        <div className="studio-preview-collection" style={form.kind === 'section' ? { background: form.config.appearance?.background, color: form.config.appearance?.text, borderColor: form.config.appearance?.accent } : undefined}>
<strong>{form.kind === 'section' ? form.config.title || 'Collection preview' : 'Shop by category'}</strong><div className="studio-preview-category"><span>Category artwork</span></div><small>{form.kind === 'section' ? (form.config.layout || 'rail') + ' layout · live catalog after publication' : 'Published category artwork appears here'}</small></div>
<div className="studio-preview-nav"><strong>⌂ Home</strong><span>▦ Categories</span><span>♧ Cart</span></div>
</>}</div>{!(form.kind === 'campaign' && form.config.placement === 'splash') && <p className="studio-help">Appearance preview only. Published content uses live, eligible catalog data.</p>}</aside></div>
      <footer>{['published', 'paused'].includes(form.status) && <p>{form.draftRevision ? 'Editing the saved draft.' : 'Editing creates a draft.'} The {form.status === 'paused' ? 'paused' : 'live'} version stays unchanged until you publish this draft. Cancel abandons unsaved changes.</p>}{formError && <p className="studio-error" role="alert">{formError}</p>}<div className="studio-actions"><button disabled={busy || uploadingBanner} onClick={close}>Cancel</button>{form._id && form.draftRevision > 0 && <button disabled={busy || uploadingBanner} onClick={async () => { if (await action(form, 'discard')) { setDirty(false); setForm(null); } }}>Discard draft</button>}<button disabled={busy || uploadingBanner} type="submit" form="studio-form">{uploadingBanner ? 'Uploading…' : busy ? 'Saving…' : 'Save draft'}</button><button disabled={busy || uploadingBanner || !form.name.trim()} className="sa-btn-primary" onClick={() => save(true)}>{uploadingBanner ? 'Uploading…' : form.startAt ? 'Publish schedule' : ['published', 'paused'].includes(form.status) ? 'Publish draft' : 'Publish now'}</button></div></footer>
      </div>
    </ModalPortal>}
  </div>;
}
