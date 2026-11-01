import { api } from './apiClient';

// Contract: backend/routes/notification.routes.js + controllers/notification.controller.js.
// The list is paginated: { success, data: [...], meta: { page, limit, total } }.
export const listNotifications = (page = 1, limit = 30) =>
  api.get('/api/notifications', { params: { page, limit } });

export const getUnreadCount = () => api.get('/api/notifications/unread-count'); // data.count

export const markNotificationRead = (id) => api.patch(`/api/notifications/${encodeURIComponent(id)}/read`);

export const markAllNotificationsRead = () => api.patch('/api/notifications/read-all');
