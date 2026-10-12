import express from 'express';
import request from 'supertest';
import healthRoutes from '../../routes/health.routes.js';

test('GET /api/health retains the production health response', async () => {
  const app = express();
  app.use('/api/health', healthRoutes);

  const response = await request(app).get('/api/health').expect(200);
  expect(response.headers['content-type']).toMatch(/application\/json/);
  expect(response.body).toEqual({ message: 'Backend is running 🚀' });
});

