import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import NavigateButtons from '../../components/NavigateButtons';
import { InlineNotice, LoadingView, EmptyView } from '../../components/StateViews';
import { useToast } from '../../components/Toast';
import * as deliveryApi from '../../services/delivery.api';
import { formatPaise } from '../../utils/money';
import { formatTime } from '../../utils/format';
import { PARCEL_ACTION_NOTICE, PARCEL_NEXT_STEP, PARCEL_PROBLEMS, parcelFriendlyError, parcelStatus, shortParcelNumber } from '../../utils/status';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Parcel deliveries (web ParcelRiderInbox + ParcelDriverOperations), /api/delivery/parcels/*.
 * Every action sends the booking `version` (and the offer `token` when responding), so a stale
 * screen is refused by the server with 409 and the screen reloads. Pickup and delivery are
 * proven with the sender's / recipient's 6-digit code, verified by the server.
 * Production parcel mutations are release-blocked by the backend (parcelPolicy) — the server message is shown.
 */
const POLL_MS = 10000;

export function ParcelsScreen({ navigation }) {
  const [state, setState] = useState({ loading: true, error: '', items: [], page: 1, pages: 1 });
  const load = useCallback(async (page = 1) => {
    try {
      const body = await deliveryApi.getParcels(page);
      setState({ loading: false, error: '', items: body.data || [], page, pages: body.meta?.pages || 1 });
    } catch (e) { setState((s) => ({ ...s, loading: false, error: e.message })); }
  }, []);
  useEffect(() => {
    load(state.page);
    const t = setInterval(() => load(state.page), POLL_MS);
    return () => clearInterval(t);
  }, [load, state.page]);

  return (
    <Screen refreshing={state.loading && state.items.length > 0} onRefresh={() => load(state.page)}>
      {state.error ? <InlineNotice tone="error">{state.error}</InlineNotice> : null}
      {state.loading && !state.items.length ? <LoadingView /> : null}
      {!state.loading && !state.items.length && !state.error ? <EmptyView title="No parcel requests yet" message="Stay on duty with your location on. New requests appear here." /> : null}
      {state.items.map((b) => {
        const earning = b.earningPaise ?? b.finance?.earningPaise;
        return (
          <Card key={b._id} title={shortParcelNumber(b)} right={<StatusPill tone={b.offer ? 'warning' : 'info'} label={b.offer ? 'New request' : parcelStatus(b.status)} />}
            onPress={() => navigation.navigate('ParcelDetail', { id: b._id })}>
            <Text style={type.body}>{b.offer ? `${b.pickupArea} → ${b.dropoffArea}` : `${b.details?.pickup?.pincode || 'Pickup'} → ${b.details?.dropoff?.pincode || 'Delivery'}`}</Text>
            <Text style={type.label}>{earning != null ? `You earn ${formatPaise(earning)}` : `Delivery fee ${formatPaise(b.feePaise)}`}</Text>
            {b.offer?.expiresAt ? <Text style={type.small}>Reply by {formatTime(b.offer.expiresAt)}</Text> : null}
          </Card>
        );
      })}
      {state.pages > 1 ? (
        <View style={styles.row}>
          <AppButton small variant="outline" style={styles.flex} title="Previous" disabled={state.page <= 1} onPress={() => setState((s) => ({ ...s, page: s.page - 1 }))} />
          <AppButton small variant="outline" style={styles.flex} title="Next" disabled={state.page >= state.pages} onPress={() => setState((s) => ({ ...s, page: s.page + 1 }))} />
        </View>
      ) : null}
    </Screen>
  );
}

