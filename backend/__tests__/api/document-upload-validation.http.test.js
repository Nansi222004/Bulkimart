import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { uploadSingle } from '../../middlewares/upload.middleware.js';
import { errorHandler } from '../../middlewares/error.middleware.js';

const app = express();
app.put('/upload', uploadSingle('license'), (req, res) => res.json({ success: true, mime: req.file.mimetype, size: req.file.size }));
app.use(errorHandler);

test('accepts a supported driving-licence image with the expected multipart field', async () => {
  const response = await request(app).put('/upload')
    .attach('license', Buffer.from('jpeg-content'), { filename: 'licence.jpg', contentType: 'image/jpeg' })
    .expect(200);
  expect(response.body).toMatchObject({ success: true, mime: 'image/jpeg' });
});

test('rejects unsupported document types', async () => {
  const response = await request(app).put('/upload')
    .attach('license', Buffer.from('plain'), { filename: 'licence.txt', contentType: 'text/plain' })
    .expect(400);
  expect(response.body.message).toMatch(/Invalid file type/);
});

test('rejects documents larger than five megabytes', async () => {
  const response = await request(app).put('/upload')
    .attach('license', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.jpg', contentType: 'image/jpeg' })
    .expect(413);
  expect(response.body.message).toBeTruthy();
});
