import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import AppButton from './AppButton';
import { useToast } from './Toast';
import { dialablePhone, directionsWebUrl, navigationIntentUrl, toCoord } from '../utils/location';
import { spacing } from '../theme';

/**
 * Navigate / Call buttons. Navigation opens Google Maps turn-by-turn when it is installed,
 * otherwise a maps web link (any browser or maps app). Coordinates are used when valid;
 * otherwise the address text. No API key is needed for either.
 */
export async function openNavigation({ point, address }, toast) {
  const coord = toCoord(point);
  try {
    if (coord) {
      const intent = navigationIntentUrl(coord);
      if (await Linking.canOpenURL(intent)) { await Linking.openURL(intent); return; }
    }
    const web = directionsWebUrl({ coord, address });
    if (!web) { toast?.show('This stop has no location or address. Call the contact or support.', 'error'); return; }
    await Linking.openURL(web);
  } catch {
    toast?.show('Could not open maps on this phone.', 'error');
  }
}

export default function NavigateButtons({ point, address, phone, callLabel = 'Call' }) {
  const toast = useToast();
  const dial = dialablePhone(phone);
  // No phone prop at all (e.g. a store, whose number the API does not send) -> navigation only.
  const showCall = phone !== undefined;
  return (
    <View style={styles.row}>
      <AppButton title="Navigate" style={styles.flex} onPress={() => openNavigation({ point, address }, toast)} />
      {showCall ? (
        <AppButton title={callLabel} variant="outline" style={styles.flex}
          onPress={() => (dial ? Linking.openURL(`tel:${dial}`) : toast.show('The phone number is unavailable. Contact support.', 'error'))} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
