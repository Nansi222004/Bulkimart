import { initializeApp, cert, getApps } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';

/**
 * Single shared Firebase Admin app, initialized once from
 * FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_SERVICE_ACCOUNT file path / JSON string).
 */
let app = null;

const readServiceAccount = (env = process.env) => {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT is not set');
  }

  const trimmed = raw.trim();
  const serviceAccount = trimmed.startsWith('{')
    ? JSON.parse(trimmed)
    : JSON.parse(fs.readFileSync(path.resolve(process.cwd(), trimmed), 'utf8'));

  const missing = ['project_id', 'client_email', 'private_key'].filter((key) => !serviceAccount[key]);
  if (missing.length) throw new Error(`Firebase service account is missing: ${missing.join(', ')}`);
  if (env.FIREBASE_PROJECT_ID && serviceAccount.project_id !== env.FIREBASE_PROJECT_ID) {
    throw new Error('Firebase service account project does not match FIREBASE_PROJECT_ID');
  }
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
};

export const validateFirebaseAdminConfig = (env = process.env) => {
  if (env.NODE_ENV === 'production' && !env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is required when FCM_MODE=live in production');
  }
  readServiceAccount(env);
  return true;
};

export const getFirebaseApp = () => {
  if (app) return app;

  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }

  const serviceAccount = readServiceAccount();

  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  return app;
};

export default getFirebaseApp;
