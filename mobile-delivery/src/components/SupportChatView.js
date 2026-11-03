/**
 * Live chat with Bulkimart Support — React Native view shared by the
 * customer, seller and delivery apps. Keep IDENTICAL in mobile-user,
 * mobile-seller and mobile-delivery; app differences come in as props:
 *
 *   chat              useSupportChat(...) result (src/utils/supportChatCore.js)
 *   colors            { primary, primaryDark, accent, text, textMuted, border, surface, white, error, success }
 *   Text, TextInput   the app's text components (font + scaling rules)
 *   pickAttachments() → Promise<[{ uri, name, type, size }]>  (app's own picker)
 *   onCreateTicket()  open the app's existing ticket form
 *   relatedOrders     [{ id, label }] optional
 *   initialRelatedOrderId
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput as RNTextInput, View } from 'react-native';
import { deliveryState, STATUS_LABEL } from '../utils/supportChatCore';

const OPEN = ['WAITING', 'ACTIVE'];
const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const TICK = { sending: '…', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '!' };
const TICK_LABEL = { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not sent' };

const PILL = { WAITING: ['#fff7ed', '#c2410c'], ACTIVE: ['#ecfdf5', '#047857'], RESOLVED: ['#eff6ff', '#1d4ed8'], CLOSED: ['#f1f5f9', '#64748b'] };

function StatusPill({ status, Text }) {
  const [bg, fg] = PILL[status] || PILL.CLOSED;
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color: fg }]}>{STATUS_LABEL[status]}</Text></View>;
}

function Banner({ children }) {
  return <View style={styles.banner}>{children}</View>;
}

function Chip({ label, selected, onPress, c, Text }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.chip, { borderColor: selected ? c.primaryDark : c.border, backgroundColor: selected ? c.primaryDark : c.white }]}>
      <Text style={[styles.chipText, { color: selected ? c.white : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export default function SupportChatView({
  chat, colors, Text = RNText, TextInput = RNTextInput, pickAttachments, onCreateTicket,
  relatedOrders = [], initialRelatedOrderId = '', autoOpen = true,
}) {
  const c = { primary: '#08b9e8', primaryDark: '#078ccb', accent: '#ff8500', text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0', surface: '#f8fafc', white: '#ffffff', error: '#dc2626', success: '#047857', ...colors };
  const [topic, setTopic] = useState('');
  const [orderId, setOrderId] = useState(initialRelatedOrderId);
  const [firstMessage, setFirstMessage] = useState('');
  const [startFiles, setStartFiles] = useState([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const { active, messages, availability } = chat;

  useEffect(() => {
    chat.refresh().then((list) => {
      const open = list.find((x) => OPEN.includes(x.status));
      if (open && autoOpen) chat.openConversation(open._id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setOrderId(initialRelatedOrderId); }, [initialRelatedOrderId]);
  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, chat.agentTyping]);

  const pick = async (setter) => {
    if (!pickAttachments) return;
    try {
      const picked = await pickAttachments();
      if (picked?.length) setter(picked.slice(0, 3));
    } catch (err) { setNotice(err.message || 'Could not attach the file.'); }
  };

  const start = async () => {
    if (!topic || !firstMessage.trim()) { setNotice('Choose a topic and describe your issue.'); return; }
    setBusy(true); setNotice('');
    try {
      await chat.startChat({ supportCategory: topic, message: firstMessage.trim(), relatedOrderId: orderId || undefined, files: startFiles });
      setFirstMessage(''); setStartFiles([]); setTopic('');
    } catch (err) { setNotice(err.message); } finally { setBusy(false); }
  };

  const send = async () => {
    if (!draft.trim() && !files.length) return;
    const text = draft; const attach = files;
    setDraft(''); setFiles([]); setNotice('');
    try { await chat.send(text, attach); } catch (err) { setNotice(err.message); }
  };

  const busyMessage = availability && availability.status !== 'AVAILABLE' ? availability.message : '';

  // ---------------------------------------------------------------- conversation
  if (active) {
    const open = OPEN.includes(active.status);
    const renderMessage = ({ item: m, index }) => {
      const showDay = index === 0 || day(m.createdAt) !== day(messages[index - 1].createdAt);
      const mine = !['AGENT', 'SYSTEM'].includes(m.senderRole);
      const state = deliveryState(m);
      return (
        <View>
          {showDay ? <Text style={[styles.day, { color: c.textMuted }]}>{day(m.createdAt)}</Text> : null}
          {m.senderRole === 'SYSTEM' ? <Text style={[styles.system, { color: c.textMuted }]}>{m.messageText}</Text> : (
            <View style={[styles.row, mine && styles.rowMine]}>
              <View style={[styles.bubble, { borderColor: c.border, backgroundColor: c.white }, mine && { backgroundColor: c.primaryDark, borderColor: c.primaryDark }, m.failed && { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}>
                {!mine ? <Text style={{ fontSize: 11, fontWeight: '800', color: c.accent }}>{m.senderName || 'Support'}</Text> : null}
                {m.messageText ? <Text selectable style={{ fontSize: 15, lineHeight: 21, color: mine && !m.failed ? c.white : c.text }}>{m.messageText}</Text> : null}
                {(m.attachments || []).map((a, i) => {
                  const url = typeof a.url === 'string' && /^https?:\/\//.test(a.url) ? a.url : null;
                  const isImage = (a.mimeType || '').startsWith('image/');
                  if (url && isImage) {
                    return <Pressable key={i} onPress={() => Linking.openURL(url)} accessibilityRole="imagebutton" accessibilityLabel={a.fileName || 'Image attachment'}><Image source={{ uri: url }} style={styles.image} /></Pressable>;
                  }
                  return (
                    <Pressable key={i} disabled={!url} onPress={() => url && Linking.openURL(url)} accessibilityRole="link">
                      <Text style={{ fontSize: 13, textDecorationLine: url ? 'underline' : 'none', color: mine && !m.failed ? c.white : c.text }}>📄 {a.local ? 'Uploading ' : ''}{a.fileName || 'Attachment'}</Text>
                    </Pressable>
                  );
                })}
                <Text style={{ alignSelf: 'flex-end', fontSize: 11, color: mine && !m.failed ? 'rgba(255,255,255,0.8)' : c.textMuted }} accessibilityLabel={mine ? `${time(m.createdAt)}, ${TICK_LABEL[state]}` : time(m.createdAt)}>
                  {time(m.createdAt)}{mine ? `  ${TICK[state]}` : ''}
                </Text>
                {m.failed ? <Pressable onPress={() => chat.retry(m).catch(() => {})} accessibilityRole="button"><Text style={{ fontSize: 12, fontWeight: '800', color: c.error }}>Not sent · Tap to retry</Text></Pressable> : null}
              </View>
            </View>
          )}
        </View>
      );
    };

    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
        <View style={[styles.head, { borderColor: c.border, backgroundColor: c.white }]}>
          <Pressable onPress={() => { chat.closeView(); chat.refresh(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to support options" style={styles.headBtn}>
            <Text style={{ fontSize: 20, color: c.text }}>←</Text>
          </Pressable>
          <View style={styles.flex}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }} numberOfLines={1}>{active.agentName || 'Bulkimart Support'}</Text>
            <Text style={{ fontSize: 12, color: c.textMuted }} numberOfLines={1}>
              {active.status === 'ACTIVE' && active.agentName ? (active.agentOnline ? 'Online' : 'Offline') : STATUS_LABEL[active.status]} · {active.conversationNumber}
              {active.relatedTicketNumber ? ` · Ticket #${active.relatedTicketNumber}` : ''}
            </Text>
          </View>
          <StatusPill status={active.status} Text={Text} />
          {open ? (
            <Pressable hitSlop={8} accessibilityRole="button" onPress={() => Alert.alert('End chat?', 'You can reopen it later from chat history.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'End chat', style: 'destructive', onPress: () => chat.closeChat().catch((err) => setNotice(err.message)) },
            ])}><Text style={{ fontSize: 13, fontWeight: '800', color: c.primaryDark, marginLeft: 8 }}>End</Text></Pressable>
          ) : null}
        </View>

        {active.status === 'WAITING' ? (
          <Banner>
            <Text style={styles.bannerText}>
              {availability?.queuePosition ? `You are number ${availability.queuePosition} in the queue. ` : ''}{busyMessage || 'An agent will join shortly.'}
            </Text>
            {busyMessage && onCreateTicket ? <Pressable onPress={onCreateTicket} accessibilityRole="button"><Text style={[styles.link, { color: c.primaryDark }]}>Create a support ticket</Text></Pressable> : null}
          </Banner>
        ) : null}

        <FlatList
          ref={listRef}
          style={[styles.flex, { backgroundColor: c.surface }]}
          contentContainerStyle={styles.messages}
          data={messages}
          keyExtractor={(m) => m._id}
          renderItem={renderMessage}
          ListHeaderComponent={chat.hasMore ? <Pressable onPress={() => chat.loadOlder()} style={[styles.older, { borderColor: c.border }]} accessibilityRole="button"><Text style={{ fontSize: 13, color: c.text }}>Load earlier messages</Text></Pressable> : null}
          ListFooterComponent={chat.agentTyping ? <Text style={{ fontSize: 13, color: c.textMuted, fontStyle: 'italic', marginTop: 4 }} accessibilityLiveRegion="polite">{active.agentName || 'Support'} is typing…</Text> : null}
          keyboardShouldPersistTaps="handled"
        />

        {notice ? <Text style={[styles.notice, { color: c.error }]} accessibilityRole="alert">{notice}</Text> : null}

        {open ? (
          <View style={[styles.composer, { borderColor: c.border, backgroundColor: c.white }]}>
            <Pressable onPress={() => pick(setFiles)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach files" style={styles.headBtn}>
              <Text style={{ fontSize: 20 }}>📎</Text>
            </Pressable>
            <View style={styles.flex}>
              {files.length ? (
                <Pressable onPress={() => setFiles([])} accessibilityRole="button" accessibilityLabel="Remove attachments">
                  <Text style={{ fontSize: 12, color: c.textMuted }} numberOfLines={1}>{files.map((f) => f.name || 'file').join(', ')} · Remove</Text>
                </Pressable>
              ) : null}
              <TextInput value={draft} onChangeText={(v) => { setDraft(v); chat.notifyTyping(); }} placeholder="Type a message…" placeholderTextColor={c.textMuted}
                multiline maxLength={2000} style={[styles.input, { borderColor: c.border, color: c.text }]} accessibilityLabel="Message" />
            </View>
            <Pressable onPress={send} disabled={!draft.trim() && !files.length} accessibilityRole="button" accessibilityLabel="Send message"
              style={[styles.send, { backgroundColor: c.accent, opacity: !draft.trim() && !files.length ? 0.5 : 1 }]}>
              <Text style={{ color: c.white, fontWeight: '800', fontSize: 14 }}>Send</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.ended, { borderColor: c.border, backgroundColor: c.white }]}>
            <Text style={{ fontSize: 14, color: c.textMuted, flexShrink: 1 }}>This chat is {active.status.toLowerCase()}.</Text>
            {active.canReopen ? <Pressable onPress={() => chat.reopenChat().catch((err) => setNotice(err.message))} style={[styles.btn, { backgroundColor: c.primaryDark }]} accessibilityRole="button"><Text style={styles.btnText}>Reopen</Text></Pressable> : null}
            <Pressable onPress={() => { chat.closeView(); chat.refresh(); }} style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} accessibilityRole="button"><Text style={[styles.btnText, { color: c.primaryDark }]}>New chat</Text></Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  // ---------------------------------------------------------------- start + history
  const tone = availability?.status === 'AVAILABLE' ? ['#ecfdf5', c.success] : availability?.status === 'BUSY' ? ['#fff7ed', '#c2410c'] : ['#f1f5f9', c.textMuted];
  return (
    <ScrollView style={[styles.flex, { backgroundColor: c.surface }]} contentContainerStyle={styles.home} keyboardShouldPersistTaps="handled">
      <View style={styles.homeHead}>
        <View style={styles.flex}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>Chat with Support</Text>
          <Text style={{ fontSize: 13, color: c.textMuted }}>Talk to a Bulkimart support agent in real time.</Text>
        </View>
        {availability ? (
          <View style={[styles.pill, { backgroundColor: tone[0] }]}>
            <Text style={[styles.pillText, { color: tone[1] }]}>
              {availability.status === 'AVAILABLE' ? `${availability.availableAgents} available` : availability.status === 'BUSY' ? 'Agents busy' : 'Agents offline'}
            </Text>
          </View>
        ) : null}
      </View>

      {chat.loading && !chat.conversations.length ? <ActivityIndicator color={c.primaryDark} /> : null}
      {chat.error ? <Text style={[styles.notice, { color: c.error }]} accessibilityRole="alert">{chat.error}</Text> : null}
      {busyMessage ? (
        <Banner>
          <Text style={styles.bannerText}>{busyMessage}</Text>
          {onCreateTicket ? <Pressable onPress={onCreateTicket} accessibilityRole="button"><Text style={[styles.link, { color: c.primaryDark }]}>Create a support ticket</Text></Pressable> : null}
        </Banner>
      ) : null}

      {chat.openChat ? (
        <Pressable onPress={() => chat.openConversation(chat.openChat._id)} accessibilityRole="button"
          style={[styles.card, { borderColor: c.primaryDark, backgroundColor: '#eaf9fe' }]}>
          <View style={styles.flex}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: c.text }}>Continue your chat</Text>
            <Text style={{ fontSize: 13, color: c.textMuted }}>{chat.openChat.conversationNumber} · {STATUS_LABEL[chat.openChat.status]}</Text>
          </View>
          {chat.openChat.unreadCount ? <View style={[styles.unread, { backgroundColor: c.accent }]}><Text style={styles.unreadText}>{chat.openChat.unreadCount}</Text></View> : <Text style={{ fontSize: 18, color: c.text }}>→</Text>}
        </Pressable>
      ) : (
        <View style={[styles.card, styles.form, { borderColor: c.border, backgroundColor: c.white }]}>
          <Text style={[styles.label, { color: c.text }]}>Topic</Text>
          <View style={styles.chips}>
            {chat.categories.map((cat) => <Chip key={cat} c={c} Text={Text} label={cat} selected={topic === cat} onPress={() => setTopic(cat)} />)}
          </View>
          {relatedOrders.length ? (
            <>
              <Text style={[styles.label, { color: c.text }]}>Related order (optional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip c={c} Text={Text} label="None" selected={!orderId} onPress={() => setOrderId('')} />
                {relatedOrders.map((o) => <Chip key={o.id} c={c} Text={Text} label={o.label} selected={orderId === o.id} onPress={() => setOrderId(o.id)} />)}
              </ScrollView>
            </>
          ) : null}
          <Text style={[styles.label, { color: c.text }]}>How can we help?</Text>
          <TextInput value={firstMessage} onChangeText={setFirstMessage} multiline maxLength={2000} placeholder="Describe your issue" placeholderTextColor={c.textMuted}
            style={[styles.input, styles.inputTall, { borderColor: c.border, color: c.text }]} accessibilityLabel="Describe your issue" />
          <View style={styles.actions}>
            {pickAttachments ? (
              <Pressable onPress={() => pick(setStartFiles)} style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} accessibilityRole="button">
                <Text style={[styles.btnText, { color: c.primaryDark }]}>📎 {startFiles.length ? `${startFiles.length} file(s)` : 'Attach'}</Text>
              </Pressable>
            ) : <View />}
            <Pressable onPress={start} disabled={busy} style={[styles.btn, { backgroundColor: c.primaryDark, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
              {busy ? <ActivityIndicator color={c.white} /> : <Text style={styles.btnText}>Start chat</Text>}
            </Pressable>
          </View>
          {notice ? <Text style={[styles.notice, { color: c.error }]} accessibilityRole="alert">{notice}</Text> : null}
        </View>
      )}

      <Text style={[styles.label, { color: c.textMuted, marginTop: 8 }]}>CHAT HISTORY</Text>
      {!chat.loading && !chat.conversations.length ? <Text style={{ fontSize: 14, color: c.textMuted }}>No chats yet.</Text> : null}
      {chat.conversations.map((conv) => (
        <Pressable key={conv._id} onPress={() => chat.openConversation(conv._id)} accessibilityRole="button" style={[styles.card, { borderColor: c.border, backgroundColor: c.white }]}>
          <View style={styles.flex}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{conv.supportCategory}</Text>
            <Text style={{ fontSize: 13, color: c.textMuted }} numberOfLines={1}>{conv.lastMessagePreview || '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <StatusPill status={conv.status} Text={Text} />
            <Text style={{ fontSize: 11, color: c.textMuted }}>{day(conv.lastMessageAt)}</Text>
            {conv.unreadCount ? <View style={[styles.unread, { backgroundColor: c.accent }]}><Text style={styles.unreadText}>{conv.unreadCount}</Text></View> : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  home: { padding: 16, gap: 12, paddingBottom: 40 },
  homeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  headBtn: { padding: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
  banner: { backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  bannerText: { fontSize: 13, color: '#9a3412', lineHeight: 18 },
  link: { fontSize: 13, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  form: { flexDirection: 'column', alignItems: 'stretch' },
  label: { fontSize: 12, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '700' },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, maxHeight: 120, minHeight: 42, textAlignVertical: 'top' },
  inputTall: { minHeight: 90 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  btn: { borderRadius: 10, paddingHorizontal: 16, minHeight: 42, justifyContent: 'center', alignItems: 'center' },
  btnGhost: { backgroundColor: '#ffffff', borderWidth: 1.5 },
  btnText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  notice: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 6 },
  messages: { padding: 12, gap: 6 },
  older: { alignSelf: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: '#ffffff', marginBottom: 6 },
  day: { alignSelf: 'center', fontSize: 11, marginVertical: 6 },
  system: { alignSelf: 'center', fontSize: 12, textAlign: 'center', backgroundColor: '#eef2f7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 2 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  image: { width: 200, height: 150, borderRadius: 8, backgroundColor: '#e2e8f0' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 8, borderTopWidth: 1 },
  send: { borderRadius: 12, height: 42, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  ended: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1 },
});
