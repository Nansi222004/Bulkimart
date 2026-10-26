import express from 'express';
import request from 'supertest';
import apiRoutes from '../../routes/index.js';
import adminRoutes from '../../routes/admin.routes.js';

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

const routeSignatures = (router) => router.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods)
    .map((method) => `${method.toUpperCase()} ${layer.route.path}`));

describe('retired legacy feature routes', () => {
  test.each([
    ['get', '/api/premium/plans'],
    ['get', '/api/premium/me'],
    ['post', '/api/premium/purchase'],
    ['post', '/api/premium/enroll'],
    ['post', '/api/premium/renew'],
    ['post', '/api/premium/cancel'],
    ['get', '/api/subscriptions'],
    ['post', '/api/subscriptions'],
    ['get', '/api/subscription-basket'],
    ['get', '/api/shg'],
    ['get', '/api/shg-subscription'],
    ['get', '/api/donation-setting'],
  ])('%s %s is not registered', async (method, path) => {
    await request(app)[method](path).expect(404);
  });

  test('premium plan administration is not registered', () => {
    expect(routeSignatures(adminRoutes).some((route) => route.includes('/premium-plans'))).toBe(false);
  });
});
