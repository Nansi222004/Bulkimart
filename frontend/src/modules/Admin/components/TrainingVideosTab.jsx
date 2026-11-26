import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { adminDelete, adminGet, adminPatch, adminPost } from '../../../utils/adminApi';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';

/**
 * Training & coaching videos for the seller app and the delivery (rider) app.
 * An admin uploads an MP4 (stored on our own server, up to 300 MB / 30 min) or pastes a YouTube link,
 * picks who it is for, and groups it under a topic. Sellers and riders see published videos under
 * "Training" in their app; watching is optional.
 */

const AUDIENCES = [
  { id: 'seller', label: 'Seller app' },
  { id: 'delivery', label: 'Delivery app' },
];
const EMPTY = { title: '', description: '', topic: '', sortOrder: 0, source: 'upload', youtubeUrl: '', videoUrl: '', isPublished: true };
const MAX_MB = 300;

const box = { background: 'var(--sa-card-bg, #fff)', border: '1px solid var(--sa-border, #e2e8f0)', borderRadius: 12, padding: 20 };
const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--sa-border, #cbd5e1)', font: 'inherit', fontSize: 13, background: 'var(--sa-input-bg, #fff)', color: 'var(--sa-text-primary, #0f172a)' };
const label = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--sa-text-secondary, #475569)', marginBottom: 12 };
const button = (primary) => ({ padding: '9px 16px', borderRadius: 8, border: primary ? 0 : '1px solid var(--sa-border, #cbd5e1)', background: primary ? '#2563eb' : 'transparent', color: primary ? '#fff' : 'var(--sa-text-primary, #0f172a)', fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const minutes = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '');

/** Upload with progress (fetch has none); same auth and envelope as adminApi. */
function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/admin/training-videos/upload'));
    const token = localStorage.getItem('adminToken');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON, e.g. a proxy error page */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.success !== false && body.data?.url) resolve(body.data);
      else reject(new Error(body.message || (xhr.status === 413 ? `The video is too large for the server (max ${MAX_MB} MB).` : `Upload failed (${xhr.status || 'network error'})`)));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    const form = new FormData();
    form.append('video', file);
    xhr.send(form);
  });
}

