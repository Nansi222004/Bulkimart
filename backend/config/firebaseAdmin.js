import { initializeApp, cert, getApps } from 'firebase-admin/app';

/**
 * Single shared Firebase Admin app, initialized once from
 * FIREBASE_SERVICE_ACCOUNT_JSON (the service account key as one JSON-string
 * env var — kept in .env rather than only the file path, since that's what
 * every deploy target beyond this local machine can actually set). Every
 * place that needs Firebase Admin (FCM push today, anything else later)
 * imports `getFirebaseApp()` from here instead of calling
 * `initializeApp()` a second time, which throws.
 */
let app = null;

export const getFirebaseApp = () => {
  if (app) return app;

  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT is not set');
  }

  const serviceAccount = JSON.parse(raw);
  // Hosted env providers commonly preserve PEM newlines as literal `\\n`.
  // Normalize both forms before handing the key to Firebase Admin.
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\\\n/g, '\n');
  }

  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  return app;
};

export default getFirebaseApp;
