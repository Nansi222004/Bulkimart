// Route /support — Help & Support as its own page (was a popup inside Account). Sign-in required.
// Raise a ticket, see your tickets, or open live chat (/support/chat).
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { useFeedback } from '../lib/feedback';
import { useTickets } from '../hooks/useTickets';
import { CustomerPage } from '../components/Shell';
import { Text, TextInput } from '../components/ui';
import SelectField from '../components/SelectField';
import TicketDetailModal from '../components/TicketDetailModal';
import AttachmentUploader from '../components/AttachmentUploader';
import AccountPageHeader from '../components/AccountPageHeader';

function Input({ label, ...props }) {
  return <View style={{ gap: 6 }}>
    <Text style={styles.inputLabel}>{label}</Text>
    <TextInput placeholderTextColor="#94a3b8" {...props} style={[styles.input, props.multiline && { height: 100, textAlignVertical: 'top' }]} />
  </View>;
}

function SubmitButton({ title, onPress, disabled, style }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    style={[styles.submit, { backgroundColor: theme.action, shadowColor: theme.primary }, disabled && { opacity: 0.7 }, style]}>
    <Text style={{ color: theme.actionText || '#fff', fontSize: 14, fontWeight: '800' }}>{title}</Text>
  </Pressable>;
}

export default function SupportScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const ui = useFeedback();
  const { currentUser } = useUser();
  const { tickets, categories, loading, fetchCategories, fetchMyTickets, createTicket, fetchTicketDetail, sendMessage, reopenTicket } = useTickets('customer');
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [openTicket, setOpenTicket] = useState(null);
  const [openMessages, setOpenMessages] = useState([]);

  useEffect(() => { if (currentUser) { fetchCategories(); fetchMyTickets(); } }, [currentUser?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!category || !subject.trim() || !description.trim()) { ui.notify('Please choose a category and fill in the subject and description.', { type: 'error' }); return; }
    setSubmitting(true);
    try {
      const t = await createTicket({ category, subject, description }, files);
      setJustCreated(t);
      setCategory(''); setSubject(''); setDescription(''); setFiles([]);
    } catch (err) { ui.notify(err.message, { type: 'error' }); } finally { setSubmitting(false); }
  };
  const openDetail = async t => {
    try {
      const body = await fetchTicketDetail(t._id);
      setOpenTicket(body.data.ticket); setOpenMessages(body.data.messages);
    } catch (err) { ui.notify(err.message, { type: 'error' }); }
  };
  const refreshDetail = async () => {
    const body = await fetchTicketDetail(openTicket._id);
    setOpenTicket(body.data.ticket); setOpenMessages(body.data.messages);
    fetchMyTickets();
  };

  return <CustomerPage protectedPage nav={false} headerColor={theme.header} background="#f8fafc">
    <AccountPageHeader title="Help & Support" />
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 24, paddingBottom: 40 + insets.bottom, gap: 20 }} keyboardShouldPersistTaps="handled">
        {justCreated ? <View style={[styles.card, { paddingVertical: 24, paddingHorizontal: 10, gap: 12, alignItems: 'center' }]}>
          <Text style={{ fontSize: 48 }}>✉️</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', textAlign: 'center' }}>Ticket Submitted Successfully!</Text>
          <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 19.5, textAlign: 'center' }}>Your support ticket ID is <Text style={{ fontWeight: '700', fontSize: 13 }}>#{justCreated.ticketNumber}</Text>. Our team is reviewing the issue and will alert you shortly.</Text>
          <SubmitButton title="Back to Help" onPress={() => setJustCreated(null)} style={{ marginTop: 12, alignSelf: 'stretch' }} />
        </View> : <>
          <Pressable onPress={() => router.push('/support/chat')} accessibilityRole="button" accessibilityLabel="Chat with Support" style={styles.chat}>
            <Text style={{ fontSize: 24 }}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>Chat with Support</Text>
              <Text style={{ fontSize: 12.5, color: '#475569' }}>Talk to a support agent in real time</Text>
            </View>
            <Text style={{ fontSize: 18, color: '#078ccb' }}>→</Text>
          </Pressable>
          <Text style={{ fontSize: 16, color: '#0f172a', fontWeight: '800' }}>Contact Customer Support</Text>
          <Text style={{ fontSize: 13, color: '#64748b', lineHeight: 19.5 }}>Need help with an order, payment, or delivery timing? Open a support ticket and our team will get back within 24 hours.</Text>
          <View style={{ gap: 16 }}>
            <SelectField label="CATEGORY" labelStyle={styles.inputLabel} value={category} onChange={setCategory} placeholder="Select a category" options={categories.map(c => ({ value: c, label: c }))} />
            <Input label="Query Subject" placeholder="e.g. Wallet balance query" value={subject} onChangeText={setSubject} />
            <Input label="How can we assist you?" placeholder="Explain your problem or questions in details..." value={description} onChangeText={setDescription} multiline />
            <View style={{ gap: 6 }}>
              <Text style={styles.inputLabel}>Attachments (optional, up to 5)</Text>
              <AttachmentUploader files={files} maxFiles={5} onAddFiles={selected => setFiles(prev => [...prev, ...selected].slice(0, 5))} onRemoveFile={i => setFiles(prev => prev.filter((_, idx) => idx !== i))} />
            </View>
            <SubmitButton title={submitting ? 'Submitting…' : 'Submit Support Ticket'} onPress={handleSubmit} disabled={submitting} />
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 16 }}>
            <Text style={{ marginBottom: 12, fontSize: 14, color: '#0f172a', fontWeight: '800' }}>MY TICKETS</Text>
            {loading ? <Text style={{ fontSize: 12, color: '#64748b' }}>Loading…</Text>
              : tickets.length === 0 ? <View style={[styles.card, { padding: 16, borderRadius: 12 }]}><Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>No tickets yet</Text></View>
                : tickets.map(t => <Pressable key={t._id} onPress={() => openDetail(t)} accessibilityRole="button" style={styles.ticket}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#64748b' }}>#{t.ticketNumber}</Text>
                    <Text style={[styles.ticketStatus, { backgroundColor: theme.highlight, color: theme.highlightText }]}>{(t.status || '').replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', marginTop: 6, color: '#0f172a' }}>{t.subject}</Text>
                </Pressable>)}
          </View>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
    {openTicket && <TicketDetailModal ticket={openTicket} messages={openMessages} currentUserId={currentUser?._id} onClose={() => setOpenTicket(null)}
      onReply={async msg => { await sendMessage(openTicket._id, msg); await refreshDetail(); }}
      onReopen={async () => { try { await reopenTicket(openTicket._id); await refreshDetail(); } catch (err) { ui.notify(err.message, { type: 'error' }); } }} />}
  </CustomerPage>;
}

const styles = StyleSheet.create({
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#475569', letterSpacing: 0.2, textTransform: 'uppercase' },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#cbd5e1', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 13.5, color: '#0f172a' },
  submit: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8, elevation: 4, shadowOpacity: 0.36, shadowRadius: 9, shadowOffset: { width: 0, height: 10 } },
  card: { padding: 20, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  chat: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#078ccb', backgroundColor: '#eaf9fe' },
  ticket: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10 },
  ticketStatus: { fontSize: 11, fontWeight: '800', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
});
