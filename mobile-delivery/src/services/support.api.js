import { api } from './apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';

// Contracts: backend/routes/ticket.routes.js + controllers/ticket.controller.js, and frontend/src/utils/useTickets.js.
// The backend resolves the requester role from the session; `role=delivery` is the same hint the web portal sends.
export const TICKET_MAX_ATTACHMENTS = 5; // backend/constants/enums.js

const multipart = (onProgress) => ({
  timeout: UPLOAD_TIMEOUT_MS,
  headers: { 'Content-Type': 'multipart/form-data' },
  transformRequest: (data) => data,
  onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.min(1, e.loaded / e.total)); } : undefined,
});
const appendFiles = (fd, files) => files.forEach((f) => fd.append('attachments', { uri: f.uri, name: f.name, type: f.type }));

// → data { role, categories: [string] }
export async function getTicketCategories() {
  const body = await api.get('/api/tickets/categories', { params: { role: 'delivery' } });
  return Array.isArray(body?.data?.categories) ? body.data.categories : [];
}

// → paginated data[] (ticketNumber, subject, category, status, updatedAt, …)
export async function listMyTickets() {
  const body = await api.get('/api/tickets', { params: { limit: 50, role: 'delivery' } });
  return Array.isArray(body?.data) ? body.data : [];
}

// → data { ticket, messages[{ senderRole, senderName, message, attachments[{url,fileName,mimeType}], createdAt }] }
export async function getTicketDetail(id) {
  const body = await api.get(`/api/tickets/${encodeURIComponent(id)}`);
  if (!body?.data?.ticket) throw new Error(body?.message || 'Could not load this ticket');
  return body.data;
}

// POST /api/tickets multipart: role, category, subject, description, attachments[≤5]
export function createTicket({ category, subject, description, relatedOrder }, files = [], onProgress) {
  const fd = new FormData();
  fd.append('role', 'delivery');
  fd.append('category', category);
  fd.append('subject', subject);
  fd.append('description', description);
  if (relatedOrder) fd.append('relatedOrder', String(relatedOrder));
  appendFiles(fd, files);
  return api.post('/api/tickets', fd, multipart(onProgress));
}

// POST /api/tickets/:id/messages multipart: message, attachments[≤5]
export function sendTicketMessage(id, message, files = [], onProgress) {
  const fd = new FormData();
  fd.append('message', message);
  appendFiles(fd, files);
  return api.post(`/api/tickets/${encodeURIComponent(id)}/messages`, fd, multipart(onProgress));
}

// Only RESOLVED → REOPENED is allowed for requesters (TICKET_REQUESTER_TRANSITIONS).
export const reopenTicket = (id) => api.post(`/api/tickets/${encodeURIComponent(id)}/reopen`);