export default function TrainingVideosTab() {
  const ui = useFeedback();
  const [audience, setAudience] = useState('delivery');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null = closed; { ...fields, _id? } = editing
  const [progress, setProgress] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await adminGet(`/training-videos?audience=${audience}`)).data || []); }
    catch (e) { ui.notify(e.message || 'Could not load training videos', { type: 'error' }); }
    finally { setLoading(false); }
  }, [audience]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (v) => setForm({ ...EMPTY, ...v, youtubeUrl: v.youtubeId ? `https://youtu.be/${v.youtubeId}` : '' });

  const pickFile = async (file) => {
    if (!file) return;
    if (!/\.(mp4|m4v)$/i.test(file.name) && !/^video\/mp4/i.test(file.type)) { ui.notify('Choose an MP4 video.', { type: 'error' }); return; }
    if (file.size > MAX_MB * 1024 * 1024) { ui.notify(`The video must be ${MAX_MB} MB or smaller.`, { type: 'error' }); return; }
    setProgress(0);
    try {
      const data = await uploadVideo(file, setProgress);
      setForm((f) => ({ ...f, videoUrl: data.url, durationSec: data.durationSec, title: f.title || file.name.replace(/\.[^.]+$/, '') }));
      ui.notify('Video uploaded. Fill in the details and save.', { type: 'success' });
    } catch (e) { ui.notify(e.message, { type: 'error' }); }
    finally { setProgress(null); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { ui.notify('Enter a title.', { type: 'error' }); return; }
    if (form.source === 'upload' && !form.videoUrl) { ui.notify('Upload the video first.', { type: 'error' }); return; }
    if (form.source === 'youtube' && !form.youtubeUrl.trim()) { ui.notify('Paste the YouTube link.', { type: 'error' }); return; }
    const payload = {
      audience, title: form.title, description: form.description, topic: form.topic, sortOrder: Number(form.sortOrder) || 0,
      isPublished: form.isPublished, source: form.source,
      ...(form.source === 'upload' ? { videoUrl: form.videoUrl } : { youtubeUrl: form.youtubeUrl }),
    };
    setSaving(true);
    try {
      if (form._id) await adminPatch(`/training-videos/${form._id}`, payload);
      else await adminPost('/training-videos', payload);
      ui.notify('Training video saved.', { type: 'success' });
      setForm(null);
      load();
    } catch (err) { ui.notify(err.message || 'Could not save', { type: 'error' }); }
    finally { setSaving(false); }
  };

  const togglePublished = async (v) => {
    try { await adminPatch(`/training-videos/${v._id}`, { isPublished: !v.isPublished }); load(); }
    catch (e) { ui.notify(e.message || 'Could not update', { type: 'error' }); }
  };
  const remove = async (v) => {
    if (!window.confirm(`Delete "${v.title}"? ${v.source === 'upload' ? 'The video file is removed from the server too.' : ''}`)) return;
    try { await adminDelete(`/training-videos/${v._id}`); ui.notify('Deleted.', { type: 'success' }); load(); }
    catch (e) { ui.notify(e.message || 'Could not delete', { type: 'error' }); }
  };

  const topics = [...new Set(rows.map((r) => r.topic || 'General'))];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: 'var(--sa-text-primary)' }}>Training & Coaching Videos</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--sa-text-secondary)' }}>
            How-to videos shown under “Training” in the seller and delivery apps. Upload an MP4 (up to {MAX_MB} MB, 30 min, 1080p) or paste an unlisted YouTube link.
          </p>
        </div>
        {!form && <button type="button" style={button(true)} onClick={openNew}>+ Add video</button>}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {AUDIENCES.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={audience === a.id} disabled={!!form}
            onClick={() => setAudience(a.id)} style={{ ...button(audience === a.id), opacity: form && audience !== a.id ? 0.5 : 1 }}>{a.label}</button>
        ))}
      </div>

      {form && (
        <form onSubmit={save} style={{ ...box, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>{form._id ? 'Edit video' : 'New video'} · {AUDIENCES.find((a) => a.id === audience).label}</h3>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {[['upload', 'Upload MP4'], ['youtube', 'YouTube link']].map(([id, text]) => (
              <label key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
                <input type="radio" name="source" checked={form.source === id} onChange={() => set('source', id)} /> {text}
              </label>
            ))}
          </div>
          {form.source === 'upload' ? (
            <div style={{ marginBottom: 12 }}>
              {form.videoUrl ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <video src={form.videoUrl} controls preload="metadata" style={{ width: '100%', maxWidth: 420, borderRadius: 8, background: '#000' }} />
                  <span style={{ fontSize: 12, color: 'var(--sa-text-secondary)' }}>Uploaded{form.durationSec ? ` · ${minutes(form.durationSec)}` : ''}. Choose another file to replace it.</span>
                </div>
              ) : null}
              <input type="file" accept="video/mp4,.mp4,.m4v" disabled={progress !== null} onChange={(e) => pickFile(e.target.files?.[0])} style={{ marginTop: 8 }} />
              {progress !== null && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700 }}>Uploading… {progress}%
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, marginTop: 4 }}><div style={{ width: `${progress}%`, height: 6, background: '#2563eb', borderRadius: 3 }} /></div></div>}
            </div>
          ) : (
            <label style={label}>YouTube link (unlisted is fine)
              <input style={input} value={form.youtubeUrl} placeholder="https://youtu.be/…" onChange={(e) => set('youtubeUrl', e.target.value)} />
            </label>
          )}
          <label style={label}>Title<input style={input} maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="How to accept an order" /></label>
          <label style={label}>Description (optional)<textarea style={{ ...input, minHeight: 70 }} maxLength={1000} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label style={label}>Topic (groups videos in the app)
              <input style={input} maxLength={60} list="training-topics" value={form.topic} onChange={(e) => set('topic', e.target.value)} placeholder="Getting started" />
              <datalist id="training-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label style={label}>Order in topic<input style={input} type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /></label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            <input type="checkbox" checked={form.isPublished} onChange={(e) => set('isPublished', e.target.checked)} /> Show in the app
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={button(true)} disabled={saving || progress !== null}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" style={button(false)} disabled={saving || progress !== null} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div style={box}>
        {loading ? <p style={{ margin: 0, fontSize: 13 }}>Loading…</p>
          : !rows.length ? <p style={{ margin: 0, fontSize: 13, color: 'var(--sa-text-secondary)' }}>No training videos for the {AUDIENCES.find((a) => a.id === audience).label.toLowerCase()} yet.</p>
            : topics.map((topic) => (
              <div key={topic} style={{ marginBottom: 18 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--sa-text-secondary)' }}>{topic}</h4>
                {rows.filter((r) => (r.topic || 'General') === topic).map((v) => (
                  <div key={v._id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--sa-border, #e2e8f0)' }}>
                    <div style={{ width: 96, height: 54, flexShrink: 0, borderRadius: 6, background: '#0f172a', overflow: 'hidden', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 20 }}>
                      {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '▶'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{v.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--sa-text-secondary)' }}>
                        {v.source === 'youtube' ? 'YouTube' : 'Uploaded'}{v.durationSec ? ` · ${minutes(v.durationSec)}` : ''} · order {v.sortOrder}
                        {!v.isPublished && <span style={{ marginLeft: 6, color: '#b45309', fontWeight: 700 }}>· Hidden</span>}
                      </div>
                    </div>
                    <a href={v.watchUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700 }}>Watch</a>
                    <button type="button" style={button(false)} disabled={!!form} onClick={() => openEdit(v)}>Edit</button>
                    <button type="button" style={button(false)} onClick={() => togglePublished(v)}>{v.isPublished ? 'Hide' : 'Show'}</button>
                    <button type="button" style={{ ...button(false), color: '#dc2626' }} onClick={() => remove(v)}>Delete</button>
                  </div>
                ))}
              </div>
            ))}
      </div>
    </div>
  );
}
