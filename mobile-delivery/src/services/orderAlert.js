import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ringing for offer pop-ups (native module: android/app/src/main/java/.../alert/OrderAlertModule.kt).
 * Each open pop-up calls ring() and the function it returns when it closes. The sound keeps looping until
 * every open pop-up has closed, so closing one offer never silences another.
 * The rider can switch in-app ringing off in Profile → Notifications ("Ring for new offers").
 */
const Native = Platform.OS === 'android' ? NativeModules.BulkimartOrderAlert ?? null : null;
const KEY = 'bulkimart-delivery:ring-offers';

let enabled = true;
let open = 0;
let loaded = AsyncStorage.getItem(KEY).then((v) => { enabled = v !== 'off'; }).catch(() => {});

export const ringingSupported = () => Boolean(Native);

export async function isRingingEnabled() {
  await loaded;
  return enabled;
}

export async function setRingingEnabled(value) {
  enabled = Boolean(value);
  loaded = Promise.resolve();
  try { await AsyncStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* kept in memory for this session */ }
  if (!enabled) { try { Native?.stop(); } catch { /* not playing */ } }
  else if (open > 0) { try { Native?.start(); } catch { /* sound unavailable */ } }
}

/** Starts ringing for one open pop-up; returns a function that ends it. */
export function ring() {
  open += 1;
  let ended = false;
  loaded.then(() => {
    if (!ended && enabled && open > 0) { try { Native?.start(); } catch { /* sound unavailable */ } }
  });
  return () => {
    if (ended) return;
    ended = true;
    open = Math.max(0, open - 1);
    if (open === 0) { try { Native?.stop(); } catch { /* already stopped */ } }
  };
}

/** Android's settings page for the "New order offers" channel (sound / volume with the app closed). */
export function openOfferSoundSettings() {
  try { Native?.openChannelSettings(); } catch { /* settings unavailable */ }
}
