import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import AttachmentPicker from '../../components/AttachmentPicker';
import UploadProgress from '../../components/UploadProgress';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { TICKET_MAX_ATTACHMENTS, getTicketDetail, reopenTicket, sendTicketMessage } from '../../services/support.api';
import { TICKET_COLORS, canReopen, canReply, normaliseTicketStatus, ticketStatusLabel } from '../../utils/tickets';
import { dateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of TicketDetailModal.jsx: message history, reply with attachments, reopen when RESOLVED.
const httpsUrl = (url) => { try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; } };

export default function TicketDetailScreen({ route, navigation }) {
  const { id, title } = route.params;
  useEffect(() => { navigation.setOptions({ title: title || 'Ticket' }); }, [navigation, title]);
  const loader = useCallback(() => getTicketDetail(id), [id]);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [actionError, setActionError] = useState('');

  if (loading && !data) return <LoadingView message="Loading ticket…" />;
  if (!data) return <ErrorView message={error || 'Could not load this ticket'} onRetry={reload} />;

  const { ticket, messages = [] } = data;
  const status = normaliseTicketStatus(ticket.status);

  const send = async () => {
    setActionError('');
    if (!reply.trim()) return;
    setBusy(true); setProgress(0);
    try {
      await sendTicketMessage(ticket._id, reply.trim(), files, setProgress);
      setReply(''); setFiles([]);
      ToastAndroid.show('Message sent', ToastAndroid.SHORT);
      await refresh();
    } catch (e) { setActionError(e.message || 'Could not send the message'); }
    finally { setBusy(false); setProgress(null); }
  };

  const reopen = async () => {
    setBusy(true); setActionError('');
    try { await reopenTicket(ticket._id); ToastAndroid.show('Ticket reopened', ToastAndroid.SHORT); await refresh(); }
    catch (e) { setActionError(e.message || 'Could not reopen the ticket'); }
    finally { setBusy(false); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card title={ticket.subject}>
        <Text style={type.small}>{ticket.ticketNumber} · {ticket.category}</Text>
        <Text style={[styles.status, { color: TICKET_COLORS[status] || colors.textSecondary }]}>{ticketStatusLabel(status)}</Text>
      </Card>

      {messages.map((m, i) => {
        const mine = m.senderRole !== 'admin';
        return (
          <View key={m._id || i} style={[styles.message, mine ? styles.mine : styles.theirs]}>
            <Text style={type.label}>{mine ? 'You' : m.senderName || 'Bulkimart support'}</Text>
            <Text style={type.body} selectable>{m.message}</Text>
            {(m.attachments || []).map((a) => {
              const url = httpsUrl(a.url);
              return url ? (
                <Pressable key={a.url} accessibilityRole="link" onPress={() => Linking.openURL(url)}>
                  <Text style={styles.link}>📎 {a.fileName || 'Attachment'}</Text>
                </Pressable>
              ) : null;
            })}
            <Text style={styles.time}>{dateTime(m.createdAt)}</Text>
          </View>
        );
      })}
      {!messages.length ? <Text style={type.small}>No messages yet.</Text> : null}

      {actionError ? <InlineNotice tone="error">{actionError}</InlineNotice> : null}
      {canReopen(status) ? (
        <Card title="Issue resolved">
          <Text style={type.small}>If the problem is not fixed, reopen the ticket to continue the conversation.</Text>
          <AppButton title="Reopen ticket" variant="outline" loading={busy} onPress={reopen} />
        </Card>
      ) : status === 'CLOSED' ? (
        <InlineNotice tone="info">This ticket is closed. Create a new ticket if you need more help.</InlineNotice>
      ) : canReply(status) ? (
        <Card title="Reply">
          <AppInput multiline maxLength={5000} placeholder="Type your message" value={reply} editable={!busy} onChangeText={setReply} />
          <AttachmentPicker files={files} onChange={setFiles} max={TICKET_MAX_ATTACHMENTS} disabled={busy} />
          {busy ? <UploadProgress progress={progress} label={files.length ? 'Uploading attachments' : 'Sending'} /> : null}
          <AppButton title="Send" loading={busy} disabled={!reply.trim()} onPress={send} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 12, fontWeight: '800' },
  message: { borderRadius: radius.lg, padding: spacing.md, gap: 4, maxWidth: '92%' },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.aquaLight },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  link: { color: colors.primaryDark, fontWeight: '700', paddingVertical: 4 },
  time: { fontSize: 11, color: colors.textMuted },
});
