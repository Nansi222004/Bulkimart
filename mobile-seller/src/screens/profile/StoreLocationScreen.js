import React, { useState } from 'react';
import { Alert, Linking, ToastAndroid } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import usePinnedAddress, { readableAddress } from '../../hooks/usePinnedAddress';
import { reverseGeocode, saveStoreLocation } from '../../services/settings.api';
import { LocationError, currentPosition } from '../../utils/location';
import { type } from '../../theme';

// Native counterpart of the web ProfileTab "Update Location": one GPS fix → confirm → PUT { lat, lng }.
// A map picker is not built (it needs a maps SDK and key); the pin always comes from the device location.
export default function StoreLocationScreen() {
  const { seller, refreshSeller } = useAuth();
  const store = seller?.storeDetails || {};
  const [fix, setFix] = useState(null);
  const [address, setAddress] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const hasPin = Number.isFinite(store.lat) && Number.isFinite(store.lng);
  const pinned = usePinnedAddress(store.lat, store.lng);
  const typedAddress = [store.address, store.city, store.state, store.pincode].filter(Boolean).join(', ');

  const locate = async () => {
    setBusy('locate'); setError(''); setAddress(null);
    try {
      const position = await currentPosition();
      setFix(position);
      reverseGeocode(position).then((a) => setAddress(a || false)).catch(() => setAddress(false)); // display only; false = lookup failed
    } catch (e) { setError(e instanceof LocationError ? e.message : 'Could not get your location.'); }
    finally { setBusy(''); }
  };

  const save = () => Alert.alert('Pin store here?', 'Customers and riders will use this point to find your store.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save pin', onPress: async () => {
      setBusy('save'); setError('');
      try {
        await saveStoreLocation(fix);
        await refreshSeller();
        setFix(null); setAddress(null);
        ToastAndroid.show('Store location pinned.', ToastAndroid.SHORT);
      } catch (e) { setError(e.status === 409 ? 'Your profile changed elsewhere. It has been refreshed; please try again.' : e.message || 'Could not update location'); }
      finally { setBusy(''); }
    } },
  ]);

  return (
    <Screen>
      <Card title="Current store pin">
        {hasPin ? (
          <>
            <Text style={type.label}>Pinned at</Text>
            <Text style={type.body} selectable>{pinned.loading ? 'Finding address…' : pinned.text || typedAddress || 'Pinned on the map'}</Text>
            <AppButton small variant="outline" title="Open in maps" onPress={() => Linking.openURL(`geo:${store.lat},${store.lng}?q=${store.lat},${store.lng}`)} />
          </>
        ) : <Text style={type.body}>No location pin yet. Your typed address and pincode are used until you pin the store.</Text>}
        <KeyValueRow label="Address on file" value={typedAddress || '—'} />
      </Card>

      <Card title="Update pin">
        <Text style={type.small}>Stand at your store and use your phone's location. Quick Commerce uses this pin to show your store to nearby customers and riders.</Text>
        <AppButton title="Use my current location" variant="outline" loading={busy === 'locate'} disabled={!!busy} onPress={locate} />
        {fix ? (
          <>
            <Text style={type.label}>New location</Text>
            <Text style={type.body} selectable>{address === null ? 'Finding address…' : (address && readableAddress(address)) || 'Address could not be found. You can still save this pin.'}</Text>
            {Number.isFinite(fix.accuracy) ? <KeyValueRow label="Accuracy" value={`± ${Math.round(fix.accuracy)} m`} /> : null}
            {Number.isFinite(fix.accuracy) && fix.accuracy > 100 ? <InlineNotice tone="warning">The location is not precise (over 100 m). Move outdoors or near a window and try again for a better pin.</InlineNotice> : null}
            <AppButton title="Save this pin" variant="accent" loading={busy === 'save'} disabled={!!busy} onPress={save} />
          </>
        ) : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        <Text style={type.small}>Saving the pin does not change your typed address. Edit the address in Profile or Pickup registration.</Text>
      </Card>
    </Screen>
  );
}
