import React, { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useDuty } from '../../context/DutyContext';
import ActiveDeliveryView from '../active/ActiveDeliveryView';
import { formatRupees } from '../../utils/money';
import { formatTime, ratingSummary } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Duty tab (web DeliveryDashboardPage). While a delivery is active this tab shows that
 * delivery instead, exactly as the web portal replaces the dashboard with ActiveDeliveryPage.
 * All figures come from the server: today's and total earnings from /earnings/summary and
 * /me, COD custody from /me finance.reportedCodOutstanding.
 */
export default function DutyScreen({ navigation }) {
  const { profile, refreshProfile } = useAuth();
  const duty = useDuty();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([refreshProfile(), duty.restoreActive(), duty.loadSummary(), duty.loadReturnPickups()]);
    setRefreshing(false);
  }, [refreshProfile, duty]);

  if (duty.activeOrder) return <ActiveDeliveryView navigation={navigation} />;

  const rating = ratingSummary(profile);
  const daily = duty.summary?.daily;
  const lifetimeTotal = (Number(profile?.earnings?.total) || 0) + (Number(duty.summary?.parcels?.lifetimeTotal) || 0);
  const lifetimeTrips = (Number(profile?.totalDeliveries) || 0) + (Number(duty.summary?.parcels?.lifetimeTrips) || 0);
  const cashPct = Math.min(100, (duty.codOutstanding / duty.codLimit) * 100);
  const activeReturns = duty.returnPickups.active.length;

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={onRefresh}>
      <View>
        <Text style={type.title}>Hi, {profile?.name || 'Rider'}</Text>
        <Text style={type.small}>{rating.value} · {rating.count}</Text>
      </View>

      <Card style={[styles.dutyCard, duty.online ? styles.onlineCard : styles.offlineCard]}>
        <View style={styles.dutyRow}>
          <View style={styles.flex}>
            <Text style={[styles.dutyTitle, duty.online && styles.onlineText]}>{duty.online ? 'You are ONLINE' : 'You are OFFLINE'}</Text>
            <Text style={type.small}>{duty.online ? 'New orders near you will pop up here.' : 'Go online to receive orders.'}</Text>
          </View>
          <Switch value={duty.online} disabled={duty.toggling} onValueChange={(v) => duty.setDuty(v)}
            accessibilityLabel={duty.online ? 'Go offline' : 'Go online'} trackColor={{ true: colors.success, false: colors.border }} thumbColor={colors.white} />
        </View>
      </Card>

      {duty.licenseExpired ? (
        <InlineNotice tone="error">Your driving licence has expired. Renew it and contact support to update your profile before accepting orders.</InlineNotice>
      ) : null}

      {duty.online ? (
        // Updates automatically every minute while on duty; no button needed.
        <View style={[styles.presence, duty.presence.state === 'error' && styles.presenceError]} accessibilityRole={duty.presence.state === 'error' ? 'alert' : undefined}>
          <View style={[styles.presenceDot, duty.presence.state === 'error' ? styles.dotError : duty.presence.updatedAt ? styles.dotOk : styles.dotWait]} />
          <View style={styles.flex}>
            <Text style={styles.presenceTitle}>
              {duty.presence.state === 'error' ? 'Live location not updating'
                : duty.presence.updatedAt ? `Live location on · updated ${formatTime(duty.presence.updatedAt)}` : 'Getting your live location…'}
            </Text>
            <Text style={type.small}>
              {duty.presence.state === 'error' ? `${duty.presence.message} It will retry automatically.` : 'Updates automatically while the app is open and you are online.'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.kpis}>
        <Card style={styles.kpi}>
          <Text style={type.small}>Today’s earnings</Text>
          <Text style={styles.kpiValue}>{daily ? formatRupees(daily.total) : '—'}</Text>
          <Text style={type.small}>{daily ? `${daily.trips} trip${daily.trips === 1 ? '' : 's'} today` : duty.summaryError ? 'Could not load' : 'Loading…'}</Text>
        </Card>
        <Card style={styles.kpi}>
          <Text style={type.small}>Total earnings</Text>
          <Text style={styles.kpiValue}>{profile?.earnings ? formatRupees(Math.round(lifetimeTotal * 100) / 100) : '—'}</Text>
          <Text style={type.small}>{lifetimeTrips} delivered all time</Text>
        </Card>
      </View>

      <Card title="Cash to hand over" onPress={() => navigation.navigate('Cash')} right={<Text style={[styles.badge, duty.codBlocked && styles.badgeBlocked]}>{duty.codBlocked ? 'BLOCKED' : 'ACTIVE'}</Text>}>
        <Text style={styles.cash}>{formatRupees(duty.codOutstanding)}</Text>
        <Text style={type.small}>COD cash you collected for Bulkimart. Limit {formatRupees(duty.codLimit)}.</Text>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${cashPct}%` }, duty.codOutstanding >= 1500 && styles.barWarn, duty.codBlocked && styles.barBlocked]} /></View>
        {duty.codBlocked ? <InlineNotice tone="error">Cash limit reached. Hand over the cash to receive more orders.</InlineNotice>
          : duty.codOutstanding >= 1500 ? <InlineNotice tone="warning">Nearing your cash limit. Hand over the cash soon.</InlineNotice> : null}
        <Text style={styles.link}>Open COD records ›</Text>
      </Card>

      {activeReturns ? (
        <Card title="Return pickups" onPress={() => navigation.navigate('Returns')}>
          <Text style={type.body}>{activeReturns} return pickup{activeReturns === 1 ? '' : 's'} in progress.</Text>
          <Text style={styles.link}>Open return pickups ›</Text>
        </Card>
      ) : null}

      <Card title="Parcel deliveries" onPress={() => navigation.navigate('Parcels')}>
        <Text style={type.body}>Parcel requests and tasks assigned to you.</Text>
        <Text style={styles.link}>Open parcels ›</Text>
      </Card>

      <Card style={styles.listening}>
        <Text style={styles.listeningIcon}>{duty.online ? '📡' : '💤'}</Text>
        <Text style={type.heading}>{duty.online ? 'Ready for orders' : 'You are offline'}</Text>
        <Text style={[type.small, styles.center]}>{duty.online ? (duty.codBlocked ? 'Hand over collected cash to receive more orders.' : 'Keep the app open. You will hear and feel a new request.') : 'Switch on duty to start earning.'}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  presence: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  presenceError: { backgroundColor: colors.errorLight, borderColor: '#fecaca' },
  presenceDot: { width: 12, height: 12, borderRadius: 6 },
  dotOk: { backgroundColor: colors.success },
  dotWait: { backgroundColor: colors.warning },
  dotError: { backgroundColor: colors.error },
  presenceTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  dutyCard: { borderWidth: 2 },
  onlineCard: { borderColor: colors.success, backgroundColor: colors.successLight },
  offlineCard: { borderColor: colors.border },
  dutyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dutyTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  onlineText: { color: '#166534' },
  kpis: { flexDirection: 'row', gap: spacing.md },
  kpi: { flex: 1 },
  kpiValue: { fontSize: 24, fontWeight: '800', color: colors.deepBlue },
  cash: { fontSize: 30, fontWeight: '800', color: colors.orangeDark },
  badge: { fontSize: 12, fontWeight: '800', color: '#166534', backgroundColor: colors.successLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeBlocked: { color: '#991b1b', backgroundColor: colors.errorLight },
  bar: { height: 10, backgroundColor: colors.surface, borderRadius: radius.pill, overflow: 'hidden', marginVertical: spacing.xs },
  barFill: { height: '100%', backgroundColor: colors.primaryDark },
  barWarn: { backgroundColor: colors.warning },
  barBlocked: { backgroundColor: colors.error },
  link: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  listening: { alignItems: 'center', paddingVertical: spacing.xl },
  listeningIcon: { fontSize: 40 },
  center: { textAlign: 'center' },
});
