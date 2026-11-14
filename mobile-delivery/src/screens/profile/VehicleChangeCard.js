import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import DocumentPhotoField from '../../components/DocumentPhotoField';
import { InlineNotice } from '../../components/StateViews';
import * as deliveryApi from '../../services/delivery.api';
import { VEHICLE_TYPES, drivingLicenceError, normalizeRiderDocument, vehicleNumberError } from '../../utils/riderDocuments';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Change vehicle (approved riders) — PUT /api/delivery/vehicle.
 * Parcel bookings are offered by vehicle (a 3 Wheeler booking goes to auto riders), so this
 * decides which parcel requests the rider receives. Same rules as registration step 1; the
 * server refuses while a delivery is in progress and asks admins to re-check the documents.
 */
export default function VehicleChangeCard({ profile: p, onSaved, toast }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [v, setV] = useState({ vehicleType: '', vehicleNo: '', licenseNo: '', licenseExpiry: '', licenseFile: null });
  if (p?.status !== 'approved') return null;
  const needsLicence = v.vehicleType !== 'bicycle';
  const start = () => {
    setV({ vehicleType: p.vehicleType || 'bike', vehicleNo: p.vehicleNo || '', licenseNo: p.drivingLicense?.no || '', licenseExpiry: p.drivingLicense?.expiryDate ? String(p.drivingLicense.expiryDate).slice(0, 10) : '', licenseFile: null });
    setError(''); setOpen(true);
  };
  const save = async () => {
    const problem = vehicleNumberError(v.vehicleNo, v.vehicleType) || (needsLicence && drivingLicenceError(v.licenseNo)) || (needsLicence && !v.licenseFile && !p.drivingLicense?.url ? 'Add a photo of your driving licence.' : '');
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await deliveryApi.changeVehicle({ vehicleType: v.vehicleType, vehicleNo: normalizeRiderDocument(v.vehicleNo), licenseNo: normalizeRiderDocument(v.licenseNo), licenseExpiry: v.licenseExpiry, licenseFile: v.licenseFile });
      await onSaved?.();
      setOpen(false);
      toast?.show('Vehicle updated. You will now get parcel requests for this vehicle.', 'success');
    } catch (e) { setError(e.message || 'Your vehicle could not be updated.'); }
    finally { setBusy(false); }
  };
  if (!open) return <AppButton small variant="outline" title="Change vehicle" onPress={start} />;
  return <Card title="Change your vehicle">
    <Text style={type.small}>Parcel bookings are sent to riders by vehicle. You can change it when you are not carrying a delivery.</Text>
    <Text style={[type.label, { marginTop: spacing.md }]}>Vehicle type</Text>
    <View style={styles.chips}>
      {VEHICLE_TYPES.map((t) => <Pressable key={t.key} onPress={() => setV((s) => ({ ...s, vehicleType: t.key }))} accessibilityRole="radio" accessibilityState={{ selected: v.vehicleType === t.key }} style={[styles.chip, v.vehicleType === t.key && styles.chipActive]}>
        <Text style={[styles.chipText, v.vehicleType === t.key && styles.chipTextActive]}>{t.label}</Text>
      </Pressable>)}
    </View>
    <AppInput label={v.vehicleType === 'bicycle' ? 'Bicycle identifier' : 'Vehicle number'} required value={v.vehicleNo} onChangeText={(t) => setV((s) => ({ ...s, vehicleNo: t }))} autoCapitalize="characters" placeholder="MH31AB1234" />
    {needsLicence ? <>
      <AppInput label="Driving licence number" required value={v.licenseNo} onChangeText={(t) => setV((s) => ({ ...s, licenseNo: t }))} autoCapitalize="characters" placeholder="MH3120230001234" />
      <AppInput label="Licence valid until (YYYY-MM-DD)" value={v.licenseExpiry} onChangeText={(t) => setV((s) => ({ ...s, licenseExpiry: t.replace(/[^\d-]/g, '').slice(0, 10) }))} keyboardType="numbers-and-punctuation" placeholder="2030-12-31" />
      <DocumentPhotoField label="Driving licence photo" required value={v.licenseFile} alreadyOnFile={Boolean(p.drivingLicense?.url)} onChange={(f) => setV((s) => ({ ...s, licenseFile: f }))} />
    </> : null}
    {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    <View style={styles.row}>
      <AppButton title="Save vehicle" style={styles.flex} loading={busy} onPress={save} />
      <AppButton title="Cancel" variant="outline" style={styles.flex} disabled={busy} onPress={() => setOpen(false)} />
    </View>
    <Text style={type.small}>Our team is told about the change and may re-check your documents.</Text>
  </Card>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  chipActive: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextActive: { color: colors.deepBlue },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
});