export function ParcelDetailScreen({ route, navigation }) {
  const id = route.params?.id;
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(PARCEL_PROBLEMS[0][0]);
  const lock = useRef(false);

  const load = useCallback(async () => {
    try { setDetail(await deliveryApi.getParcel(id)); setError(''); }
    catch (e) {
      if (e.status === 404) { toast.show('This parcel offer is no longer available.'); navigation.goBack(); return; }
      setError(e.message);
    } finally { setLoading(false); }
  }, [id, toast, navigation]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!lock.current) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn, okMessage) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await fn(); if (okMessage) toast.show(okMessage, 'success'); setCode(''); }
    catch (e) {
      if (e.status === 409 || e.status === 404) toast.show('This parcel changed. Showing the latest details.');
      setError(parcelFriendlyError(e));
    } finally { lock.current = false; setBusy(false); await load(); }
  };

  if (loading && !detail) return <LoadingView />;
  if (!detail) return <Screen><InlineNotice tone="error">{error || 'Parcel unavailable.'}</InlineNotice><AppButton title="Retry" onPress={load} /></Screen>;

  const isOffer = Boolean(detail.offer);
  const next = PARCEL_NEXT_STEP[detail.status];
  const atPickup = detail.status === 'arrived_at_pickup';
  const atAddress = atPickup || detail.status === 'arrived_at_dropoff';
  const closed = ['cancelled', 'delivered', 'cancellation_review', 'delivery_failed'].includes(detail.status);
  const cashHere = detail.paymentMethod === 'pay_driver' && detail.cash?.status === 'outstanding'
    && detail.status === (detail.cashCollectionPoint === 'pickup' ? 'arrived_at_pickup' : 'arrived_at_dropoff');
  const earning = detail.finance?.earningPaise ?? detail.earningPaise ?? detail.pricing?.driverPaise;
  const offerExpired = isOffer && new Date(detail.offer.expiresAt) <= new Date();
  const act = (action, extra) => run(() => deliveryApi.parcelAction(detail, action, extra), PARCEL_ACTION_NOTICE[action] || 'Delivery updated.');
  const payment = detail.paymentMethod === 'online'
    ? (detail.paymentStatus === 'paid' ? 'Paid online · Do not collect cash' : 'Online payment needs checking')
    : ['collected_unreconciled', 'reconciled'].includes(detail.cash?.status) ? 'Cash received · No more cash to collect'
      : `Collect ${formatPaise(detail.feePaise)} at ${detail.cashCollectionPoint === 'pickup' ? 'pickup from the sender' : 'delivery from the recipient'}`;

  return (
    <Screen refreshing={false} onRefresh={load}>
      <View style={styles.titleRow}>
        <Text style={[type.title, styles.flex]}>{shortParcelNumber(detail)}</Text>
        <StatusPill tone={isOffer ? 'warning' : closed ? 'neutral' : 'info'} label={isOffer ? 'New request' : parcelStatus(detail.status)} />
      </View>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <Card>
        {earning != null ? <Text style={styles.big}>You earn {formatPaise(earning)}</Text> : null}
        <Text style={type.small}>Delivery fee {formatPaise(detail.feePaise)}</Text>
        <Text style={type.label}>{payment}</Text>
      </Card>

      {isOffer ? (
        <Card title="Can you take this parcel?">
          <Text style={type.body}>{detail.pickupArea} → {detail.dropoffArea}{detail.weightKg != null ? ` · ${detail.weightKg} kg` : ''}</Text>
          <Text style={type.small}>Accept to see the pickup address and contact. Reply by {formatTime(detail.offer.expiresAt)}.</Text>
          <View style={styles.row}>
            <AppButton title="Decline" variant="danger" style={styles.flex} disabled={busy} onPress={() => run(async () => { await deliveryApi.respondParcelOffer(detail, 'reject'); navigation.goBack(); }, 'Offer declined.')} />
            <AppButton title="Accept parcel" style={styles.flex2} loading={busy} disabled={offerExpired} onPress={() => run(() => deliveryApi.respondParcelOffer(detail, 'accept'), 'Parcel assigned to you.')} />
          </View>
        </Card>
      ) : null}

      {!isOffer && !closed ? (
        <Card title={atAddress ? (atPickup ? 'Confirm parcel pickup' : 'Complete the delivery') : 'Next step'}>
          {next ? (<><Text style={type.body}>{next.help}</Text><AppButton title={next.label} loading={busy} onPress={() => act(next.action)} /></>) : null}
          {cashHere ? (
            <View style={styles.cash}>
              <Text style={type.heading}>Collect {formatPaise(detail.feePaise)} first</Text>
              <Text style={type.small}>Receive the exact delivery fee from {detail.cashCollectionPoint === 'pickup' ? 'the sender' : 'the recipient'}, then record it.</Text>
              <AppButton title={`I received ${formatPaise(detail.feePaise)} cash`} variant="accent" loading={busy} onPress={() => act('collect_cash', { amountPaise: detail.feePaise })} />
            </View>
          ) : null}
          {atAddress ? (
            <>
              <Text style={type.body}>{atPickup ? 'Ask the sender for the 6-digit pickup code from their tracking page.' : 'Ask the recipient for the 6-digit delivery code.'}</Text>
              <AppButton title={atPickup ? 'Send pickup code' : 'Send delivery code'} variant="outline" disabled={busy} onPress={() => act(atPickup ? 'pickup_code' : 'delivery_code')} />
              <AppInput label={atPickup ? 'Sender’s pickup code' : 'Recipient’s delivery code'} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} placeholder="6-digit code" />
              <AppButton title={atPickup ? 'Confirm pickup' : 'Complete delivery'} loading={busy} disabled={code.length !== 6 || cashHere}
                onPress={() => act(atPickup ? 'verify_pickup' : 'verify_delivery', { code })} />
              {cashHere ? <Text style={type.small}>Record the cash payment before confirming.</Text> : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {closed ? (
        <InlineNotice tone={detail.status === 'delivered' ? 'success' : 'warning'}>
          {detail.status === 'delivered' ? 'The parcel has been delivered. Thank you!' : detail.status === 'cancelled' ? 'This booking is closed. You do not need to continue.' : 'This delivery is paused while the team reviews it. Keep any collected parcel safe and wait for instructions.'}
        </InlineNotice>
      ) : null}

      {detail.details?.pickup ? (
        <>
          <Card title="Pickup note from the sender">
            <Text style={type.body}>{detail.details.instructions || 'No pickup note was added.'}</Text>
            {detail.details.category ? <Text style={type.small}>Parcel: {String(detail.details.category).replace(/_/g, ' ')}</Text> : null}
            {detail.details.description ? <Text style={type.small}>Contents: {detail.details.description}</Text> : null}
            {detail.details.weightKg != null ? <Text style={type.small}>Weight: {detail.details.weightKg} kg</Text> : null}
          </Card>
          <Card title="Collect from">
            <Text style={type.heading}>{detail.details.pickup.name || 'Sender'}</Text>
            <Text style={type.body}>{detail.details.pickup.address}</Text>
            <NavigateButtons point={detail.details.pickup} address={detail.details.pickup.address} phone={detail.details.pickup.phone || null} callLabel="Call sender" />
          </Card>
          <Card title="Deliver to">
            <Text style={type.heading}>{detail.details.dropoff?.name || 'Recipient'}</Text>
            <Text style={type.body}>{detail.details.dropoff?.address}</Text>
            <NavigateButtons point={detail.details.dropoff} address={detail.details.dropoff?.address} phone={detail.details.dropoff?.phone || null} callLabel="Call recipient" />
          </Card>
        </>
      ) : null}

      {!isOffer && !closed ? (
        <Card title="Need help with this delivery?">
          <Text style={type.small}>Tell the team what is wrong. This pauses the delivery until they review it.</Text>
          {PARCEL_PROBLEMS.map(([value, title]) => (
            <Pressable key={value} onPress={() => setProblem(value)} accessibilityRole="radio" accessibilityState={{ selected: problem === value }} style={[styles.option, problem === value && styles.optionOn]}>
              <Text style={type.body}>{problem === value ? '● ' : '○ '}{title}</Text>
            </Pressable>
          ))}
          <AppButton title="Ask support for help" variant="outline" disabled={busy} onPress={() => act('exception', { reason: problem })} />
        </Card>
      ) : null}
      {detail.reference ? <Text style={type.small}>Booking {detail.reference}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  row: { flexDirection: 'row', gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  big: { fontSize: 22, fontWeight: '800', color: colors.deepBlue },
  cash: { backgroundColor: colors.orangeLight, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  optionOn: { backgroundColor: colors.aquaLight },
});
