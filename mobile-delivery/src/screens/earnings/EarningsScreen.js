import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { v4 as uuidv4 } from 'uuid';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import StatusPill from '../../components/StatusPill';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useDuty } from '../../context/DutyContext';
import { useToast } from '../../components/Toast';
import * as deliveryApi from '../../services/delivery.api';
import { formatRupees } from '../../utils/money';
import { formatDateTime, formatTime, maskAccount } from '../../utils/format';
import { PAYOUT_TONE } from '../../utils/status';
import { colors, spacing, type } from '../../theme';

/**
 * Earnings (web EarningsPage). Every figure is the server's:
 *   today / this week     GET /api/delivery/earnings/summary
 *   all time, balances    GET /api/delivery/me (earnings, finance.*)
 *   payouts               GET/POST /api/delivery/payouts
 * The withdrawable amount is finance.verifiedPayable (ledger), and the request is enabled only
 * when the server says finance.payoutActionsEnabled. The payout request reuses one idempotency
 * key per amount, so a retry after a timeout cannot create a second request.
 */
export default function EarningsScreen({ navigation }) {
  const { profile, refreshProfile } = useAuth();
  const { summary, summaryError, loadSummary } = useDuty();
  const toast = useToast();
  const [payouts, setPayouts] = useState({ rows: [], page: 1, pages: 1, loading: true, error: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const attempt = useRef(null);

  const finance = profile?.finance;
  const available = Number(finance?.verifiedPayable) || 0;
  const hasPending = payouts.rows.some((p) => p.status === 'pending');

  const loadPayouts = useCallback(async (page = 1) => {
    setPayouts((s) => ({ ...s, loading: true, error: '' }));
    try {
      const body = await deliveryApi.getPayouts(page);
      setPayouts((s) => ({ rows: page === 1 ? body.data || [] : [...s.rows, ...(body.data || [])], page, pages: body.meta?.pages || 1, loading: false, error: '' }));
    } catch (e) { setPayouts((s) => ({ ...s, loading: false, error: e.message })); }
  }, []);

  useEffect(() => { loadPayouts(1); }, [loadPayouts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([refreshProfile(), loadSummary(), loadPayouts(1)]);
    setRefreshing(false);
  };

  const requestPayout = () => {
    if (!(available > 0)) return;
    if (!attempt.current || attempt.current.amount !== available) attempt.current = { amount: available, key: uuidv4() };
    Alert.alert('Request payout?', `${formatRupees(available)} will be sent to ${profile?.bankDetails?.upiId ? 'your UPI ID' : `account ${maskAccount(profile?.bankDetails?.accountNo)}`}.`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Request', onPress: async () => {
        setRequesting(true);
        try {
          await deliveryApi.requestPayout(attempt.current.amount, attempt.current.key);
          toast.show(`Payout request of ${formatRupees(attempt.current.amount)} submitted.`, 'success');
          attempt.current = null;
        } catch (e) {
          toast.show(e.message || 'Could not submit payout request.', 'error');
          if (e.status) attempt.current = null; // the server answered; a network failure keeps the key for a safe retry
        } finally {
          setRequesting(false);
          refreshProfile(); loadPayouts(1);
        }
      } },
    ]);
  };

  const daily = summary?.daily;
  const weekly = summary?.weekly;
  const lifetimeTotal = (Number(profile?.earnings?.total) || 0) + (Number(summary?.parcels?.lifetimeTotal) || 0);

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={onRefresh}>
      <Card title="Withdrawable balance">
        <Text style={styles.big}>{finance ? formatRupees(available) : '—'}</Text>
        <AppButton title={requesting ? 'Requesting…' : hasPending ? 'Request pending' : 'Cash out to bank'} loading={requesting}
          disabled={!finance || !finance.payoutActionsEnabled || !(available > 0) || hasPending} onPress={requestPayout} />
        <Text style={type.small}>{profile?.bankDetails?.accountNo ? `Bank ${profile.bankDetails.bankName || ''} ${maskAccount(profile.bankDetails.accountNo)}` : profile?.bankDetails?.upiId ? 'UPI account linked' : 'No bank or UPI on file.'}</Text>
        {finance?.payoutSchedule === 'weekly' ? <Text style={type.small}>Payouts are sent automatically every week.</Text> : null}
        {finance?.payoutBlockers?.length ? (
          <View style={styles.blockers}>{finance.payoutBlockers.map((b) => <Text key={b.code} style={type.small}>• {b.message}</Text>)}</View>
        ) : null}
        {finance?.balances ? (
          <>
            <KeyValueRow label="On hold" value={formatRupees(finance.balances.onHold)} />
            <KeyValueRow label="Payout requested" value={formatRupees(finance.balances.requested)} />
            <KeyValueRow label="Paid to you" value={formatRupees(finance.balances.paid)} />
          </>
        ) : null}
        {finance?.legacyUnverified > 0 ? <InlineNotice tone="warning">{formatRupees(finance.legacyUnverified)} in older earnings needs finance review before it can be withdrawn.</InlineNotice> : null}
        <AppButton small variant="outline" title="COD cash and earning records" onPress={() => navigation.navigate('Cash')} />
      </Card>

      <Card title="Today">
        {daily ? (
          <>
            <Text style={styles.big}>{formatRupees(daily.total)}</Text>
            <Text style={type.small}>{daily.trips} trip{daily.trips === 1 ? '' : 's'}{daily.tips > 0 ? ` · includes ${formatRupees(daily.tips)} tips` : ''}</Text>
            {(daily.breakdown || []).map((trip) => (
              <View key={trip.id || `${trip.orderId}-${trip.completedAt}`} style={styles.trip}>
                <View style={styles.flex}>
                  <Text style={type.label}>{trip.type} · {trip.orderId}</Text>
                  <Text style={type.small}>{formatTime(trip.completedAt)}{trip.isCod ? ` · COD ${formatRupees(trip.codAmount)}` : ''}</Text>
                </View>
                <Text style={type.label}>{formatRupees(trip.amount)}</Text>
              </View>
            ))}
          </>
        ) : <Text style={type.small}>{summaryError || 'Loading…'}</Text>}
      </Card>

      <Card title="This week">
        {weekly ? (
          <>
            <Text style={styles.big}>{formatRupees(weekly.total)}</Text>
            <Text style={type.small}>{weekly.trips} trip{weekly.trips === 1 ? '' : 's'}</Text>
            <View style={styles.week}>
              {(weekly.days || []).map((d) => {
                const max = Math.max(1, ...(weekly.days || []).map((x) => Number(x.amount) || 0));
                return (
                  <View key={d.day} style={styles.dayCol} accessibilityLabel={`${d.day} ${formatRupees(d.amount)}`}>
                    <View style={styles.dayTrack}><View style={[styles.dayBar, { height: `${((Number(d.amount) || 0) / max) * 100}%` }]} /></View>
                    <Text style={styles.dayLabel}>{d.day}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : <Text style={type.small}>{summaryError || 'Loading…'}</Text>}
      </Card>

      <Card title="All time">
        <Text style={styles.big}>{profile?.earnings ? formatRupees(Math.round(lifetimeTotal * 100) / 100) : '—'}</Text>
        <Text style={type.small}>{(Number(profile?.totalDeliveries) || 0) + (Number(summary?.parcels?.lifetimeTrips) || 0)} deliveries{Number(profile?.earnings?.tips) > 0 ? ` · ${formatRupees(profile.earnings.tips)} in tips` : ''}</Text>
      </Card>

      <Card title="Payout history">
        {payouts.error ? <InlineNotice tone="error">{payouts.error}</InlineNotice> : null}
        {!payouts.loading && !payouts.rows.length && !payouts.error ? <Text style={type.small}>No payout requests yet.</Text> : null}
        {payouts.rows.map((p) => (
          <View key={p._id} style={styles.trip}>
            <View style={styles.flex}>
              <Text style={type.label}>{formatRupees(p.amount)}</Text>
              <Text style={type.small}>{formatDateTime(p.createdAt)}{p.transactionRef ? ` · Ref ${p.transactionRef}` : ''}</Text>
              {p.rejectionReason ? <Text style={[type.small, { color: colors.error }]}>{p.rejectionReason}</Text> : null}
            </View>
            <StatusPill tone={PAYOUT_TONE[p.status] || 'neutral'} label={p.status} />
          </View>
        ))}
        {payouts.page < payouts.pages ? <AppButton small variant="outline" title="Load more" loading={payouts.loading} onPress={() => loadPayouts(payouts.page + 1)} /> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  big: { fontSize: 30, fontWeight: '800', color: colors.deepBlue },
  blockers: { gap: 2 },
  trip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  week: { flexDirection: 'row', gap: spacing.xs, height: 110, alignItems: 'flex-end', marginTop: spacing.sm },
  dayCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  dayTrack: { flex: 1, width: '70%', justifyContent: 'flex-end', backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  dayBar: { width: '100%', backgroundColor: colors.primaryDark },
  dayLabel: { fontSize: 12, color: colors.textSecondary },
});
