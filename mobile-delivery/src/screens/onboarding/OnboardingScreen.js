import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import DocumentPhotoField from '../../components/DocumentPhotoField';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import * as deliveryApi from '../../services/delivery.api';
import { getCurrentPoint } from '../../services/geo';
import { VEHICLE_TYPES, drivingLicenceError, normalizeRiderDocument, parsePincodes, isValidPincodeList, vehicleNumberError } from '../../utils/riderDocuments';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Rider registration — the same three server steps as the web DeliveryOnboardingPage, then submit.
 *   1 PUT /api/delivery/step/1  vehicle + driving licence
 *   2 PUT /api/delivery/step/2  Aadhaar (both sides are always required by the server)
 *   3 PUT /api/delivery/step/3  service pincodes, base location, payout bank + passbook
 *   4 POST /api/delivery/submit -> 'pending' (admin review)
 * Field checks mirror the server; the server re-validates everything and its message is shown as-is.
 * Uploaded documents are never displayed back; only "already uploaded" is shown.
 */
const STEPS = ['Vehicle', 'Aadhaar', 'Area & bank', 'Submit'];
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI = /^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function OnboardingScreen({ navigation }) {
  const { profile, mergeProfile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const p = profile || {};
  const [step, setStep] = useState(Math.max(1, Math.min(Number(p.onboardingStep) || 1, 4)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [vehicle, setVehicle] = useState({
    vehicleType: p.vehicleType || '', vehicleNo: p.vehicleNo || '', licenseNo: p.drivingLicense?.no || '',
    licenseExpiry: p.drivingLicense?.expiryDate ? String(p.drivingLicense.expiryDate).slice(0, 10) : '', licenseFile: null,
  });
  const [aadhaar, setAadhaar] = useState({ number: '', frontFile: null, backFile: null });
  const [area, setArea] = useState({
    zones: Array.isArray(p.zones) ? p.zones.join(', ') : '', radius: p.deliveryRadiusKm ? String(p.deliveryRadiusKm) : '',
    location: p.baseLocation || {},
    holderName: p.bankDetails?.holderName || '', bankName: p.bankDetails?.bankName || '', accountNo: p.bankDetails?.accountNo || '',
    ifsc: p.bankDetails?.ifsc || '', upiId: p.bankDetails?.upiId || '', passbookFile: null,
  });
  const [locating, setLocating] = useState(false);

  const needsLicence = vehicle.vehicleType && vehicle.vehicleType !== 'bicycle';
  const hasLocation = Boolean((area.location?.lat !== undefined && area.location?.lng !== undefined) || /^\d{6}$/.test(area.location?.pincode || ''));

  const step1Error = useMemo(() => {
    if (!vehicle.vehicleType) return 'Select your vehicle type.';
    const v = vehicleNumberError(vehicle.vehicleNo, vehicle.vehicleType); if (v) return v;
    if (needsLicence) {
      const l = drivingLicenceError(vehicle.licenseNo); if (l) return l;
      if (vehicle.licenseExpiry && !DATE.test(vehicle.licenseExpiry)) return 'Enter the licence expiry as YYYY-MM-DD.';
      if (!vehicle.licenseFile && !p.drivingLicense?.url) return 'Add a photo of your driving licence.';
    }
    return '';
  }, [vehicle, needsLicence, p.drivingLicense?.url]);

  const step2Error = useMemo(() => {
    if (!/^\d{12}$/.test(aadhaar.number.replace(/\s/g, ''))) return 'An Aadhaar number is 12 digits.';
    if (!aadhaar.frontFile || !aadhaar.backFile) return 'Add photos of both sides of your Aadhaar.';
    return '';
  }, [aadhaar]);

  const step3Error = useMemo(() => {
    if (!isValidPincodeList(parsePincodes(area.zones))) return 'Enter 1 to 50 valid 6-digit pincodes, separated by commas.';
    if (area.radius && !(Number(area.radius) > 0)) return 'Delivery radius must be a positive number of km.';
    if (!hasLocation) return 'Share your current location, or type your address with a 6-digit pincode.';
    if (area.holderName.trim().length < 2) return 'Enter the account holder name.';
    if (area.bankName.trim().length < 2) return 'Enter the bank name.';
    if (!/^\d{6,18}$/.test(area.accountNo)) return 'Bank account number must contain 6 to 18 digits.';
    if (!IFSC.test(area.ifsc.trim().toUpperCase())) return 'Enter a valid 11-character IFSC code.';
    if (area.upiId && !UPI.test(area.upiId.trim())) return 'Enter a valid UPI ID, or leave it empty.';
    if (!area.passbookFile && !p.bankDetails?.passbookUrl) return 'Add a photo of your passbook page or a cancelled cheque.';
    return '';
  }, [area, hasLocation, p.bankDetails?.passbookUrl]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Could not save this step.'); } finally { setBusy(false); }
  };

  const saveStep = (n, request) => run(async () => {
    const body = await request();
    if (body?.data) mergeProfile(body.data);
    setStep(Math.min(Math.max(Number(body?.data?.onboardingStep) || n + 1, n + 1), 4));
    toast.show(body?.message || 'Saved', 'success');
  });

  const useGps = async () => {
    setLocating(true); setError('');
    const fix = await getCurrentPoint({ ask: true });
    if (!fix.ok) { setLocating(false); setError(fix.message); return; }
    let addr = {};
    try { addr = (await deliveryApi.reverseGeocode(fix.point.lat, fix.point.lng, fix.point.accuracy)) || {}; } catch { /* lat/lng alone is accepted */ }
    setArea((a) => ({ ...a, location: { lat: fix.point.lat, lng: fix.point.lng, accuracy: fix.point.accuracy, source: 'gps',
      address: addr.address || `${fix.point.lat.toFixed(5)}, ${fix.point.lng.toFixed(5)}`, city: addr.city || '', state: addr.state || '', pincode: addr.pincode || '' } }));
    setLocating(false);
  };

  // Typing an address replaces any GPS fix: the coordinates no longer describe what was typed.
  const setLoc = (key, value) => setArea((a) => ({ ...a, location: {
    address: a.location?.address || '', city: a.location?.city || '', state: a.location?.state || '', pincode: a.location?.pincode || '',
    [key]: value, source: 'manual',
  } }));

  const submit = () => run(async () => {
    await deliveryApi.submitApplication();
    toast.show('Application submitted for verification', 'success');
    await refreshProfile();
    if (navigation.canGoBack()) navigation.goBack();
  });

  return (
    <Screen edges={['top', 'bottom']}>
      <Text style={type.title}>Become a delivery partner</Text>
      <View style={styles.steps}>
        {STEPS.map((label, i) => (
          <Pressable key={label} disabled={i + 1 > (Number(p.onboardingStep) || 1) || busy} onPress={() => setStep(i + 1)} style={[styles.step, step === i + 1 && styles.stepActive]}>
            <Text style={[styles.stepText, step === i + 1 && styles.stepTextActive]}>{i + 1}. {label}</Text>
          </Pressable>
        ))}
      </View>

      {step === 1 ? (
        <Card title="Vehicle and driving licence">
          <Text style={type.label}>Vehicle type *</Text>
          <View style={styles.chips}>
            {VEHICLE_TYPES.map((v) => (
              <Pressable key={v.key} onPress={() => setVehicle((s) => ({ ...s, vehicleType: v.key }))} accessibilityRole="radio" accessibilityState={{ selected: vehicle.vehicleType === v.key }}
                style={[styles.chip, vehicle.vehicleType === v.key && styles.chipActive]}>
                <Text style={[styles.chipText, vehicle.vehicleType === v.key && styles.chipTextActive]}>{v.label}</Text>
              </Pressable>
            ))}
          </View>
          <AppInput label={vehicle.vehicleType === 'bicycle' ? 'Bicycle identifier' : 'Vehicle number'} required value={vehicle.vehicleNo}
            onChangeText={(t) => setVehicle((s) => ({ ...s, vehicleNo: t }))} autoCapitalize="characters" placeholder="MH31AB1234" />
          {needsLicence ? (
            <>
              <AppInput label="Driving licence number" required value={vehicle.licenseNo} onChangeText={(t) => setVehicle((s) => ({ ...s, licenseNo: t }))} autoCapitalize="characters" placeholder="MH3120230001234" />
              <AppInput label="Licence valid until (YYYY-MM-DD)" value={vehicle.licenseExpiry} onChangeText={(t) => setVehicle((s) => ({ ...s, licenseExpiry: t.replace(/[^\d-]/g, '').slice(0, 10) }))} keyboardType="numbers-and-punctuation" placeholder="2030-12-31" />
              <DocumentPhotoField label="Driving licence photo" required value={vehicle.licenseFile} alreadyOnFile={Boolean(p.drivingLicense?.url)} onChange={(f) => setVehicle((s) => ({ ...s, licenseFile: f }))} />
            </>
          ) : null}
          <AppButton title="Save and continue" loading={busy} disabled={Boolean(step1Error)} onPress={() => saveStep(1, () => deliveryApi.submitVehicleStep({
            vehicleType: vehicle.vehicleType, vehicleNo: normalizeRiderDocument(vehicle.vehicleNo),
            licenseNo: needsLicence ? normalizeRiderDocument(vehicle.licenseNo) : '', licenseExpiry: needsLicence ? vehicle.licenseExpiry : '', licenseFile: needsLicence ? vehicle.licenseFile : null,
          }))} />
          {step1Error ? <Text style={type.small}>{step1Error}</Text> : null}
        </Card>
      ) : null}

      {step === 2 ? (
        <Card title="Aadhaar">
          <InlineNotice>Bulkimart stores your Aadhaar number masked (last four digits). Photos are private KYC documents.</InlineNotice>
          <AppInput label="Aadhaar number" required value={aadhaar.number} onChangeText={(t) => setAadhaar((s) => ({ ...s, number: t.replace(/\D/g, '').slice(0, 12) }))} keyboardType="number-pad" maxLength={12} />
          <DocumentPhotoField label="Aadhaar front" required value={aadhaar.frontFile} onChange={(f) => setAadhaar((s) => ({ ...s, frontFile: f }))} />
          <DocumentPhotoField label="Aadhaar back" required value={aadhaar.backFile} onChange={(f) => setAadhaar((s) => ({ ...s, backFile: f }))} />
          <AppButton title="Save and continue" loading={busy} disabled={Boolean(step2Error)} onPress={() => saveStep(2, () => deliveryApi.submitAadhaarStep({ aadhaarNumber: aadhaar.number, frontFile: aadhaar.frontFile, backFile: aadhaar.backFile }))} />
          {step2Error ? <Text style={type.small}>{step2Error}</Text> : null}
        </Card>
      ) : null}

      {step === 3 ? (
        <>
          <Card title="Where you deliver">
            <AppInput label="Delivery pincodes" required value={area.zones} onChangeText={(t) => setArea((a) => ({ ...a, zones: t }))} keyboardType="numbers-and-punctuation"
              placeholder="452001, 452006" hint="Every 6-digit pincode you can serve, separated by commas." />
            <AppInput label="Delivery radius (km, optional)" value={area.radius} onChangeText={(t) => setArea((a) => ({ ...a, radius: t.replace(/[^\d.]/g, '') }))} keyboardType="decimal-pad" />
            <Text style={type.label}>Base location *</Text>
            <AppButton title="Use my current location" variant="outline" loading={locating} onPress={useGps} />
            <Text style={type.small}>Or type or correct it (typing replaces the GPS point):</Text>
            <AppInput label="Address" value={area.location?.address || ''} onChangeText={(t) => setLoc('address', t)} />
            <AppInput label="City" value={area.location?.city || ''} onChangeText={(t) => setLoc('city', t)} />
            <AppInput label="Pincode" value={area.location?.pincode || ''} onChangeText={(t) => setLoc('pincode', t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
          </Card>
          <Card title="Payout account">
            <AppInput label="Account holder name" required value={area.holderName} onChangeText={(t) => setArea((a) => ({ ...a, holderName: t }))} />
            <AppInput label="Bank name" required value={area.bankName} onChangeText={(t) => setArea((a) => ({ ...a, bankName: t }))} />
            <AppInput label="Account number" required value={area.accountNo} onChangeText={(t) => setArea((a) => ({ ...a, accountNo: t.replace(/\D/g, '').slice(0, 18) }))} keyboardType="number-pad" />
            <AppInput label="IFSC" required value={area.ifsc} onChangeText={(t) => setArea((a) => ({ ...a, ifsc: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) }))} autoCapitalize="characters" placeholder="HDFC0001234" />
            <AppInput label="UPI ID (optional)" value={area.upiId} onChangeText={(t) => setArea((a) => ({ ...a, upiId: t.trim() }))} autoCapitalize="none" />
            <DocumentPhotoField label="Passbook page or cancelled cheque" required value={area.passbookFile} alreadyOnFile={Boolean(p.bankDetails?.passbookUrl)} onChange={(f) => setArea((a) => ({ ...a, passbookFile: f }))} />
          </Card>
          <AppButton title="Save and continue" loading={busy} disabled={Boolean(step3Error)} onPress={() => saveStep(3, () => deliveryApi.submitServiceAreaStep({
            zones: parsePincodes(area.zones).join(','), deliveryRadius: area.radius,
            location: area.location, passbookFile: area.passbookFile,
            bank: { holderName: area.holderName.trim(), bankName: area.bankName.trim(), accountNo: area.accountNo, ifsc: area.ifsc.trim().toUpperCase(), upiId: area.upiId.trim() },
          }))} />
          {step3Error ? <Text style={type.small}>{step3Error}</Text> : null}
        </>
      ) : null}

      {step === 4 ? (
        <Card title="Submit for verification">
          <Text style={type.body}>Bulkimart will check your documents. You can take deliveries once your account is approved.</Text>
          <AppButton title="Submit application" loading={busy} onPress={submit} />
        </Card>
      ) : null}

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  step: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  stepActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  stepText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  stepTextActive: { color: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  chipActive: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chipTextActive: { color: colors.deepBlue },
});
