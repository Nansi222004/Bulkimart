// Public, non-secret configuration only. Never put API keys or secrets here.
//
// Same as the Customer app (mobile-user/src/config.js): every build talks to the live
// Bulkimart backend. There is no staging server. Test only with a test seller account,
// because actions in the app (products, orders, payouts) change live data.
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

// Keychain service name for the seller session; kept separate from the Customer app.
export const SESSION_SERVICE = 'com.Bulkimart.seller.session';
