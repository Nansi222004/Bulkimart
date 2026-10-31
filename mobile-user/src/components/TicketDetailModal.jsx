// Port of components/support/TicketDetailModal.jsx: one support conversation with reply / reopen.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { mediaUrl } from '../api/client';
import { Text } from './ui';

const STATUS_COLORS = { OPEN: '#3b82f6', IN_PROGRESS: '#f59e0b', WAITING_FOR_USER: '#a855f7', RESOLVED: '#16a34a', CLOSED: '#64748b', REOPENED: '#dc2626' };
const fmt = iso => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function TicketDetailModal({ ticket, messages, onClose, onReply, onReopen, currentUserId }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const scroll = useRef(null);
  useEffect(() => { const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); return () => clearTimeout(timer); }, [messages]);
  if (!ticket) return null;
  const handleSend = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try { await onReply(reply.trim()); setReply(''); } catch { /* the reply stays in the box to retry */ } finally { setSending(false); }
  };
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <KeyboardAvoidingView behavior="height" style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.box} accessibilityViewIsModal accessibilityLabel="Support conversation">
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b' }}>#{ticket.ticketNumber || ticket._id}</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a', marginTop: 2 }}>{ticket.subject}</Text>
            <View style={{ marginTop: 6, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[styles.status, { backgroundColor: STATUS_COLORS[ticket.status] || '#64748b' }]}>{(ticket.status || '').replace(/_/g, ' ')}</Text>
              {ticket.category ? <Text style={{ fontSize: 10, color: '#64748b', fontWeight: '700' }}>{ticket.category}</Text> : null}
            </View>
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close support conversation" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 16, color: '#64748b' }}>✕</Text></Pressable>
        </View>
        <ScrollView ref={scroll} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {(messages || []).map(m => {
            const isAdmin = m.senderRole === 'admin';
            const mine = String(m.senderId) === String(currentUserId) && !isAdmin;
            return <View key={m._id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
              <View style={[styles.bubble, { backgroundColor: isAdmin ? '#eff6ff' : mine ? '#ecfdf5' : '#f8fafc', borderColor: isAdmin ? '#bfdbfe' : mine ? '#a7f3d0' : '#e2e8f0' }]}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: isAdmin ? '#2563eb' : '#475569', marginBottom: 3 }}>{isAdmin ? `Support Team${m.senderName ? ` (${m.senderName})` : ''}` : m.senderName}</Text>
                <Text style={{ fontSize: 12.5, color: '#1e293b', lineHeight: 19 }}>{m.message}</Text>
                {(m.attachments || []).length > 0 && <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {m.attachments.map((a, i) => <Pressable key={i} onPress={() => Linking.openURL(mediaUrl(a.url)).catch(() => {})}><Text style={{ fontSize: 10, color: '#2563eb', textDecorationLine: 'underline' }}>📎 {a.fileName || 'attachment'}</Text></Pressable>)}
                </View>}
              </View>
              <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 3, textAlign: mine ? 'right' : 'left' }}>{fmt(m.createdAt)}</Text>
            </View>;
          })}
        </ScrollView>
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
          {ticket.status === 'RESOLVED' ? <Pressable onPress={onReopen} style={[styles.btn, { backgroundColor: '#dc2626' }]}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Reopen Ticket</Text></Pressable>
            : ticket.status === 'CLOSED' ? <Text style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', padding: 8 }}>This ticket is closed.</Text>
              : <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={reply} onChangeText={setReply} placeholder="Type a reply…" placeholderTextColor="#94a3b8" onSubmitEditing={handleSend} returnKeyType="send" style={styles.input} />
                <Pressable onPress={handleSend} disabled={sending || !reply.trim()} style={[styles.send, (sending || !reply.trim()) && { opacity: 0.6 }]}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{sending ? '…' : 'Send'}</Text></Pressable>
              </View>}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 12 },
  box: { width: '100%', maxWidth: 480, maxHeight: '85%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  head: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', alignItems: 'flex-start' },
  status: { fontSize: 10, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 20, color: '#fff', overflow: 'hidden' },
  bubble: { borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  btn: { width: '100%', padding: 12, borderRadius: 10, alignItems: 'center' },
  input: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', fontSize: 12.5, color: '#0f172a' },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#1b7a37', justifyContent: 'center' },
});
