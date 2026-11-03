import React, { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import KeyValueRow from '../../components/KeyValueRow';
import StatusPill from '../../components/StatusPill';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useDuty } from '../../context/DutyContext';
import { useToast } from '../../components/Toast';
import * as deliveryApi from '../../services/delivery.api';
import { getCurrentPoint } from '../../services/geo';
import { capitalize, formatDate, maskAccount, partnerCode, ratingSummary } from '../../utils/format';
import { isValidPincodeList, parsePincodes } from '../../utils/riderDocuments';
import { partnerStatusLabel } from '../../utils/status';
import { colors, spacing, type } from '../../theme';

/**
 * Profile (web DeliveryProfilePage). Read from GET /api/delivery/me.
 * Editable after approval, as on the server: delivery pincodes (PUT /service-area, versioned)
 * and base location (PUT /location). Vehicle, licence, Aadhaar and bank details are locked after
 * approval (assertEditable) — changes go through support. KYC documents are never displayed;
 * the app only says whether each one is on file. Bank numbers show the last four digits only.
 */
export default function ProfileScreen({ navigation }) {
  const { profile, refreshProfile, signOut } = useAuth();
  const duty = useDuty();
  const toast = useToast();
  const p = profile || {};
  const rating = ratingSummary(p);
  const [refreshing, setRefreshing] = useState(false);
  const [sos, setSos] = useState('112');
  const [editingZones, setEditingZones] = useState(false);
  const [zones, setZones] = useState('');
  const [zoneVersion, setZoneVersion] = useState(null);
  const [zoneError, setZoneError] = useState('');
  const [zoneConflict, setZoneConflict] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    deliveryApi.getHelpline().then((h) => { if (h?.sosEmergencyNumber) setSos(String(h.sosEmergencyNumber)); }).catch(() => {});
  }, []);

  const onRefresh = async () => { setRefreshing(true); await refreshProfile(); setRefreshing(false); };

  const openZones = () => { setZones((p.zones || []).join(', ')); setZoneVersion(p.__v); setZoneError(''); setZoneConflict(false); setEditingZones(true); };
  const saveZones = async () => {
    const entries = parsePincodes(zones);
    if (!isValidPincodeList(entries)) { setZoneError('Enter 1 to 50 valid 6-digit pincodes, separated by commas.'); return; }
    setBusy('zones'); setZoneError('');
    try {
      await deliveryApi.saveServiceArea(entries, zoneVersion);
      await refreshProfile();
      setEditingZones(false);
      toast.show('Service area saved. These pincodes apply to new offers.', 'success');
    } catch (e) {
      setZoneError(e.message || 'Could not save your service area.');
      setZoneConflict(e.status === 409);
    } finally { setBusy(''); }
  };

  const updateBase = async () => {
    setBusy('base');
    const fix = await getCurrentPoint({ ask: true });
    if (!fix.ok) { setBusy(''); toast.show(fix.message, 'error'); return; }
    let a = {};
    try { a = (await deliveryApi.reverseGeocode(fix.point.lat, fix.point.lng, fix.point.accuracy)) || {}; } catch { /* coordinates alone are accepted */ }
    try {
      await deliveryApi.saveBaseLocation({ lat: fix.point.lat, lng: fix.point.lng, accuracy: fix.point.accuracy, source: 'gps',
        address: a.address || `${fix.point.lat.toFixed(5)}, ${fix.point.lng.toFixed(5)}`, city: a.city || '', state: a.state || '', pincode: a.pincode || '' });
      await refreshProfile();
      toast.show('Base location updated.', 'success');
    } catch (e) { toast.show(e.message || 'Could not save location.', 'error'); }
    finally { setBusy(''); }
  };

  const deleteAccount = () => Alert.alert('Delete delivery account?', 'Active deliveries, returns or pending earnings block deletion. This cannot be undone.', [
    { text: 'Keep account', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      setBusy('delete');
      try { const body = await deliveryApi.deleteAccount(); toast.show(body?.message || 'Delivery account deleted.'); await signOut(); }
      catch (e) { toast.show(e.message || 'Could not delete delivery account.', 'error'); setBusy(''); }
    } },
  ]);

  const base = p.baseLocation || {};
  const onFile = (v) => (v ? 'On file' : 'Missing');

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={onRefresh}>
      <Card>
        <Text style={type.title}>{p.name || 'Rider'}</Text>
        <Text style={type.small}>Partner ID {partnerCode(p._id)} · +91 {p.phone || '—'}</Text>
        <View style={styles.row}>
          <StatusPill tone={p.status === 'approved' ? 'success' : 'warning'} label={partnerStatusLabel(p.status)} />
          <StatusPill tone={duty.online ? 'success' : 'neutral'} label={duty.online ? 'Online' : 'Offline'} />
        </View>
        <KeyValueRow label="Customer rating" value={`${rating.value} (${rating.count})`} />
        <KeyValueRow label="Total deliveries" value={String(p.totalDeliveries ?? 0)} />
      </Card>

      {duty.licenseExpired ? <InlineNotice tone="error">Your driving licence expired on {formatDate(p.drivingLicense?.expiryDate)}. Renew it and contact support to update it before going online.</InlineNotice> : null}

      <Card title="Vehicle and documents">
        <KeyValueRow label="Vehicle" value={capitalize(p.vehicleType) || '—'} />
        <KeyValueRow label="Vehicle number" value={p.vehicleNo || '—'} />
        {p.vehicleType !== 'bicycle' ? <KeyValueRow label="Driving licence" value={p.drivingLicense?.no ? `${p.drivingLicense.no} · valid until ${formatDate(p.drivingLicense.expiryDate)}` : '—'} /> : null}
        {p.vehicleType !== 'bicycle' ? <KeyValueRow label="Licence photo" value={onFile(p.drivingLicense?.url)} /> : null}
        <KeyValueRow label="Aadhaar" value={p.aadhaar?.number || '—'} />
        <KeyValueRow label="Aadhaar photos" value={onFile(p.aadhaar?.frontUrl && p.aadhaar?.backUrl)} />
        <Text style={type.small}>Documents are locked after approval. To change them, raise a support ticket.</Text>
      </Card>

      <Card title="Delivery pincodes">
        <Text style={type.body}>{p.zones?.length ? p.zones.join(', ') : 'None set'}</Text>
        {!editingZones ? <AppButton small variant="outline" title="Edit service area" onPress={openZones} /> : (
          <>
            <AppInput label="Pincodes" value={zones} onChangeText={setZones} multiline keyboardType="numbers-and-punctuation"
              hint="Every pincode you can serve, separated by commas. Keep existing ones if you still cover them." error={zoneError} />
            <View style={styles.row}>
              <AppButton title="Save" style={styles.flex} loading={busy === 'zones'} disabled={zoneConflict} onPress={saveZones} />
              <AppButton title="Cancel" variant="outline" style={styles.flex} onPress={() => setEditingZones(false)} />
            </View>
            {zoneConflict ? <AppButton small variant="ghost" title="Your profile changed — reload and edit again" onPress={async () => { await refreshProfile(); setEditingZones(false); }} /> : null}
          </>
        )}
      </Card>

      <Card title="Base location">
        {base.address || base.city ? (
          <>
            <Text style={type.body}>{[base.address, base.landmark].filter(Boolean).join(', ')}</Text>
            <Text style={type.small}>{[base.city, base.state, base.pincode].filter(Boolean).join(', ')}{base.source === 'gps' ? ' · from GPS' : ''}</Text>
          </>
        ) : <Text style={type.small}>No base location set yet.</Text>}
        <AppButton small variant="outline" title="Use my current location" loading={busy === 'base'} onPress={updateBase} />
      </Card>

      <Card title="Payout account">
        <KeyValueRow label="Bank" value={p.bankDetails?.bankName || 'Not added'} />
        <KeyValueRow label="Account" value={maskAccount(p.bankDetails?.accountNo)} />
        <KeyValueRow label="IFSC" value={p.bankDetails?.ifsc || 'Not added'} />
        {p.bankDetails?.upiId ? <KeyValueRow label="UPI" value="Linked" /> : null}
        <KeyValueRow label="Payout cycle" value={p.finance?.payoutSchedule === 'weekly' ? 'Weekly, automatic' : p.finance?.payoutSchedule ? 'When you request it' : '—'} />
        <AppButton small variant="outline" title="Request a bank change" onPress={() => navigation.navigate('Support', { subject: 'Bank account change request' })} />
      </Card>

      <Card title="Help">
        <AppButton title={`🚨 Emergency SOS (${sos})`} variant="danger" onPress={() => Linking.openURL(`tel:${sos.replace(/[^\d+]/g, '')}`).catch(() => {})} />
        <AppButton title="Support tickets" variant="outline" onPress={() => navigation.navigate('Support')} />
        <AppButton title="Notifications" variant="outline" onPress={() => navigation.navigate('Notifications')} />
      </Card>

      <AppButton title="Sign out" variant="outline" disabled={Boolean(duty.activeOrder)} onPress={() => Alert.alert('Sign out?', duty.online ? 'You will be set offline first, so no new orders are sent to you.' : 'You can sign in again with your phone number.', [
        { text: 'Cancel', style: 'cancel' },
        // Going offline first stops the server offering orders to a signed-out phone. Best effort: sign-out never depends on it.
        { text: 'Sign out', onPress: async () => { if (duty.online) await duty.setDuty(false); await signOut(); } },
      ])} />
      {duty.activeOrder ? <Text style={type.small}>Finish or cancel your active delivery before signing out.</Text> : null}
      <AppButton title="Delete delivery account" variant="ghost" loading={busy === 'delete'} onPress={deleteAccount} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  muted: { color: colors.textSecondary },
});
