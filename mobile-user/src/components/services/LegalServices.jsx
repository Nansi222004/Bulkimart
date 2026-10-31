// Port of components/services/LegalServices.jsx (customer side). The web's paths map to route params:
//   /legal-services                   → view=undefined, id=undefined (catalogue + search)
//   /legal-services/:serviceId        → id=<serviceId> (service form)
//   /legal-services/requests          → view=requests
//   /legal-services/requests/:id      → view=requests&id=<applicationId>
// Private documents are downloaded with the session token into the app cache, then handed to the share sheet.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Scale } from 'lucide-react-native';
import { apiUrl, boundedFetch, getToken } from '../../api/client';
import { session } from '../../lib/storage';
import { useSession } from '../../context/SessionContext';
import { useUser } from '../../context/UserContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { Text } from '../ui';
import ServicePaymentPanel, { DynamicFields, feeText, newIdempotencyKey, payServiceFee, pickedFile } from './ServicePayment';
import { SERVICE_ANSWER_BYTES, SERVICE_FILE_BYTES, SERVICE_FILE_COUNT, serializedAnswerBytes } from '../../shared/serviceLimits';

export const statusLabel = s => String(s || '').replaceAll('_', ' ');
export const shortServiceReference = (value, prefix = 'SR') => { const id = String(value?._id || value || ''); return id ? `${prefix}-${id.slice(-6).toUpperCase()}` : '—'; };
const REQUEST_STATUS = { awaiting_payment: 'Payment pending', submitted: 'Submitted — waiting for review', payment_verified: 'Paid — waiting for review', under_review: 'Under review', information_required: 'More information needed', in_progress: 'In progress', completed: 'Completed', rejected: 'Rejected' };
const ID = /^[a-f\d]{24}$/i;

export function useLegalApi() {
  return useCallback(async (path, options = {}) => {
    const isForm = options.body instanceof FormData;
    const r = await boundedFetch(path, { ...options, headers: { Authorization: `Bearer ${getToken() || ''}`, ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }, isForm ? 120000 : undefined);
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.success === false) throw Object.assign(new Error(b.message || 'Unable to load Legal Services'), { fields: b.meta?.fields, status: r.status });
    return b;
  }, []);
}

export function ServiceReference({ value, prefix = 'SR', label = 'Request ID' }) {
  const id = String(value?._id || value || '');
  return <Text selectable accessibilityLabel={id ? `${label}: ${id}` : label} style={styles.reference}>{shortServiceReference(value, prefix)}</Text>;
}

export function ServiceHeading({ parcel = false, title, children, Icon }) {
  const theme = useAppTheme();
  const Glyph = Icon || Scale;
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
    <View style={[styles.headIcon, { backgroundColor: theme.highlight }]}><Glyph size={24} color={theme.action} /></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', marginTop: 3, marginBottom: 6, color: '#172b4d' }}>{title || (parcel ? 'Send a Parcel' : 'Legal Services')}</Text>
      {children}
    </View>
  </View>;
}

export function RequestTimeline({ events = [] }) {
  return <View style={{ gap: 4 }}>{events.map((e, i) => <View key={e._id || i} style={{ paddingVertical: 8, flexDirection: 'row', gap: 8 }}>
    <Text>{i + 1}.</Text>
    <View style={{ flex: 1 }}><Text><Text style={{ fontWeight: '700' }}>{statusLabel(e.action)}</Text> · {new Date(e.at).toLocaleString()}</Text>{e.message ? <Text style={{ lineHeight: 22 }}>{e.message}</Text> : null}</View>
  </View>)}</View>;
}

export async function downloadPrivateFile(path, name) {
  const target = new File(Paths.cache, `${Date.now()}-${String(name || 'document').replace(/[\\/:*?"<>|]+/g, ' ')}`);
  let file;
  try { file = await File.downloadFileAsync(apiUrl(path), target, { headers: { Authorization: `Bearer ${getToken() || ''}` }, idempotent: true }); }
  catch { throw new Error('This document could not be downloaded. Please try again.'); }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is not available on this device.');
  await Sharing.shareAsync(file.uri, { dialogTitle: name });
}

