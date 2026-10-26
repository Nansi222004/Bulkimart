import { validateFirebaseAdminConfig } from '../../config/firebaseAdmin.js';

const serviceAccount = {
  project_id: 'bulkimart-staging',
  client_email: 'firebase-adminsdk@bulkimart-staging.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest-only\n-----END PRIVATE KEY-----\n',
};

test('validates a complete Firebase service account for the expected project', () => {
  expect(validateFirebaseAdminConfig({
    NODE_ENV: 'production',
    FIREBASE_PROJECT_ID: 'bulkimart-staging',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  })).toBe(true);
});

test('rejects missing credentials and a mismatched Firebase project', () => {
  expect(() => validateFirebaseAdminConfig({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'x' }))
    .toThrow(/SERVICE_ACCOUNT/);
  expect(() => validateFirebaseAdminConfig({
    NODE_ENV: 'production',
    FIREBASE_PROJECT_ID: 'production-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
  })).toThrow(/does not match/);
});

