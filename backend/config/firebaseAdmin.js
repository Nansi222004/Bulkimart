import { initializeApp, cert, getApps } from 'firebase-admin/app';
import fs from 'fs';
import path from 'path';

/**
 * Single shared Firebase Admin app, initialized once from
 * FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_SERVICE_ACCOUNT file path / JSON string).
 */
let app = null;

export const getFirebaseApp = () => {
  if (app) return app;

  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT is not set');
  }

  let serviceAccount;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    serviceAccount = JSON.parse(trimmed);
  } else {
    const filePath = path.resolve(process.cwd(), trimmed);
    serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // Normalize private key newlines
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  return app;
};

export default getFirebaseApp;
