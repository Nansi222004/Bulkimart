// Foreground location on demand (web: navigator.geolocation.getCurrentPosition with enableHighAccuracy,
// timeout 15 s, maximumAge 0). The permission prompt only appears when the customer asks to use GPS.
// Error codes mirror the browser's: 1 = denied, 2 = unavailable, 3 = timeout.
import * as Location from 'expo-location';

export async function getCurrentPosition({ timeout = 15000 } = {}) {
  const permission = await Location.requestForegroundPermissionsAsync().catch(() => ({ granted: false }));
  if (!permission.granted) { const error = new Error('denied'); error.code = 1; throw error; }
  let timer;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('timeout'); error.code = 3; reject(error); }, timeout); }),
    ]);
    return position;
  } catch (error) {
    if (error?.code === 3) throw error;
    const unavailable = new Error('unavailable'); unavailable.code = 2; throw unavailable;
  } finally { clearTimeout(timer); }
}
