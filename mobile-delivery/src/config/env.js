// Public, non-secret configuration only. Never put API keys or secrets here.
//
// Same as the Customer and Seller apps: every build talks to the live Bulkimart backend.
// There is no staging server. Test only with a test rider account, because actions in the app
// (accepting orders, OTP completion, COD reports, payouts) change live data.
//
// To use a separate test server later, set STAGING_API_URL (HTTPS) and debug builds will use it.
const STAGING_API_URL = null;
const PRODUCTION_API_URL = 'https://api.bulkimart.in';

const useStaging = __DEV__ && typeof STAGING_API_URL === 'string';
export const APP_ENV = useStaging
  ? { name: 'staging', apiBaseUrl: STAGING_API_URL }
  : { name: 'production', apiBaseUrl: PRODUCTION_API_URL };
export const API_BASE_URL = APP_ENV.apiBaseUrl;
// HTTPS only; anything else makes every request fail with API_NOT_CONFIGURED.
export const API_CONFIGURED = typeof API_BASE_URL === 'string' && /^https:\/\//.test(API_BASE_URL);

export const REQUEST_TIMEOUT_MS = 15000;
export const UPLOAD_TIMEOUT_MS = 120000;

// Keychain service for the rider session; separate from the Customer and Seller apps.
export const SESSION_SERVICE = 'com.Bulkimart.delivery.session';

// Same values the web portal uses (frontend/src/modules/Delivery/*). Server rules still decide.
export const OFFER_WINDOW_SECONDS = 60;      // OrderPingModal / ReturnPickupPingModal
export const OFFER_POLL_MS = 10000;          // checkPendingPings
export const RETURN_POLL_MS = 15000;         // fetchReturnPickups
export const PROFILE_REFRESH_MS = 30000;     // refreshRiderStatus while approved
export const PRESENCE_INTERVAL_MS = 60000;   // startRiderPresence heartbeat while on duty
export const TRIP_PING_MIN_MS = 5000;        // live trip location throttle
