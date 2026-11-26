import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { createShiprocketShipment, dispatchExternalCourier, getFulfillmentOptions, selectManualFulfillment } from '../../services/fulfillment.api';
import { addressText, orderMoney } from '../../utils/format';
import ShiprocketFeeCard from './ShiprocketFeeCard';
import { colors, radius, spacing, type } from '../../theme';

// Native port of the "Choose delivery method" panel in OrdersTab.jsx, opened by a server `setup` action.
// Eligibility, riders and the courier quote all come from GET /fulfillment-options; the server re-checks on submit.
const DIMENSIONS = ['length', 'breadth', 'height'];

export default function FulfillmentScreen({ route, navigation }) {
  const { orderId, orderNo, channel } = route.params;
  const loader = useCallback(() => getFulfillmentOptions(orderId), [orderId]);
  const { data: options, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [choice, setChoice] = useState(null);
  const [riderId, setRiderId] = useState(null);
  const [size, setSize] = useState({ length: '', breadth: '', height: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [courier, setCourier] = useState({ courierName: '', awb: '', trackingUrl: '', dispatchDate: new Date().toISOString().slice(0, 10) });

  React.useEffect(() => { navigation.setOptions({ title: orderNo ? `Delivery · ${orderNo}` : 'Choose delivery method' }); }, [navigation, orderNo]);
  // Start from the package size saved on the listing (single-item orders only); the seller can still change it.
  const suggested = options?.shiprocket?.suggestedPackage;
  React.useEffect(() => {
    if (!suggested) return;
    setSize((s) => (DIMENSIONS.some((k) => s[k]) ? s : Object.fromEntries(DIMENSIONS.map((k) => [k, String(suggested[k])]))));
  }, [suggested?.length, suggested?.breadth, suggested?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !options) return <LoadingView message="Checking delivery eligibility…" />;
  if (!options) return <ErrorView message={error || 'Could not evaluate fulfillment options'} onRetry={reload} />;

  const manual = options.manual || {};
  const ship = options.shiprocket || {};
  const onlineRiders = (manual.riders || []).filter((r) => r.online === true);
  const isQuick = channel === 'grocery';
  // Self Delivery: rider or the seller's own courier, never Bulkimart's Shiprocket.
  const selfDelivery = options.deliveryMethod === 'self_delivery';
  const external = options.external || {};

  const finish = (body) => {
    ToastAndroid.show(body?.message || 'Delivery method saved', ToastAndroid.LONG);
    navigation.goBack(); // The order detail re-reads the order when it regains focus.
  };

  const confirmManual = async () => {
    setBusy(true); setMessage('');
    try { finish(await selectManualFulfillment(orderId, riderId)); }
    catch (e) { setMessage(e.message || 'Could not select manual delivery'); }
    finally { setBusy(false); }
  };

  const confirmExternal = async () => {
    setMessage('');
    if (courier.courierName.trim().length < 2) return setMessage('Enter the courier company name.');
    if (courier.awb.trim().length < 3) return setMessage('Enter the tracking ID / AWB number.');
    if (!/^https:\/\//i.test(courier.trackingUrl.trim())) return setMessage('Enter the tracking link, starting with https://');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(courier.dispatchDate)) return setMessage('Enter the dispatch date as YYYY-MM-DD.');
    setBusy(true);
    try { finish(await dispatchExternalCourier(orderId, { ...courier, courierName: courier.courierName.trim(), awb: courier.awb.trim(), trackingUrl: courier.trackingUrl.trim() })); }
    catch (e) { setMessage(e.message || 'Could not save the courier hand-off'); }
    finally { setBusy(false); }
  };

  const confirmShiprocket = () => {
    setMessage('');
    if (DIMENSIONS.some((k) => !Number.isFinite(Number(size[k])) || Number(size[k]) <= 0.5 || Number(size[k]) > 500)) {
      setMessage('Enter dimensions greater than 0.5 cm and at most 500 cm'); return;
    }
    Alert.alert('Create Shiprocket shipment', `Create a Shiprocket shipment with estimated courier freight ${orderMoney(ship.quote.courierCharge)}? The customer's total stays unchanged.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create shipment', onPress: async () => {
        setBusy(true);
        try {
          const pkg = Object.fromEntries(DIMENSIONS.map((k) => [k, Number(size[k])]));
          finish(await createShiprocketShipment(orderId, pkg, ship.quote.courierCharge));
        } catch (e) { setMessage(e.message || 'Shipment creation failed'); refresh(); }
        finally { setBusy(false); }
      } },
    ]);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text style={type.small}>Arrange fulfilment for this order. Eligibility is checked again by the server when you confirm.</Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {[['manual', 'Manual delivery', 'Bulkimart delivery partners'], selfDelivery ? ['external', 'Your own courier', 'You book it; enter tracking'] : ['shiprocket', 'Shiprocket', 'Courier shipment']].map(([value, title, hint]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: choice === value }} disabled={busy}
            onPress={() => { setChoice(value); setMessage(''); }} style={[styles.choice, choice === value && styles.choiceActive]}>
            <Text style={[type.label, choice === value && styles.activeText]}>{title}</Text>
            <Text style={type.small}>{hint}</Text>
          </Pressable>
        ))}
      </View>

      {choice === 'manual' ? (
        <Card title="Active delivery partners" right={<AppButton small variant="ghost" title="Refresh" onPress={refresh} disabled={busy} />}>
          <Text style={type.small}>{manual.eligibleRiderCount || 0} on-duty eligible riders for this order</Text>
          {onlineRiders.map((rider, index) => {
            const selected = rider.id && String(riderId) === String(rider.id);
            return (
              <Pressable key={rider.id || index} accessibilityRole="radio" accessibilityState={{ checked: !!selected }} disabled={busy || !rider.id}
                onPress={() => setRiderId(selected ? null : rider.id)} style={[styles.rider, selected && styles.choiceActive]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{rider.name?.charAt(0)?.toUpperCase() || 'R'}</Text></View>
                <View style={styles.flex}>
                  <Text style={type.label}>{rider.name}</Text>
                  {rider.contact ? <Text style={type.small}>{rider.contact}</Text> : null}
                  {rider.availability ? <Text style={type.small}>{rider.availability}</Text> : null}
                </View>
                <Text style={styles.riderState}>{selected ? '✓ Selected' : 'Active'}</Text>
              </Pressable>
            );
          })}
          {!onlineRiders.length ? <InlineNotice tone="warning">No active delivery partners right now. Refresh to check for on-duty riders with capacity and coverage for this order.</InlineNotice> : null}
          <Text style={type.small}>Select a delivery partner to send this order to them, or leave it open to all nearby riders. The order is sent as soon as you confirm, and the rider accepts it in their delivery app.</Text>
          {!manual.available && manual.reason ? <InlineNotice tone="warning">{manual.reason}</InlineNotice> : null}
          <AppButton title={riderId ? 'Confirm & send to rider' : 'Confirm & send to nearby riders'} loading={busy} disabled={!manual.available} onPress={confirmManual} />
          <AppButton small variant="ghost" title="Check store pickup location" onPress={() => navigation.navigate('PickupSync')} />
        </Card>
      ) : null}

      {choice === 'external' && selfDelivery ? (
        <Card title="Your own courier">
          <Text style={type.small}>You book and pay the courier. Enter its tracking details so the customer can follow the parcel, then update the status as it is delivered.</Text>
          <AppInput label="Courier company" value={courier.courierName} maxLength={60} editable={!busy} onChangeText={(t) => setCourier((c) => ({ ...c, courierName: t }))} />
          <AppInput label="Tracking ID / AWB number" value={courier.awb} maxLength={40} autoCapitalize="characters" editable={!busy} onChangeText={(t) => setCourier((c) => ({ ...c, awb: t }))} />
          <AppInput label="Tracking link (https://…)" value={courier.trackingUrl} maxLength={500} autoCapitalize="none" keyboardType="url" editable={!busy} onChangeText={(t) => setCourier((c) => ({ ...c, trackingUrl: t }))} />
          <AppInput label="Dispatch date (YYYY-MM-DD)" value={courier.dispatchDate} maxLength={10} editable={!busy} onChangeText={(t) => setCourier((c) => ({ ...c, dispatchDate: t }))} />
          {!external.available && external.reason ? <InlineNotice tone="warning">{external.reason}</InlineNotice> : null}
          <AppButton title="Confirm hand-off to courier" loading={busy} disabled={!external.available} onPress={confirmExternal} />
        </Card>
      ) : null}

      {choice === 'shiprocket' && !selfDelivery ? (
        <Card title="Shiprocket shipment">
          <Text style={type.small}>Pickup from: {addressText(ship.verifiedPickup || options.pickup)}</Text>
          {!ship.pickupLinked ? <AppButton small variant="outline" title="Check or retry pickup registration" onPress={() => navigation.navigate('PickupSync')} /> : null}
          <Text style={type.small}>{ship.reason || 'Serviceability is checked before any shipment is created.'}</Text>
          <Text style={type.small}>Weight from order item snapshots: {ship.packageWeightKg || 'Unavailable'} kg</Text>
          {ship.activation?.blockers?.length ? <InlineNotice tone="warning">Live Quick third-party shipping is disabled: {ship.activation.blockers.join('; ')}.</InlineNotice> : null}
          {isQuick ? <ShiprocketFeeCard orderId={orderId} provider={ship} onPaid={refresh} /> : null}
          {!isQuick && ship.quote ? (
            <InlineNotice tone="info">Estimated courier freight: {orderMoney(ship.quote.courierCharge)}. Provider estimate only. The customer's checkout delivery charge stays unchanged.</InlineNotice>
          ) : null}
          <View style={styles.dims}>
            {DIMENSIONS.map((k) => (
              <AppInput key={k} style={styles.flex} label={`${k[0].toUpperCase()}${k.slice(1)} (cm)`} keyboardType="decimal-pad" value={size[k]} editable={!busy}
                onChangeText={(t) => setSize((s) => ({ ...s, [k]: t.replace(/[^0-9.]/g, '') }))} />
            ))}
          </View>
          {ship.suggestedPackage ? <Text style={type.small}>Filled in from the package size saved on this product. Measure the packed parcel and correct it if needed.</Text> : null}
          <AppButton title="Create Shiprocket shipment" loading={busy}
            disabled={!ship.available || !ship.quote || (isQuick && ship.feeCollection?.status !== 'paid')}
            onPress={confirmShiprocket} />
        </Card>
      ) : null}

      {message ? <InlineNotice tone="error">{message}</InlineNotice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: spacing.md },
  choice: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.white, gap: 2 },
  choiceActive: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  activeText: { color: colors.primaryDark },
  rider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontWeight: '800' },
  flex: { flex: 1 },
  riderState: { fontSize: 12, fontWeight: '700', color: colors.success },
  dims: { flexDirection: 'row', gap: spacing.sm },
});
