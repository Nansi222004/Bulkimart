import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import SwitchRow from '../../components/SwitchRow';
import UploadProgress from '../../components/UploadProgress';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { requestWholesaleAccess, saveShopSameDay, updateSalesChannels, uploadStoreBranding } from '../../services/settings.api';
import { MediaError, pickPhotos } from '../../utils/media';
import { colors, radius, spacing, type } from '../../theme';

// Settings that already have backend endpoints. Each save re-reads /api/sellers/me so the screen shows server state.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WHOLESALE_STATUS = { not_requested: 'Not requested', pending: 'Request pending admin review', approved: 'Approved', rejected: 'Not approved', suspended: 'Suspended' };

export default function BusinessSettingsScreen() {
  const { seller, limits, refreshSeller } = useAuth();
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const current = (seller?.salesChannels || []).filter((c) => c === 'ecommerce' || c === 'grocery');
  const sd = seller?.sameDay || {};
  const [sameDay, setSameDay] = useState({ enabled: !!sd.enabled, cutoffTime: sd.cutoffTime || '', radiusKm: sd.radiusKm != null ? String(sd.radiusKm) : '', availableDays: Array.isArray(sd.availableDays) ? sd.availableDays : [] });
  const [sameDayError, setSameDayError] = useState('');
  const maxRadius = Number(limits?.sameDayMaxRadiusKm);
  const wholesale = seller?.wholesaleChannel?.status;

  const run = async (key, fn, okMessage) => {
    setBusy(key);
    try { const body = await fn(); ToastAndroid.show(body?.message || okMessage, ToastAndroid.SHORT); await refreshSeller(); return true; }
    catch (e) { Alert.alert('Settings', e.status === 409 ? 'Your profile changed elsewhere. It has been refreshed; please try again.' : e.message || 'Could not save'); if (e.status === 409) await refreshSeller(); return false; }
    finally { setBusy(''); setProgress(null); }
  };

  const toggleChannel = (channel) => {
    const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
    if (!next.length) { Alert.alert('Sales channels', 'At least one sales channel must be enabled.'); return; }
    const label = channel === 'grocery' ? 'Quick Commerce' : 'Shop All';
    Alert.alert('Sales channels', `${current.includes(channel) ? 'Turn off' : 'Turn on'} ${label}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => run('channels', () => updateSalesChannels(next), `${label} ${current.includes(channel) ? 'disabled' : 'enabled'}.`) },
    ]);
  };

  const saveSameDay = () => {
    setSameDayError('');
    let payload = { enabled: false };
    if (sameDay.enabled) {
      const radiusKm = Number(sameDay.radiusKm);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sameDay.cutoffTime)) { setSameDayError('Enter a cut-off time as HH:MM, for example 16:00'); return; }
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) { setSameDayError('Enter how far from your shop you will deliver same-day'); return; }
      if (Number.isFinite(maxRadius) && radiusKm > maxRadius) { setSameDayError(`Same-day delivery cannot be offered beyond ${maxRadius} km`); return; }
      payload = { enabled: true, cutoffTime: sameDay.cutoffTime, radiusKm, availableDays: [...sameDay.availableDays].sort() };
    }
    run('sameDay', () => saveShopSameDay(payload), 'Same-day settings saved.');
  };

  const pickBranding = async (kind) => {
    try {
      const [image] = await pickPhotos(1);
      if (!image) return;
      Alert.alert(kind === 'logo' ? 'Store logo' : 'Store banner', 'Upload this image? It replaces the current one on your storefront.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upload', onPress: () => { setProgress(0); run(kind, () => uploadStoreBranding({ [kind]: image }, setProgress), 'Image uploaded.'); } },
      ]);
    } catch (e) { Alert.alert('Photos', e instanceof MediaError ? e.message : 'Could not open the photo picker.'); }
  };

  if (!seller) return null;
  const store = seller.storeDetails || {};

  return (
    <Screen>
      <Card title="Sales channels">
        {[['ecommerce', 'Shop All (E-Commerce)'], ['grocery', 'Quick Commerce']].map(([c, label]) => (
          <SwitchRow key={c} label={label} value={current.includes(c)} disabled={!!busy} onValueChange={() => toggleChannel(c)} />
        ))}
        <Text style={type.small}>At least one channel must stay on.</Text>
      </Card>

      <Card title="Wholesale access">
        <Text style={type.body}>{wholesale ? WHOLESALE_STATUS[wholesale] || wholesale : 'Not requested'}</Text>
        {wholesale === 'suspended' ? <InlineNotice tone="warning">Wholesale access is suspended; contact an administrator to restore it.</InlineNotice> : null}
        {!wholesale || wholesale === 'not_requested' || wholesale === 'rejected' ? (
          <AppButton title="Request Wholesale access" variant="outline" loading={busy === 'wholesale'} disabled={!!busy}
            onPress={() => run('wholesale', requestWholesaleAccess, 'Wholesale access request sent for admin review.')} />
        ) : null}
        <Text style={type.small}>Set Wholesale prices from a product's page (Products → product → Wholesale prices). New Wholesale-only listings are created on the Bulkimart seller website.</Text>
      </Card>

      <Card title="Same-day delivery (shop)">
        <SwitchRow label="Offer same-day delivery from my shop" value={sameDay.enabled} disabled={!!busy} onValueChange={(v) => setSameDay((s) => ({ ...s, enabled: v }))} />
        {sameDay.enabled ? (
          <>
            <AppInput label="Order cut-off time (HH:MM, 24-hour)" placeholder="16:00" maxLength={5} keyboardType="numbers-and-punctuation" value={sameDay.cutoffTime}
              onChangeText={(t) => setSameDay((s) => ({ ...s, cutoffTime: t }))} />
            <AppInput label="Delivery radius (km)" keyboardType="decimal-pad" value={sameDay.radiusKm}
              hint={Number.isFinite(maxRadius) ? `Up to ${maxRadius} km` : undefined} onChangeText={(t) => setSameDay((s) => ({ ...s, radiusKm: t.replace(/[^0-9.]/g, '') }))} />
            <Text style={type.label}>Days you fulfil same-day orders</Text>
            <View style={styles.days}>
              {DAYS.map((d, i) => {
                const on = sameDay.availableDays.includes(i);
                return (
                  <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.day, on && styles.dayOn]}
                    onPress={() => setSameDay((s) => ({ ...s, availableDays: on ? s.availableDays.filter((x) => x !== i) : [...s.availableDays, i] }))}>
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
        {sameDayError ? <InlineNotice tone="error">{sameDayError}</InlineNotice> : null}
        <AppButton title="Save same-day settings" loading={busy === 'sameDay'} disabled={!!busy} onPress={saveSameDay} />
        <Text style={type.small}>Individual products also need same-day switched on (Edit product, Shop All).</Text>
      </Card>

      <Card title="Store branding">
        <View style={styles.brandRow}>
          {store.logo ? <Image source={{ uri: store.logo }} style={styles.logo} /> : <View style={[styles.logo, styles.empty]}><Text style={type.small}>No logo</Text></View>}
          <AppButton small variant="outline" title="Change logo" loading={busy === 'logo'} disabled={!!busy} onPress={() => pickBranding('logo')} />
        </View>
        {store.banner ? <Image source={{ uri: store.banner }} style={styles.banner} /> : null}
        <AppButton small variant="outline" title={store.banner ? 'Change banner' : 'Add banner'} loading={busy === 'banner'} disabled={!!busy} onPress={() => pickBranding('banner')} />
        {progress != null && (busy === 'logo' || busy === 'banner') ? <UploadProgress progress={progress} /> : null}
      </Card>

      <InlineNotice tone="info">To pin your store with GPS, open More → Store location.</InlineNotice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: { minWidth: 44, minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dayOn: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  dayText: { fontWeight: '700', color: colors.textSecondary },
  dayTextOn: { color: colors.primaryDark },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  banner: { width: '100%', height: 110, borderRadius: radius.md, backgroundColor: colors.surface },
});
