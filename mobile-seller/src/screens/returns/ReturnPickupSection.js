import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { getReturnPickupOptions, selectReturnPickup } from '../../services/returns.api';
import { colors, radius, spacing, type } from '../../theme';

// Native port of ReturnPickupPanel.jsx (method choice). Shown while a return is APPROVED / AWAITING_RETURN
// and no pickup method has been chosen yet; options and eligibility come from GET /pickup-options.
export default function ReturnPickupSection({ ret, onChanged }) {
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState('');
  const [riderId, setRiderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReturnPickupOptions(ret._id);
      if (!alive.current) return;
      setOptions(data);
      setRiderId((prev) => (data?.manual?.riders?.some((r) => r.id === prev) ? prev : ''));
    } catch (e) { if (alive.current) { setOptions(null); setMessage(e.message || 'Could not load pickup options'); } }
    finally { if (alive.current) setLoading(false); }
  }, [ret._id]);
  useEffect(() => { load(); }, [load, ret.status, ret.pickupMethod, ret.pickup?.status]);

  const confirm = () => {
    if (!method || !options?.stateReady || (method === 'MANUAL' && (!riderId || !options.manual?.available)) || (method === 'SHIPROCKET' && !options.shiprocket?.available)) return;
    const text = method === 'MANUAL' ? 'Send this pickup request to the selected delivery partner?' : 'Book a Shiprocket reverse pickup for this return?';
    Alert.alert('Confirm pickup', text, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: send }]);
  };
  const send = async () => {
    setBusy(true); setMessage('');
    try {
      const body = await selectReturnPickup(ret._id, method, riderId);
      setMessage(body?.message || 'Pickup updated');
      setMethod(''); setRiderId('');
    } catch (e) {
      // A timeout may follow a successful booking, so the state must be re-read before trying again.
      setMessage(e.code === 'NETWORK' || e.code === 'TIMEOUT' ? 'Could not confirm pickup; refresh before retrying.' : e.message || 'Could not update pickup');
      setOptions(null);
    } finally {
      if (alive.current) { setBusy(false); await Promise.all([onChanged(), load()]); }
    }
  };

  const route = options?.pickup ? [options.pickup.line1, options.pickup.line2, options.pickup.city, options.pickup.pincode].filter(Boolean).join(', ') : null;
  const drop = options?.drop ? [options.drop.name, options.drop.address, options.drop.city, options.drop.pincode].filter(Boolean).join(', ') : null;

  return (
    <Card title="Choose how to collect this return" right={<AppButton small variant="ghost" title="Refresh" disabled={loading || busy} onPress={load} />}>
      <Text style={type.small}>The item travels from the customer back to your store.</Text>
      <Text style={type.small}>{loading ? 'Checking pickup availability…' : options?.stateReason}</Text>
      {message ? <InlineNotice tone="info">{message}</InlineNotice> : null}
      {options?.stateReady ? (
        <>
          <View style={styles.choices}>
            <Choice active={method === 'MANUAL'} disabled={busy} title="Local rider" hint="Same city delivery partner" onPress={() => setMethod('MANUAL')} />
            <Choice active={method === 'SHIPROCKET'} disabled={busy || !options.shiprocket?.available} title="Shiprocket" hint="Reverse courier pickup" onPress={() => setMethod('SHIPROCKET')} />
          </View>
          {method === 'MANUAL' ? (
            <View style={styles.gap}>
              <Text style={type.label}>Available delivery partners ({options.manual?.eligibleRiderCount || 0})</Text>
              {options.manual?.riders?.length ? options.manual.riders.map((rider) => (
                <Pressable key={rider.id} accessibilityRole="radio" accessibilityState={{ checked: riderId === rider.id }} disabled={busy}
                  onPress={() => setRiderId(rider.id)} style={[styles.rider, riderId === rider.id && styles.active]}>
                  <Text style={type.label}>{rider.name}</Text>
                  {rider.contact ? <Text style={type.small}>{rider.contact}</Text> : null}
                  <Text style={type.small}>{rider.availability}{Number.isFinite(rider.distanceKm) ? ` · ${rider.distanceKm.toFixed(1)} km from customer` : ''}</Text>
                </Pressable>
              )) : <InlineNotice tone="warning">{options.manual?.reason || 'No delivery partners available. Refresh availability or choose Shiprocket.'}</InlineNotice>}
              <Text style={type.small}>Only the selected partner receives this request. They must accept before pickup is assigned.</Text>
            </View>
          ) : null}
          {method === 'SHIPROCKET' ? <Text style={type.small}>Confirm to book the courier. Refresh tracking if the booking needs confirmation before trying again.</Text> : null}
          {method ? (
            <AppButton title={method === 'MANUAL' ? 'Request selected delivery partner' : 'Confirm Shiprocket pickup'} loading={busy}
              disabled={loading || (method === 'MANUAL' && (!riderId || !options.manual?.available))} onPress={confirm} />
          ) : null}
        </>
      ) : null}
      {route ? <Text style={type.small}>Pickup from customer: {route}</Text> : null}
      {drop ? <Text style={type.small}>Return to your store: {drop}</Text> : null}
    </Card>
  );
}

function Choice({ active, disabled, title, hint, onPress }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active, disabled }} disabled={disabled} onPress={onPress}
      style={[styles.choice, active && styles.active, disabled && styles.disabled]}>
      <Text style={[type.label, active && { color: colors.primaryDark }]}>{title}</Text>
      <Text style={type.small}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: spacing.sm },
  choice: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  active: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  disabled: { opacity: 0.45 },
  gap: { gap: spacing.sm },
  rider: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
});
