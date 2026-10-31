// Port of components/services/ServicePaymentPanel.jsx and DynamicFields (ServicesPanel.jsx), customer side only.
// Fee amounts, status and payability come from the application's `billing`; nothing is recomputed here.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { openRazorpayCheckout } from '../../lib/razorpay';
import { session } from '../../lib/storage';
import { Text } from '../ui';
import SelectField from '../SelectField';
import { SERVICE_TEXT_CHARS } from '../../shared/serviceLimits';

export const feeText = paise => `₹${(paise / 100).toFixed(2)}`;
export const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const STATUS_TEXT = { unpaid: 'Not paid yet', pending: 'Payment processing', failed: 'Payment failed — try again', paid: 'Paid', refunded: 'Refunded', partial_refund: 'Partly refunded' };
const STATUS_STYLE = { paid: ['#dcfce7', '#166534'], unpaid: ['#fef3c7', '#92400e'], pending: ['#fef3c7', '#92400e'], failed: ['#fef3c7', '#92400e'], refunded: ['#e0e7ff', '#3730a3'], partial_refund: ['#e0e7ff', '#3730a3'], review: ['#fee2e2', '#991b1b'] };

/** One idempotency key per fee version (kept for this app session) so a retried checkout reuses the gateway order. */
export async function payServiceFee({ application, request, authorization, checkout = openRazorpayCheckout }) {
  const bill = application.billing, storageKey = `service-payment:${application._id}:${bill.version}`;
  const key = session.getItem(storageKey) || newIdempotencyKey();
  session.setItem(storageKey, key);
  const order = await request(`/applications/${application._id}/payment`, { method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ feeVersion: bill.version, amountPaise: bill.amountPaise, acceptTerms: true }) });
  const outcome = await checkout(order.data, { Authorization: authorization(), 'Content-Type': 'application/json' });
  if (outcome.verified) session.removeItem(storageKey);
  return outcome;
}

export default function ServicePaymentPanel({ application, request, onUpdated, authorization }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bill = application.billing;
  if (!bill) return null;
  const amount = feeText(bill.amountPaise);
  const payable = application.status === 'awaiting_payment' && !bill.reviewRequired && ['unpaid', 'pending', 'failed'].includes(bill.status);
  const status = bill.reviewRequired ? 'Needs finance review' : bill.refundedToWallet ? 'Refunded to Bulkimart wallet' : STATUS_TEXT[bill.status] || bill.status;
  const [bg, fg] = STATUS_STYLE[bill.reviewRequired ? 'review' : bill.status] || ['#e2e8f0', '#334155'];
  async function run(pay) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      if (pay) {
        const outcome = await payServiceFee({ application, request, authorization });
        if (!alive.current) return;
        setMessage(outcome.verified ? 'Payment received. Your application has been submitted.' : outcome.message || 'Payment not completed. You can try again.');
      } else {
        const result = await request(`/applications/${application._id}/payment-status`, { method: 'POST', body: '{}' });
        if (!alive.current) return;
        setMessage(`Payment status: ${STATUS_TEXT[result.data.status] || result.data.status}`);
      }
      await onUpdated?.();
    } catch (e) { if (alive.current) setMessage(e.message); } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <View style={[styles.fee, payable && styles.due]} accessibilityLabel="Service fee">
    <View style={styles.feeRow}>
      <Text style={{ color: '#475569', fontSize: 13, fontWeight: '700' }}>Service fee</Text>
      <Text style={{ fontSize: 18, color: '#0f172a', fontWeight: '700', fontVariant: ['tabular-nums'] }}>{amount}</Text>
      <Text style={[styles.status, { backgroundColor: bg, color: fg }]}>{status}</Text>
    </View>
    {payable && <>
      <Text style={{ color: '#475569', fontSize: 13, lineHeight: 19.5 }}>{bill.terms}</Text>
      <Pressable disabled={busy} onPress={() => run(true)} style={[styles.pay, busy && { opacity: 0.6 }]}><Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Opening payment…' : `Pay ${amount}`}</Text></Pressable>
    </>}
    {bill.paymentId && ['pending', 'failed'].includes(bill.status) && <Pressable disabled={busy} onPress={() => run(false)} style={styles.check}><Text style={{ fontWeight: '600' }}>Check payment status</Text></Pressable>}
    {bill.reviewRequired && <Text>Our finance team is reviewing this payment. Work is paused until it is resolved.</Text>}
    {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
  </View>;
}

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
export const pickedFile = asset => ({ uri: asset.uri, name: asset.name || 'document', type: asset.mimeType || MIME[String(asset.name).split('.').pop().toLowerCase()] || 'application/octet-stream', size: asset.size });

