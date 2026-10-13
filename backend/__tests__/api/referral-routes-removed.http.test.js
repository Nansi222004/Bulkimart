import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'removed-route-test-secret';

const { default: apiRoutes } = await import('../../routes/index.js');

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

test.each([
  ['post', '/api/referrals/validate'],
  ['get', '/api/referrals/me'],
  ['get', '/api/referrals/list'],
])('%s %s is no longer registered', async (method, path) => {
  const response = await request(app)[method](path);
  expect(response.status).toBe(404);
});
