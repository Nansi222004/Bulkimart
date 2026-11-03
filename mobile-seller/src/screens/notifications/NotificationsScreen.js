import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import SwitchRow from '../../components/SwitchRow';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/notifications.api';
import { deregisterPush, enablePush, isPushEnabled } from '../../services/push';
import { getApiToken } from '../../services/apiClient';
import { isRetiredSellerNotification as isRetired, notificationTarget } from '../../utils/notificationRouting';
import { dateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Inbox from GET /api/notifications (paginated). Retired promotion/campaign notifications are hidden,
// the same as frontend/src/modules/Seller/utils/retiredFeatures.js.
const PAGE_SIZE = 30;

// Device push opt-in (same role as the web SellerPushControl). The backend has no per-event notification preferences.
function PushToggle() {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  React.useEffect(() => { isPushEnabled().then(setEnabled).catch(() => setEnabled(false)); }, []);
  const change = async (on) => {
    setBusy(true); setNote('');
    try {
      if (on) {
        const result = await enablePush();
        if (result.ok) setEnabled(true);
        else setNote(result.reason === 'permission'
          ? 'Notifications are blocked for Bulkimart Seller. Allow them in Android Settings to receive order alerts.'
          : 'Could not get a push token from this device. Please try again.');
      } else {
        await deregisterPush(getApiToken(), { disable: true });
        setEnabled(false);
      }
    } catch (e) { setNote(e.message || 'Could not update push notifications'); }
    finally { setBusy(false); }
  };
  return (
    <View style={styles.push}>
      <SwitchRow label="Push notifications on this phone" hint="New orders, returns and payout updates" value={!!enabled} disabled={busy || enabled === null} onValueChange={change} />
      {note ? <InlineNotice tone="warning">{note}</InlineNotice> : null}
    </View>
  );
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPage = 1, mode = 'load') => {
    if (mode === 'refresh') setRefreshing(true); else if (mode === 'more') setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const body = await listNotifications(nextPage, PAGE_SIZE);
      const rows = Array.isArray(body?.data) ? body.data : [];
      setItems((current) => (nextPage === 1 ? rows : [...current, ...rows.filter((r) => !current.some((c) => c._id === r._id))]));
      setPage(nextPage);
      setTotal(Number(body?.meta?.total) || 0);
    } catch (e) {
      if (nextPage === 1) setItems([]);
      setError(e.message || 'Could not load notifications');
    } finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  }, []);

  React.useEffect(() => { load(1); }, [load]);

  const open = async (n) => {
    if (!n.isRead) {
      try {
        await markNotificationRead(n._id);
        setItems((current) => current.map((c) => (c._id === n._id ? { ...c, isRead: true } : c)));
      } catch { /* Opening must not depend on read-state delivery. */ }
    }
    const target = notificationTarget(n);
    if (target) navigation.navigate(target.screen, target.params);
  };

  const readAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((c) => ({ ...c, isRead: true })));
    } catch (e) { ToastAndroid.show(e.message || 'Could not mark notifications read', ToastAndroid.SHORT); }
  };

  const visible = items.filter((n) => !isRetired(n));
  if (loading && !items.length) return <LoadingView message="Loading notifications…" />;
  if (error && !items.length) return <ErrorView message={error} onRetry={() => load(1)} />;

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => String(item._id)}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} colors={[colors.primaryDark]} />}
      ListHeaderComponent={(
        <View style={styles.headerGap}>
          <PushToggle />
          {visible.some((n) => !n.isRead) ? <AppButton small variant="outline" title="Mark all as read" onPress={readAll} /> : null}
        </View>
      )}
      ListEmptyComponent={<EmptyView title="No notifications" message="Order, return and payout updates will appear here." />}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (!loadingMore && !loading && items.length < total) load(page + 1, 'more'); }}
      ListFooterComponent={loadingMore ? <Text style={[type.small, styles.footer]}>Loading more…</Text> : null}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => open(item)} style={[styles.row, !item.isRead && styles.unread]}>
          {!item.isRead ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
          <View style={styles.flex}>
            <Text style={type.label}>{item.title}</Text>
            {item.message ? <Text style={type.body}>{item.message}</Text> : null}
            <Text style={type.small}>{dateTime(item.createdAt)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  unread: { borderColor: colors.primary, backgroundColor: colors.aquaLight },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.orange, marginTop: 6 },
  flex: { flex: 1, gap: 2 },
  footer: { textAlign: 'center', padding: spacing.md },
  headerGap: { gap: spacing.sm, marginBottom: spacing.sm },
  push: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