/** The service's own form, rendered from its field definitions (text, number, date, select, radio, checkbox, file…). */
export function DynamicFields({ fields = [], answers = {}, setAnswers, files = {}, setFiles, errors = {}, disabled = false }) {
  return fields.map(f => {
    const value = answers[f.id] ?? '';
    const set = v => setAnswers(a => ({ ...a, [f.id]: v }));
    const label = `${f.label}${f.required ? ' *' : ''}`;
    let control;
    if (f.type === 'select') control = <SelectField value={value} onChange={set} disabled={disabled} placeholder="Choose…" options={[{ value: '', label: 'Choose…' }, ...f.options.map(o => ({ value: o, label: o }))]} />;
    else if (f.type === 'radio') control = <View style={{ gap: 8 }} accessibilityRole="radiogroup">{f.options.map(o => <Pressable key={o} disabled={disabled} onPress={() => set(o)} accessibilityRole="radio" accessibilityState={{ checked: answers[f.id] === o }} style={styles.choice}>
      <View style={[styles.radio, answers[f.id] === o && styles.radioOn]} /><Text>{o}</Text></Pressable>)}</View>;
    else if (f.type === 'checkbox') control = <Pressable disabled={disabled} onPress={() => set(answers[f.id] !== true)} accessibilityRole="checkbox" accessibilityState={{ checked: answers[f.id] === true }} style={styles.choice}>
      <View style={[styles.box, answers[f.id] === true && styles.boxOn]}>{answers[f.id] === true ? <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text> : null}</View><Text>{f.label}</Text></Pressable>;
    else if (f.type === 'file') control = <View style={{ gap: 6 }}>
      <Pressable disabled={disabled} style={styles.check} onPress={async () => {
        const result = await DocumentPicker.getDocumentAsync({ type: f.formats.map(x => MIME[x]).filter(Boolean), copyToCacheDirectory: true }).catch(() => ({ canceled: true }));
        if (!result.canceled && result.assets?.[0]) setFiles(a => ({ ...a, [f.id]: pickedFile(result.assets[0]) }));
      }}><Text style={{ fontWeight: '600' }}>{files[f.id] ? 'Change file' : 'Choose file'}</Text></Pressable>
      {files[f.id] ? <Text style={{ fontSize: 13 }}>📄 {files[f.id].name}</Text> : null}
    </View>;
    else control = <TextInput value={String(value)} editable={!disabled} multiline={f.type === 'textarea'} accessibilityLabel={f.label}
      keyboardType={f.type === 'number' ? 'decimal-pad' : f.type === 'phone' ? 'phone-pad' : f.type === 'email' ? 'email-address' : 'default'}
      autoCapitalize={f.type === 'email' ? 'none' : 'sentences'} placeholder={f.type === 'date' ? 'YYYY-MM-DD' : undefined} placeholderTextColor="#94a3b8"
      maxLength={f.type === 'date' ? 10 : f.maxLength ?? SERVICE_TEXT_CHARS}
      onChangeText={t => set(f.type === 'number' ? (t === '' ? '' : Number.isFinite(Number(t)) ? Number(t) : t) : t)}
      style={[styles.input, f.type === 'textarea' && { minHeight: 100, textAlignVertical: 'top' }, errors[f.id] && { borderColor: '#dc2626' }]} />;
    return <View key={f.id} style={{ gap: 10, marginVertical: 10 }}>
      {f.type !== 'checkbox' && <Text style={{ fontWeight: '600' }}>{label}</Text>}
      {control}
      {(f.help || f.type === 'file') ? <Text style={{ fontSize: 13, lineHeight: 19.5, color: '#475569' }}>{f.help}{f.type === 'file' ? ` (${f.formats.join(', ')}; max ${(f.maxBytes / 1024 / 1024).toFixed(1)} MB)` : ''}</Text> : null}
      {errors[f.id] ? <Text accessibilityRole="alert" style={{ color: '#9f1239', fontSize: 13 }}>{errors[f.id]}</Text> : null}
    </View>;
  });
}

const styles = StyleSheet.create({
  fee: { gap: 8, marginVertical: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: '#dbe4ee', borderRadius: 12, backgroundColor: '#f8fafc' },
  due: { borderColor: '#99d5e6', backgroundColor: '#f0f9fc' },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  status: { marginLeft: 'auto', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  pay: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#0f766e', justifyContent: 'center' },
  check: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: '#b8deed', borderRadius: 9, backgroundColor: '#fff', justifyContent: 'center' },
  input: { padding: 10, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 7, backgroundColor: '#fff', fontSize: 16, color: '#172b4d' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#64748b' },
  radioOn: { borderColor: '#0f766e', borderWidth: 6 },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
});