export function PrivateFiles({ files = [], base, run }) {
  return <View style={{ marginVertical: 12, gap: 8 }}>
    <Text style={styles.h3}>Private documents</Text>
    {!files.length && <Text>No documents available.</Text>}
    {files.map(f => <ActionButton key={f.fileId} variant="soft" title={`Download ${f.name}`} onPress={() => run(() => downloadPrivateFile(`${base}/files/${f.fileId}`, f.name))} />)}
  </View>;
}

export function ActionButton({ title, onPress, disabled, variant = 'primary', style }) {
  const theme = useAppTheme();
  const look = variant === 'primary' ? { backgroundColor: theme.action, borderColor: theme.action } : variant === 'tab-on' ? { backgroundColor: theme.action, borderColor: theme.action }
    : variant === 'plain' ? { backgroundColor: '#fff', borderColor: '#cbd5e1' } : { backgroundColor: theme.highlight, borderColor: '#b8deed' };
  const color = variant === 'primary' || variant === 'tab-on' ? '#fff' : variant === 'plain' ? '#475569' : theme.highlightText;
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.btn, look, disabled && { opacity: 0.5 }, style]}>
    <Text style={{ color, fontSize: 13.5, fontWeight: variant === 'tab-on' || variant === 'primary' ? '700' : '600', textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

function FollowUp({ busy, submit }) {
  const [message, setMessage] = useState(''), [files, setFiles] = useState([]);
  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/png', 'image/jpeg'], multiple: true, copyToCacheDirectory: true }).catch(() => ({ canceled: true }));
    if (!result.canceled) setFiles(prev => [...prev, ...result.assets.map(pickedFile)]);
  };
  return <View style={styles.card}>
    <Text style={styles.h3}>Respond to information request</Text>
    <Text style={{ fontWeight: '600', marginTop: 8 }}>Message</Text>
    <TextInput value={message} onChangeText={setMessage} multiline maxLength={2000} style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]} accessibilityLabel="Message" />
    <Text style={{ fontWeight: '600', marginTop: 12 }}>Private documents (up to 10, 5 MiB each)</Text>
    <ActionButton variant="soft" title="Choose files" onPress={pick} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
    {files.map((f, i) => <View key={`${f.uri}${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Text style={{ flex: 1 }}>📄 {f.name}</Text>
      <Pressable onPress={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} accessibilityLabel={`Remove ${f.name}`} hitSlop={8}><Text>✕</Text></Pressable>
    </View>)}
    <ActionButton title="Send update" disabled={busy || !message.trim()} style={{ marginTop: 12, alignSelf: 'flex-start' }} onPress={() => submit(message, files, () => { setMessage(''); setFiles([]); })} />
  </View>;
}

export default function LegalServices({ view, id: routeId }) {
  const router = useRouter();
  const request = useLegalApi();
  const sessionState = useSession();
  const { setActiveNav } = useUser();
  const isLoggedIn = Boolean(sessionState?.verified || getToken());
  const history = view === 'requests';
  const id = routeId && ID.test(String(routeId)) ? String(routeId) : null;
  const [items, setItems] = useState([]), [detail, setDetail] = useState(null), [meta, setMeta] = useState({ total: 0 });
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [revision, refresh] = useState(0);
  const [answers, setAnswers] = useState({}), [files, setFiles] = useState({}), [errors, setErrors] = useState({}), [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [review, setReview] = useState(false);
  const lock = useRef(false), key = useRef(newIdempotencyKey());
  const navigate = (nextView, nextId) => router.push({ pathname: '/legal-services', params: { ...(nextView ? { view: nextView } : {}), ...(nextId ? { id: nextId } : {}) } });
  const signIn = () => setActiveNav('account');

  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError(''); setDetail(null); setAnswers({}); setFiles({}); setAccepted(false); setReview(false);
    const url = history ? `/api/customer-services/applications${id ? `/${id}` : `?page=${page}`}` : id ? `/api/customer-services/catalogue/${id}` : `/api/customer-services?q=${encodeURIComponent(search)}&page=${page}`;
    request(url, { signal: c.signal }).then(b => {
      if (c.signal.aborted) return;
      if (id) {
        if (!b.data || String(b.data._id).toLowerCase() !== id.toLowerCase() || (!history && !Array.isArray(b.data.fields))) throw new Error('Invalid Legal Services response. Please reload.');
        setDetail(b.data);
      } else {
        if (!Array.isArray(b.data) || !Number.isSafeInteger(b.meta?.total) || b.meta.total < 0 || b.data.some(s => !ID.test(s?._id || ''))) throw new Error('Invalid Legal Services response. Please reload.');
        setItems(b.data); setMeta(b.meta);
      }
    }).catch(e => { if (!c.signal.aborted && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [request, history, id, search, page, revision]);

  const run = async fn => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setErrors({}); try { await fn(); } catch (e) { setError(e.message); setErrors(e.fields || {}); } finally { lock.current = false; setBusy(false); } };
  const customerRequest = (suffix, options) => request(`/api/customer-services${suffix}`, options);
  const customerAuthorization = () => `Bearer ${getToken() || ''}`;
  const submit = () => run(async () => {
    if (!getToken()) throw new Error('Sign in from Account before submitting a private request.');
    const chosen = Object.values(files).filter(Boolean);
    if (serializedAnswerBytes(answers) > SERVICE_ANSWER_BYTES || chosen.length > SERVICE_FILE_COUNT || chosen.some(f => f?.size > SERVICE_FILE_BYTES)) throw new Error('Answers or private files exceed the allowed limits.');
    const data = new FormData(); data.append('answers', JSON.stringify(answers)); data.append('formVersion', String(detail.formVersion)); data.append('serviceVersion', String(detail.version));
    Object.entries(files).forEach(([fieldId, f]) => { if (f) data.append(fieldId, { uri: f.uri, name: f.name, type: f.type }); });
    // A non-sensitive retry key only; answers and documents are never stored.
    const storageKey = `legal-submission:${detail._id}`, pendingKey = session.getItem(storageKey) || key.current; session.setItem(storageKey, pendingKey);
    const b = await request(`/api/customer-services/catalogue/${detail._id}/applications`, { method: 'POST', headers: { 'Idempotency-Key': pendingKey }, body: data });
    if (!ID.test(b.data?._id || '')) throw new Error('The submission response is incomplete. Retry to recover the existing request.');
    session.removeItem(storageKey); key.current = newIdempotencyKey();
    if (b.data.status === 'awaiting_payment' && b.data.billing) {
      const outcome = await payServiceFee({ application: b.data, request: customerRequest, authorization: customerAuthorization }).catch(e => ({ message: e.message }));
      setNotice(outcome.verified ? 'Payment received. Your request has been submitted for review.' : `${outcome.message || 'Payment was not completed.'} Your request is saved — pay the fee below to submit it.`);
    } else setNotice('Request submitted. Our team will review it shortly.');
    navigate('requests', b.data._id);
  });
  const fee = !history && detail?.startingPrice ? Math.round(Number(detail.startingPrice.amount) * 100) : 0;
  const base = detail?._id ? `/api/customer-services/applications/${detail._id}` : '';
  const adminNote = history && detail ? [...(detail.events || [])].reverse().find(e => e.message && !['customer_response', 'information_required', 'rejected', 'submitted'].includes(e.action)) : null;

  return <View accessibilityLabel="Legal Services" style={{ padding: 16 }}>
    <ServiceHeading title={history ? 'My Legal Service Requests' : 'Legal Services'}>
      <Text style={{ color: '#52647b', fontSize: 14, lineHeight: 22 }}>Explore legal services and submit a private request. Final pricing is confirmed after review.</Text>
    </ServiceHeading>
    <View style={styles.nav} accessibilityLabel="Legal services navigation">
      <ActionButton variant={!history ? 'tab-on' : 'plain'} title="Browse services" onPress={() => navigate()} style={{ flexGrow: 1 }} />
      <ActionButton variant={history ? 'tab-on' : 'plain'} title="My requests" onPress={() => (isLoggedIn ? navigate('requests') : signIn())} style={{ flexGrow: 1 }} />
      {!isLoggedIn && <ActionButton variant="plain" title="Sign in" onPress={signIn} style={{ width: '100%' }} />}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={{ marginBottom: 8 }}>{notice}</Text> : null}
    {error ? <View style={styles.state} accessibilityRole="alert"><Text style={styles.h2}>Legal Services update</Text><Text style={{ marginBottom: 10 }}>{error}</Text><ActionButton variant="soft" disabled={busy} title="Reload latest" onPress={() => refresh(n => n + 1)} style={{ alignSelf: 'flex-start' }} /></View> : null}
    {!history && !id && <View style={{ gap: 12, marginBottom: 24 }}>
      <Text style={{ color: '#334155', fontSize: 14, fontWeight: '600' }}>Search legal services</Text>
      <TextInput value={search} onChangeText={t => { setSearch(t); setPage(1); }} maxLength={100} placeholder="Search by service name or keyword" placeholderTextColor="#94a3b8" accessibilityLabel="Search legal services" style={[styles.input, { minHeight: 48, borderColor: '#b8c7d7', borderRadius: 10 }]} />
      <Text style={{ color: '#64748b', fontSize: 13 }}>Find the service you need by name or keyword.</Text>
    </View>}
    {loading ? <View style={styles.state}><Text>Loading Legal Services…</Text></View>
      : detail ? history ? <View>
        <Text style={styles.h3}>{detail.serviceName}</Text>
        <Text>Reference: <ServiceReference value={detail._id} /></Text>
        <Text style={{ fontWeight: '700', marginVertical: 8 }}>{REQUEST_STATUS[detail.status] || statusLabel(detail.status)}</Text>
        <ActionButton variant="soft" disabled={busy} title="Refresh request" onPress={() => refresh(n => n + 1)} style={{ alignSelf: 'flex-start' }} />
        {detail.informationRequest ? <Text style={{ marginTop: 8 }}>Information requested: {detail.informationRequest}</Text> : null}
        {detail.rejectionReason ? <Text style={{ marginTop: 8 }}>{detail.rejectionReason}</Text> : null}
        {adminNote ? <Text style={styles.note}><Text style={{ fontWeight: '700', color: '#1e3a8a' }}>Note from Bulkimart:</Text> {adminNote.message}</Text> : null}
        {detail.billing && <ServicePaymentPanel application={detail} request={customerRequest} authorization={customerAuthorization} onUpdated={async () => refresh(n => n + 1)} />}
        <View style={{ marginTop: 8 }}>{detail.fields?.filter(f => f.type !== 'file').map(f => <View key={f.id} style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: '700' }}>{f.label}</Text><Text style={{ marginTop: 5 }}>{String(detail.answers?.[f.id] ?? '—')}</Text>
        </View>)}</View>
        <PrivateFiles files={detail.files} base={base} run={run} />
        {detail.status === 'information_required' && <FollowUp busy={busy} submit={(message, picked, reset) => run(async () => {
          if (picked.length > SERVICE_FILE_COUNT || picked.some(f => f.size > SERVICE_FILE_BYTES)) throw new Error('Upload up to 10 private files, each no larger than 5 MiB.');
          const data = new FormData(); data.append('version', String(detail.version)); data.append('message', message);
          picked.forEach(f => data.append('files', { uri: f.uri, name: f.name, type: f.type }));
          await request(`${base}/respond`, { method: 'POST', body: data });
          reset(); refresh(n => n + 1);
        })} />}
        <Text style={[styles.h3, { marginTop: 12 }]}>Request history</Text>
        <RequestTimeline events={detail.events} />
      </View> : <View>
        <Text style={styles.h3}>{detail.name}</Text>
        {detail.description ? <Text style={styles.p}>{detail.description}</Text> : null}
        {detail.instructions ? <Text style={styles.p}>{detail.instructions}</Text> : null}
        <Text style={{ marginVertical: 8, fontSize: 15, color: '#334155' }}>{fee ? <>Service fee <Text style={{ fontWeight: '700', color: '#0f172a', fontSize: 15 }}>{feeText(fee)}</Text> · paid when you submit</> : 'Free service'}</Text>
        <Text style={styles.p}>Only submit information required for this service. Documents are private.</Text>
        <DynamicFields fields={detail.fields} answers={answers} setAnswers={setAnswers} files={files} setFiles={setFiles} errors={errors} disabled={busy || review} />
        {review && <Text style={styles.p}>Review the information above, then submit your request.</Text>}
        {review && fee > 0 && <View style={[styles.card, { borderColor: '#99d5e6', backgroundColor: '#f0f9fc' }]}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Text style={{ color: '#475569', fontWeight: '700' }}>Service fee</Text><Text style={{ fontSize: 18, fontWeight: '700' }}>{feeText(fee)}</Text></View>
          <Pressable disabled={busy} onPress={() => setAccepted(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={[styles.box, accepted && { backgroundColor: '#0f766e', borderColor: '#0f766e' }]}>{accepted ? <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text> : null}</View>
            <Text style={{ flex: 1 }}>I agree to pay {feeText(fee)} now. If my request is rejected, the fee is refunded to my Bulkimart wallet.</Text>
          </Pressable>
        </View>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {review && <ActionButton variant="soft" title="Edit details" onPress={() => setReview(false)} />}
          <ActionButton disabled={busy || (review && fee > 0 && !accepted)} title={!review ? 'Review request' : busy ? (fee ? 'Opening payment…' : 'Submitting…') : fee ? `Pay ${feeText(fee)} & submit` : 'Submit request'}
            onPress={() => { if (!isLoggedIn) { signIn(); return; } if (!review) setReview(true); else submit(); }} />
        </View>
      </View>
        : !error && <View>
          <View style={{ gap: 16 }}>{items.map(a => <View key={a._id} style={[styles.card, { margin: 0 }]}>
            <Text style={styles.h3}>{a.name || a.serviceName}</Text>
            {history ? <>
              <ServiceReference value={a._id} />
              <Text style={styles.p}>{statusLabel(a.status)} · {statusLabel(a.paymentStatus)}</Text>
              <Text style={styles.p}>{new Date(a.createdAt).toLocaleDateString()}</Text>
            </> : <Text style={styles.p}>{a.description}</Text>}
            <ActionButton title={history ? 'View request' : 'View service'} style={{ alignSelf: 'flex-start', marginTop: 6, minHeight: 38 }}
              onPress={() => { if (history) navigate('requests', a._id); else if (!isLoggedIn) signIn(); else navigate(undefined, a._id); }} />
          </View>)}</View>
          {!items.length && <View style={styles.state}>
            <Text style={styles.h2}>{history ? 'No requests yet' : 'No eligible services available'}</Text>
            <Text style={styles.p}>{history ? 'Your private legal service requests will appear here.' : search ? 'Try another search to find a legal service.' : 'Legal services are currently unavailable. Please check back for available services.'}</Text>
          </View>}
          {meta.total > 20 && <View style={styles.pagination}>
            <ActionButton variant="plain" disabled={page === 1} title="Previous" onPress={() => setPage(n => n - 1)} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#64748b' }}>Page {page}</Text>
            <ActionButton variant="plain" disabled={page * 20 >= meta.total} title="Next" onPress={() => setPage(n => n + 1)} />
          </View>}
        </View>}
  </View>;
}

const styles = StyleSheet.create({
  headIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#cbeaf5' },
  nav: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, marginBottom: 20 },
  btn: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 16, marginVertical: 16 },
  state: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderTopWidth: 3, borderTopColor: '#ff8500', borderRadius: 14, padding: 16, marginVertical: 16 },
  h2: { fontSize: 18, lineHeight: 25, fontWeight: '700', marginBottom: 10, color: '#172b4d' },
  h3: { fontSize: 18, lineHeight: 25, fontWeight: '700', marginBottom: 10, color: '#172b4d' },
  p: { lineHeight: 22, marginVertical: 4, color: '#172b4d' },
  note: { marginVertical: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', color: '#1e3a8a', fontSize: 14, lineHeight: 21, overflow: 'hidden' },
  reference: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 7, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, backgroundColor: '#f8fafc', color: '#334155', fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  input: { padding: 12, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 7, backgroundColor: '#fff', fontSize: 16, color: '#172b4d', marginTop: 6 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
});
