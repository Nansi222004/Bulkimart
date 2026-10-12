import { getAllowedOrigins, getCorsOptions } from '../../config/cors.js';
import cors from 'cors';
import express from 'express';
import request from 'supertest';

describe('CORS configuration', () => {
  test('uses exact Bulkimart origins in production', () => {
    expect(getAllowedOrigins({ NODE_ENV: 'production' })).toEqual([
      'https://bulkimart.in',
      'https://www.bulkimart.in',
    ]);
  });

  test('uses local Vite origins outside production', () => {
    expect(getAllowedOrigins({ NODE_ENV: 'development' })).toEqual([
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]);
  });

  test('honours and de-duplicates an explicit deployment allowlist', () => {
    expect(getAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://store.example, https://admin.example, https://store.example',
    })).toEqual(['https://store.example', 'https://admin.example']);
  });

  test('rejects a credentialed wildcard configuration', () => {
    expect(() => getAllowedOrigins({
      NODE_ENV: 'production',
      CORS_ORIGINS: '*',
    })).toThrow(/wildcard is not allowed/i);
  });

  test('keeps credentialed preflight options explicit', () => {
    const options = getCorsOptions({ NODE_ENV: 'production' });
    expect(options.credentials).toBe(true);
    expect(options.methods).toContain('OPTIONS');
    expect(options.optionsSuccessStatus).toBe(204);
    expect(options.origin).not.toContain('*');
  });

  test('answers an allowed production preflight with exact credentialed headers', async () => {
    const app = express();
    app.use(cors(getCorsOptions({ NODE_ENV: 'production' })));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    const response = await request(app)
      .options('/api/health')
      .set('Origin', 'https://bulkimart.in')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('https://bulkimart.in');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toBe('authorization,content-type,idempotency-key');
  });
});
