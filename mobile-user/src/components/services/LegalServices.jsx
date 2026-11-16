// Port of components/services/LegalServices.jsx (customer side). The web's paths map to route params:
//   /legal-services                   → view=undefined, id=undefined (catalogue + search)
//   /legal-services/:serviceId        → id=<serviceId> (service form)
//   /legal-services/requests          → view=requests
//   /legal-services/requests/:id      → view=requests&id=<applicationId>
// Private documents are downloaded with the session token into the app cache, then handed to the share sheet.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { ChevronRight, FileText, Scale, Search } from 'lucide-react-native';
import { apiUrl, boundedFetch, getToken } from '../../api/client';
import { session } from '../../lib/storage';
import { initPushNotifications } from '../../lib/push';
import { useRefreshHandler } from '../../lib/refresh';
import { useSession } from '../../context/SessionContext';
import { useUser } from '../../context/UserContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { Text, TextInput } from '../ui';
import ServicePaymentPanel, { DynamicFields, feeText, newIdempotencyKey, payServiceFee, pickedFile } from './ServicePayment';
import { blend, rupees, serviceIcon } from './serviceUi';
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

// `embedded`: shown inside the Services tab, which supplies its own heading and "My requests" link.
// `buy`: opened from "Buy now" on the Services tab — jump to the order form. `scrollTo(y)` scrolls the page.
export default function LegalServices({ view, id: routeId, embedded = false, buy = false, scrollTo }) {
  const router = useRouter();
  const theme = useAppTheme();
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
  const [termsOpen, setTermsOpen] = useState(false);
  const navigate = (nextView, nextId) => router.push({ pathname: '/legal-services', params: { ...(nextView ? { view: nextView } : {}), ...(nextId ? { id: nextId } : {}) } });
  const signIn = () => setActiveNav('account');
  // The service list lives on the Services tab (Legal Services toggle); the old list page forwards there.
  const listPage = !history && !id;
  useEffect(() => { if (listPage && !embedded) router.replace({ pathname: '/services', params: { tab: 'legal' } }); }, [listPage, embedded, router]);
  // "Buy now": once the service has loaded, scroll to its order form. A service that asks for nothing goes straight to Pay.
  const detailY = useRef(0), formY = useRef(0), jumped = useRef(false);
  useEffect(() => {
    if (!buy || history || !detail?._id || jumped.current) return;
    jumped.current = true;
    if (!detail.fields?.length) setReview(true);
    const t = setTimeout(() => scrollTo?.(Math.max(0, detailY.current + formY.current - 8)), 250);
    return () => clearTimeout(t);
  }, [buy, history, detail, scrollTo]);

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

  // Pull down to refresh (LegalServicesScreen / Services tab) reloads this list or request; no Refresh button.
  useRefreshHandler(async () => { refresh(n => n + 1); });
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
    // Submitting a request is an explicit action: ask for notifications so review updates reach the customer.
    void initPushNotifications({ requestPermission: true }).catch(() => {});
    if (b.data.status === 'awaiting_payment' && b.data.billing) {
      const outcome = await payServiceFee({ application: b.data, request: customerRequest, authorization: customerAuthorization }).catch(e => ({ message: e.message }));
      setNotice(outcome.verified ? 'Payment received. Your request has been submitted for review.' : `${outcome.message || 'Payment was not completed.'} Your request is saved — pay the fee below to submit it.`);
    } else setNotice('Request submitted. Our team will review it shortly.');
    navigate('requests', b.data._id);
  });
  // The amount actually charged at submit is base + GST (backend serviceFeeQuote), so show the total, not the base.
  const feeQuote = !history && detail?.fee?.totalPaise > 0 ? detail.fee : null;
  const fee = feeQuote ? feeQuote.totalPaise : !history && detail?.startingPrice ? Math.round(Number(detail.startingPrice.amount) * 100) : 0;
  const base = detail?._id ? `/api/customer-services/applications/${detail._id}` : '';
  const adminNote = history && detail ? [...(detail.events || [])].reverse().find(e => e.message && !['customer_response', 'information_required', 'rejected', 'submitted'].includes(e.action)) : null;

  return <View accessibilityLabel="Legal Services" style={{ padding: embedded ? 0 : 16 }}>
    {listPage && !embedded && <Text style={styles.intro}>Explore legal services and submit a private request. Final pricing is confirmed after review.</Text>}
    {listPage && !embedded && <View style={[styles.segment, { borderColor: theme.border }]} accessibilityRole="tablist" accessibilityLabel="Legal services navigation">
      {[['Browse services', !history, () => navigate()], ['My requests', history, () => (isLoggedIn ? navigate('requests') : signIn())]].map(([label, on, press]) =>
        <Pressable key={label} onPress={press} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.segmentBtn, on && { backgroundColor: theme.action }]}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: on ? theme.actionText || '#fff' : '#475569' }}>{label}</Text>
        </Pressable>)}
    </View>}
    {listPage && !isLoggedIn && !embedded && <ActionButton variant="plain" title="Sign in to view your requests" onPress={signIn} style={{ marginBottom: 16 }} />}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ marginBottom: 8 }}>{notice}</Text> : null}
    {error ? <View style={styles.state} accessibilityRole="alert"><Text style={styles.h2}>Legal Services update</Text><Text style={{ marginBottom: 10 }}>{error}</Text><ActionButton variant="soft" disabled={busy} title="Reload latest" onPress={() => refresh(n => n + 1)} style={{ alignSelf: 'flex-start' }} /></View> : null}
    {!history && !id && <View style={[styles.search, { borderColor: theme.border }]}>
      <Search size={18} color="#64748b" />
      <TextInput value={search} onChangeText={t => { setSearch(t); setPage(1); }} maxLength={100} placeholder="Search by service name or keyword" placeholderTextColor="#94a3b8" accessibilityLabel="Search legal services" style={styles.searchInput} />
    </View>}
    {loading ? <View style={styles.state}><Text>Loading Legal Services…</Text></View>
      : detail ? history ? <View>
        <Text style={styles.h3}>{detail.serviceName}</Text>
        <Text>Reference: <ServiceReference value={detail._id} /></Text>
        <Text style={{ fontWeight: '700', marginVertical: 8 }}>{REQUEST_STATUS[detail.status] || statusLabel(detail.status)}</Text>
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
      </View> : <View onLayout={e => { detailY.current = e.nativeEvent.layout.y; }} style={{ gap: 12 }}>
        {/* Service summary: what it is and what it costs. */}
        <View style={styles.dCard}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={[styles.dIcon, { backgroundColor: theme.highlight }]}>{React.createElement(serviceIcon(detail.name), { size: 24, color: theme.highlightText || theme.action })}</View>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={styles.dTitle}>{detail.name}</Text>
              {detail.description ? <Text style={styles.dMuted}>{detail.description}</Text> : null}
            </View>
          </View>
          <View style={[styles.dPrice, { backgroundColor: blend(theme.action, '#ffffff', 0.07), borderColor: blend(theme.action, '#ffffff', 0.2) }]}>
            {fee ? <>
              <Text style={styles.dPriceLabel}>{feeQuote?.taxRate > 0 ? 'TOTAL PAYABLE' : 'SERVICE FEE'}</Text>
              <Text style={styles.dPriceValue}>{rupees(fee)} <Text style={styles.dMuted}>{feeQuote?.taxRate > 0 ? `incl. ${feeQuote.taxRate}% GST · ` : '· '}paid when you submit</Text></Text>
            </> : <Text style={styles.dPriceValue}>Price confirmed after review</Text>}
          </View>
        </View>
        {detail.instructions ? <View style={[styles.dCard, { backgroundColor: '#fffdf5', borderColor: '#f3e7bd' }]}>
          <Text style={styles.dH3}>How it works</Text><Text style={styles.dBody}>{detail.instructions}</Text>
        </View> : null}
        {fee > 0 && feeQuote ? <View style={styles.dCard}>
          <Text style={styles.dH3}>Price details</Text>
          <View style={styles.feeLine}><Text style={styles.dBody}>Service fee</Text><Text style={styles.dBody}>{rupees(feeQuote.basePaise ?? fee)}</Text></View>
          {feeQuote.taxPaise > 0 && <View style={styles.feeLine}><Text style={styles.dBody}>GST ({feeQuote.taxRate}%)</Text><Text style={styles.dBody}>{rupees(feeQuote.taxPaise)}</Text></View>}
          <View style={[styles.feeLine, styles.feeTotal]}><Text style={{ fontWeight: '800', color: '#0f172a' }}>Total payable</Text><Text style={{ fontWeight: '800', color: '#0f172a' }}>{rupees(fee)}</Text></View>
          {detail.terms ? <Pressable onPress={() => setTermsOpen(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: termsOpen }} style={styles.termsToggle}>
            <Text style={{ color: theme.header || theme.action, fontWeight: '700', fontSize: 13 }}>{termsOpen ? '▾' : '▸'} Payment, cancellation & disclaimer terms</Text>
          </Pressable> : null}
          {termsOpen && detail.terms ? <Text style={[styles.dMuted, { marginTop: 8 }]}>{detail.terms}</Text> : null}
        </View> : null}
        {/* Order form: the customer's details, then the agree-and-pay step. */}
        <View style={styles.dCard} onLayout={e => { formY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.dH3}>{review ? 'Review & pay' : 'Your details'}</Text>
          <Text style={styles.dMuted}>{detail.fields?.length ? 'Only share what this service needs. Your documents stay private.' : 'No details needed. Continue to pay and submit your request.'}</Text>
          <DynamicFields fields={detail.fields} answers={answers} setAnswers={setAnswers} files={files} setFiles={setFiles} errors={errors} disabled={busy || review} />
          {review && detail.fields?.length > 0 && <Text style={[styles.dMuted, { marginTop: 8 }]}>Check the details above, then submit your request.</Text>}
          {review && fee > 0 && <Pressable disabled={busy} onPress={() => setAccepted(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}
            style={[styles.agree, { backgroundColor: blend(theme.action, '#ffffff', 0.07) }]}>
            <View style={[styles.box, accepted && { backgroundColor: theme.header || theme.action, borderColor: theme.header || theme.action }]}>{accepted ? <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text> : null}</View>
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 19 }}>I agree to the payment, cancellation and disclaimer terms, and to pay {rupees(fee)} now. If my request is rejected, the fee is refunded to my Bulkimart wallet.</Text>
          </Pressable>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            {review && detail.fields?.length > 0 && <Pressable onPress={() => setReview(false)} accessibilityRole="button" style={[styles.dBtn, { borderWidth: 1, borderColor: '#d5dde7', backgroundColor: '#fff' }]}>
              <Text style={{ color: '#172b4d', fontWeight: '800', fontSize: 15 }}>Edit details</Text>
            </Pressable>}
            <Pressable disabled={busy || (review && fee > 0 && !accepted)} accessibilityRole="button"
              onPress={() => { if (!isLoggedIn) { signIn(); return; } if (!review) setReview(true); else submit(); }}
              style={[styles.dBtn, { flex: 1, backgroundColor: theme.header || theme.action }, (busy || (review && fee > 0 && !accepted)) && { opacity: 0.45 }]}>
              <Text style={{ color: theme.headerText || '#fff', fontWeight: '800', fontSize: 15 }}>{!isLoggedIn ? 'Sign in to continue' : !review ? 'Continue' : busy ? (fee ? 'Opening payment…' : 'Submitting…') : fee ? `Pay ${rupees(fee)} & submit` : 'Submit request'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
        : !error && <View>
          <View style={{ gap: 12 }}>{items.map(a => <Pressable key={a._id} accessibilityRole="button" accessibilityLabel={(history ? 'View request ' : 'View service ') + (a.name || a.serviceName)}
            onPress={() => { if (history) navigate('requests', a._id); else if (!isLoggedIn) signIn(); else navigate(undefined, a._id); }}
            style={({ pressed }) => [styles.item, { borderColor: theme.border }, pressed && { backgroundColor: '#f8fafc' }]}>
            <View style={[styles.itemIcon, { backgroundColor: theme.highlight }]}>{history ? <FileText size={22} color={theme.highlightText} /> : <Scale size={22} color={theme.highlightText} />}</View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text numberOfLines={2} style={styles.itemTitle}>{a.name || a.serviceName}</Text>
              {history ? <>
                <Text style={[styles.chip, { backgroundColor: theme.highlight, color: theme.highlightText }]}>{REQUEST_STATUS[a.status] || statusLabel(a.status)}</Text>
                <Text style={styles.itemMeta}>{new Date(a.createdAt).toLocaleDateString()} · <ServiceReference value={a._id} /></Text>
              </> : <>
                {a.description ? <Text numberOfLines={2} style={styles.itemMeta}>{a.description}</Text> : null}
                <View style={styles.bookRow}>
                  <Text style={styles.price}>{a.fee?.totalPaise > 0 ? `${feeText(a.fee.totalPaise)}${a.fee.taxPaise > 0 ? ' incl. GST' : ''}` : 'Price after review'}</Text>
                  <Text style={[styles.bookBtn, { backgroundColor: theme.action, color: theme.actionText || '#fff' }]}>{a.fee?.totalPaise > 0 ? 'Book now' : 'Request'}</Text>
                </View>
              </>}
            </View>
            {history ? <ChevronRight size={20} color="#94a3b8" /> : null}
          </Pressable>)}</View>
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
  intro: { color: '#52647b', fontSize: 14, lineHeight: 21, marginBottom: 14 },
  segment: { flexDirection: 'row', padding: 4, borderWidth: 1, borderRadius: 12, backgroundColor: '#fff', marginBottom: 16, gap: 4 },
  segmentBtn: { flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, backgroundColor: '#fff', marginBottom: 18 },
  searchInput: { flex: 1, fontSize: 15, color: '#172b4d', paddingVertical: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff' },
  itemIcon: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 15.5, fontWeight: '700', color: '#172b4d', lineHeight: 21 },
  itemMeta: { fontSize: 13, color: '#64748b', lineHeight: 18 },
  bookRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  price: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: '#0f172a' },
  bookBtn: { fontSize: 13, fontWeight: '700', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, overflow: 'hidden' },
  feeLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chip: { alignSelf: 'flex-start', fontSize: 11.5, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
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
  dCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8edf3', borderRadius: 16, padding: 16, elevation: 1, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 3 } },
  dIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#172b4d', marginTop: 2, marginBottom: 4 },
  dMuted: { fontSize: 13, lineHeight: 19, color: '#64748b', fontWeight: '400' },
  dH3: { fontSize: 15, fontWeight: '800', color: '#172b4d', marginBottom: 8 },
  dBody: { fontSize: 13.5, lineHeight: 20, color: '#334155' },
  dPrice: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  dPriceLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.4, marginBottom: 2 },
  dPriceValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  feeTotal: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e2e8f0', borderStyle: 'dashed' },
  termsToggle: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eef2f6' },
  agree: { flexDirection: 'row', gap: 10, marginTop: 14, padding: 12, borderRadius: 12 },
  dBtn: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
});
