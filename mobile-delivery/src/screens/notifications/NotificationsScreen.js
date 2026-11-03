import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import * as notificationsApi from '../../services/notifications.api';
import { useDuty } from '../../context/DutyContext';
import { isDeliveryNotification, routeForNotification } from '../../utils/notificationRouting';
import { formatDateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Rider inbox (web DeliveryNotifications): GET /api/notifications, PATCH /:id/read, PATCH /read-all.
 * Like the web portal, only notifications with a /delivery route are listed here.
 */
export default function NotificationsScreen({ navigation }) {
  const { loadUnread } = useDuty();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError('');
    try {
      const body = await notificationsApi.listNotifications(p, 30);
      const data = (Array.isArray(body?.data) ? body.data : []).filter(isDeliveryNotification);
      setRows((prev) => (p === 1 ? data : [...prev, ...data]));
      setPage(p);
      setPages(body?.meta?.pages || Math.ceil((body?.meta?.total || 0) / (body?.meta?.limit || 30)) || 1);
    } catch (e) { setError(e.message || 'Could not load notifications'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const open = async (n) => {
    if (pending) return;
    if (!n.isRead) {
      setPending(true);
      try { await notificationsApi.markNotificationRead(n._id); setRows((r) => r.map((x) => (x._id === n._id ? { ...x, isRead: true } : x))); loadUnread(); }
      catch { /* opening still works */ } finally { setPending(false); }
    }
    const target = routeForNotification(n.route);
    if (target.name !== 'Notifications') navigation.navigate(target.name, target.params);
  };

  const readAll = async () => {
    setPending(true);
    try { await notificationsApi.markAllNotificationsRead(); setRows((r) => r.map((x) => ({ ...x, isRead: true }))); loadUnread(); }
    catch (e) { setError(e.message); } finally { setPending(false); }
  };

  if (error && !rows.length) return <ErrorView message={error} onRetry={() => load(1)} />;
  if (loading && !rows.length) return <LoadingView />;

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(n) => n._id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(1)} colors={[colors.primaryDark]} />}
      ListHeaderComponent={rows.some((n) => !n.isRead) ? <AppButton small variant="outline" title="Mark all as read" disabled={pending} onPress={readAll} /> : null}
      ListEmptyComponent={<EmptyView title="No notifications yet" message="Order, payout and cash updates appear here." />}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (!loading && page < pages) load(page + 1); }}
      renderItem={({ item }) => (
        <Pressable onPress={() => open(item)} accessibilityRole="button" style={[styles.item, !item.isRead && styles.unread]}>
          <View style={styles.titleRow}>
            {!item.isRead ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
            <Text style={[type.label, styles.flex]}>{item.title}</Text>
          </View>
          <Text style={type.body}>{item.message}</Text>
          <Text style={type.small}>{formatDateTime(item.createdAt)}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.lg, gap: spacing.sm },
  item: { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  unread: { borderColor: colors.primary, backgroundColor: colors.aquaLight },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
  flex: { flex: 1 },
});
