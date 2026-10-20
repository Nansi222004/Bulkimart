import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// PM2 may start from the repository root. Resolve the backend .env relative
// to this module, and preserve credentials supplied by the hosting platform.
// Tests must never load the developer's database or integration credentials.
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), override: false, quiet: true });
}
