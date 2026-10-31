import Constants from 'expo-constants';

// The deployed backend, from app.json → expo.extra.apiBaseUrl. HTTPS only: a plain-HTTP or
// local URL is refused so a debug value can never ship in a release build.
const configured = Constants.expoConfig?.extra?.apiBaseUrl || 'https://api.bulkimart.in';
if (!/^https:\/\//i.test(configured)) throw new Error('The API base URL must use HTTPS.');

export const API_BASE_URL = configured.replace(/\/$/, '');
// Socket.IO uses the same host (its own /socket.io path), as on the web.
export const SOCKET_ORIGIN = new URL(API_BASE_URL).origin;
export const WEBSITE_ORIGIN = 'https://bulkimart.in';
export const REQUEST_TIMEOUT_MS = 10000;
