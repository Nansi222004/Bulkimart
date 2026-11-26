import { api } from './apiClient';

// GET /api/training/seller → { success, data: [{ _id, title, description, topic, source, watchUrl, thumbnailUrl, durationSec }] }
// Published how-to videos for sellers (admin panel → Training & Coaching Videos).
export async function getTrainingVideos() {
  const body = await api.get('/api/training/seller');
  if (!body?.success) throw new Error(body?.message || 'Training videos are not available right now.');
  return body.data || [];
}
