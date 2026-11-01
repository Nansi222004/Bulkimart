import * as Keychain from 'react-native-keychain';
import { SESSION_SERVICE } from '../config/env';

// The delivery JWT is stored in the Android Keystore-backed keychain, never in AsyncStorage.
export async function saveSessionToken(token) {
  await Keychain.setGenericPassword('delivery', token, {
    service: SESSION_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function readSessionToken() {
  try {
    const entry = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    return entry ? entry.password : null;
  } catch {
    // A corrupted or invalidated keystore entry is treated as signed out.
    return null;
  }
}

export async function clearSessionToken() {
  try {
    await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
  } catch {
    // Nothing stored.
  }
}
