import React, { useCallback, useRef } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getHelpline, listMyTickets } from '../../services/support.api';
import { TICKET_COLORS, normaliseTicketStatus, ticketStatusLabel } from '../../utils/tickets';
import { dateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of SupportTab.jsx. Ticket list from GET /api/tickets; helpline number only when the server provides it
// (the web falls back to a hard-coded number, which is not reproduced). No chat API exists, so there is no chat.
export default function SupportScreen({ navigation }) {
  const loader = useCallback(async () => {
    const [tickets, helpline] = await Promise.all([listMyTickets(), getHelpline().catch(() => null)]);
    return { tickets, helpline };
  }, []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => { if (firstFocus.current) { firstFocus.current = false; return; } refresh(); }, [refresh]));

  if (loading && !data) return <LoadingView message="Loading support…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  const phone = data?.helpline?.sellerHelplineNumber;
  const header = (
    <View style={styles.header}>
      <Card title="Need help?">
        {phone ? (
          <AppButton title={`Call seller support · ${phone}`} variant="outline" onPress={() => Linking.openURL(`tel:${String(phone).replace(/[^\d+]/g, '')}`)} />
        ) : <Text style={type.small}>Raise a ticket below and the Bulkimart team will reply here.</Text>}
        <AppButton title="Create support ticket" variant="accent" onPress={() => navigation.navigate('CreateTicket')} />
      </Card>
      <Text style={type.heading}>Ticket history</Text>
    </View>
  );

  return (
    <FlatList
      data={data?.tickets || []}
      keyExtractor={(t) => String(t._id)}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListEmptyComponent={<EmptyView title="No tickets yet" message="Your support requests will appear here." />}
      renderItem={({ item: t }) => {
        const status = normaliseTicketStatus(t.status);
        return (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('TicketDetail', { id: t._id, title: t.ticketNumber })} style={styles.row}>
            <View style={styles.flex}>
              <Text style={type.label} numberOfLines={2}>{t.subject}</Text>
              <Text style={type.small}>{t.ticketNumber ? `${t.ticketNumber} · ` : ''}{t.category}</Text>
              <Text style={type.small}>Updated {dateTime(t.updatedAt || t.createdAt)}</Text>
            </View>
            <Text style={[styles.status, { color: TICKET_COLORS[status] || colors.textSecondary, borderColor: TICKET_COLORS[status] || colors.border }]}>{ticketStatusLabel(status)}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  flex: { flex: 1, gap: 2 },
  status: { fontSize: 11, fontWeight: '800', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
});
