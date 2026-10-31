import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// The web app reads localStorage synchronously while rendering. To keep that logic unchanged, every value is
// mirrored in memory: `hydrateStorage()` loads it once before the app renders, reads are synchronous, and
// writes update memory immediately and persist in the background.
//
// - `local`   = web localStorage   → AsyncStorage (persists across launches)
// - `session` = web sessionStorage → memory only (cleared when the app process ends, like a browser tab)
// - the customer token never goes to AsyncStorage: it lives in SecureStore (Android Keystore).

const PREFIX = 'bm:';
const SECURE_KEYS = { userToken: 'bulkimart_user_token' };
const memory = new Map();
let hydrated = false;

export async function hydrateStorage() {
  if (hydrated) return;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX));
    const rows = await AsyncStorage.multiGet(keys);
    for (const [key, value] of rows) if (value !== null) memory.set(key.slice(PREFIX.length), value);
  } catch { /* storage is optional; the app still starts as a guest */ }
  for (const [name, secureKey] of Object.entries(SECURE_KEYS)) {
    try {
      const value = await SecureStore.getItemAsync(secureKey);
      if (value) memory.set(name, value); else memory.delete(name);
    } catch { memory.delete(name); }
  }
  hydrated = true;
}

const persist = (key, value) => {
  const secureKey = SECURE_KEYS[key];
  if (secureKey) {
    const done = value === null ? SecureStore.deleteItemAsync(secureKey) : SecureStore.setItemAsync(secureKey, value);
    done.catch(() => {});
    return;
  }
  const done = value === null ? AsyncStorage.removeItem(PREFIX + key) : AsyncStorage.setItem(PREFIX + key, value);
  done.catch(() => {});
};

export const local = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => { const text = String(value); memory.set(key, text); persist(key, text); },
  removeItem: key => { memory.delete(key); persist(key, null); },
  keys: () => [...memory.keys()].filter(key => !SECURE_KEYS[key]),
};

const sessionMemory = new Map();
export const session = {
  getItem: key => (sessionMemory.has(key) ? sessionMemory.get(key) : null),
  setItem: (key, value) => { sessionMemory.set(key, String(value)); },
  removeItem: key => { sessionMemory.delete(key); },
  keys: () => [...sessionMemory.keys()],
};

export const readJSON = (store, key, fallback = null) => {
  try { const value = store.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
};
