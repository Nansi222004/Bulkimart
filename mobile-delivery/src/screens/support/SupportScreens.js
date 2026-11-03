import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { launchImageLibrary } from 'react-native-image-picker';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import { InlineNotice } from '../../components/StateViews';
import { checkPickedFile } from '../../components/DocumentPhotoField';
import { useToast } from '../../components/Toast';
import * as supportApi from '../../services/support.api';
import { formatDateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Support tickets (web DeliverySupportPage), /api/tickets with role 'delivery'.
 * Opened from an active delivery it pre-fills the order and links the ticket to it (relatedOrder).
 */
const pickPhotos = async (current) => {
  const room = supportApi.TICKET_MAX_ATTACHMENTS - current.length;
  if (room <= 0) return { files: current, error: `At most ${supportApi.TICKET_MAX_ATTACHMENTS} photos.` };
  const result = await launchImageLibrary({ mediaType: 'photo', selectionLimit: room, quality: 0.7, maxWidth: 1600, maxHeight: 1600 });
  if (result?.didCancel || !result?.assets) return { files: current, error: '' };
  const bad = result.assets.map(checkPickedFile).find(Boolean);
  const ok = result.assets.filter((a) => !checkPickedFile(a)).map((a) => ({ uri: a.uri, name: a.fileName || 'photo.jpg', type: a.type || 'image/jpeg' }));
  return { files: [...current, ...ok].slice(0, supportApi.TICKET_MAX_ATTACHMENTS), error: bad || '' };
};

export function SupportScreen({ route, navigation }) {
  const orderId = route.params?.orderId;
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState(orderId ? 'Order / Delivery' : '');
  const [subject, setSubject] = useState(orderId ? `Delivery support: ${route.params?.orderNo || orderId}` : route.params?.subject || '');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cats, list] = await Promise.all([supportApi.getTicketCategories(), supportApi.listMyTickets()]);
      setCategories(cats); setTickets(list);
      setCategory((c) => (c && cats.includes(c) ? c : cats.includes('Order / Delivery') && orderId ? 'Order / Delivery' : c && cats.includes(c) ? c : ''));
    } catch (e) { setError(e.message || 'Could not load support'); }
    finally { setLoading(false); }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!category || !subject.trim() || !description.trim()) { toast.show('Choose a category and fill subject and description.', 'error'); return; }
    setSubmitting(true);
    try {
      const body = await supportApi.createTicket({ category, subject: subject.trim(), description: description.trim(), relatedOrder: orderId }, files);
      const t = body?.data;
      toast.show(`Ticket ${t?.ticketNumber || ''} created`, 'success');
      setDescription(''); setFiles([]);
      await load();
      if (t?._id) navigation.navigate('TicketDetail', { id: t._id });
    } catch (e) { toast.show(e.message || 'Could not create the ticket', 'error'); }
    finally { setSubmitting(false); }
  };

  return (
    <Screen refreshing={loading && tickets.length > 0} onRefresh={load}>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title="Chat with Support" onPress={() => navigation.navigate('SupportChat', orderId ? { orderId, orderNo: route.params?.orderNo } : undefined)} />
      <Card title="Raise a ticket">
        <Text style={type.label}>Category *</Text>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Pressable key={c} onPress={() => setCategory(c)} accessibilityRole="radio" accessibilityState={{ selected: category === c }} style={[styles.chip, category === c && styles.chipOn]}>
              <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
            </Pressable>
          ))}
          {!categories.length && !loading ? <Text style={type.small}>No categories available.</Text> : null}
        </View>
        <AppInput label="Subject" required value={subject} onChangeText={setSubject} maxLength={200} />
        <AppInput label="Describe the issue" required value={description} onChangeText={setDescription} multiline maxLength={4000} />
        <AppButton small variant="outline" title={`Add photos (${files.length}/${supportApi.TICKET_MAX_ATTACHMENTS})`}
          onPress={async () => { const r = await pickPhotos(files); setFiles(r.files); if (r.error) toast.show(r.error, 'error'); }} />
        {files.length ? <AppButton small variant="ghost" title="Remove photos" onPress={() => setFiles([])} /> : null}
        <AppButton title="Submit ticket" loading={submitting} onPress={submit} />
      </Card>

      <Text style={type.heading}>My tickets</Text>
      {!loading && !tickets.length ? <Text style={type.small}>No tickets yet.</Text> : null}
      {tickets.map((t) => (
        <Card key={t._id} onPress={() => navigation.navigate('TicketDetail', { id: t._id })} title={`#${t.ticketNumber}`} right={<StatusPill tone="info" label={String(t.status || '').replace(/_/g, ' ')} />}>
          <Text style={type.body}>{t.subject}</Text>
          <Text style={type.small}>{t.category} · {formatDateTime(t.updatedAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

export function TicketDetailScreen({ route }) {
  const id = route.params?.id;
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await supportApi.getTicketDetail(id)); setError(''); } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await supportApi.sendTicketMessage(id, reply.trim(), files); setReply(''); setFiles([]); await load(); }
    catch (e) { toast.show(e.message || 'Could not send', 'error'); } finally { setBusy(false); }
  };
  const reopen = async () => {
    setBusy(true);
    try { await supportApi.reopenTicket(id); await load(); } catch (e) { toast.show(e.message, 'error'); } finally { setBusy(false); }
  };

  const t = data?.ticket;
  return (
    <Screen refreshing={!data && !error} onRefresh={load}>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {t ? (
        <Card title={`#${t.ticketNumber}`} right={<StatusPill tone="info" label={String(t.status || '').replace(/_/g, ' ')} />}>
          <Text style={type.heading}>{t.subject}</Text>
          <Text style={type.small}>{t.category}</Text>
        </Card>
      ) : null}
      {(data?.messages || []).map((m, i) => (
        <View key={m._id || i} style={[styles.msg, m.senderRole === 'delivery' || m.senderRole === 'user' ? styles.mine : null]}>
          <Text style={type.label}>{m.senderName || m.senderRole}</Text>
          <Text style={type.body}>{m.message}</Text>
          {(m.attachments || []).map((a, j) => (
            <Text key={j} style={styles.link} onPress={() => a.url && Linking.openURL(a.url).catch(() => {})}>📎 {a.fileName || 'Attachment'}</Text>
          ))}
          <Text style={type.small}>{formatDateTime(m.createdAt)}</Text>
        </View>
      ))}
      {t?.status === 'RESOLVED' ? <AppButton title="Reopen ticket" variant="outline" loading={busy} onPress={reopen} /> : null}
      {t && t.status !== 'CLOSED' ? (
        <Card title="Reply">
          <AppInput value={reply} onChangeText={setReply} multiline placeholder="Write a message" />
          <AppButton small variant="outline" title={`Add photos (${files.length}/${supportApi.TICKET_MAX_ATTACHMENTS})`}
            onPress={async () => { const r = await pickPhotos(files); setFiles(r.files); if (r.error) toast.show(r.error, 'error'); }} />
          <AppButton title="Send" loading={busy} disabled={!reply.trim()} onPress={send} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.white, fontWeight: '700' },
  msg: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  mine: { backgroundColor: colors.aquaLight, borderColor: colors.primary },
  link: { color: colors.primaryDark, fontWeight: '600', fontSize: 14 },
});
