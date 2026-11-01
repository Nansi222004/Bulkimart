// Ticket statuses: backend/constants/enums.js TICKET_STATUS. Colours from frontend TicketDetailModal.jsx.
export const TICKET_COLORS = {
  OPEN: '#3b82f6', IN_PROGRESS: '#f59e0b', WAITING_FOR_USER: '#a855f7', RESOLVED: '#16a34a', CLOSED: '#64748b', REOPENED: '#dc2626',
};
// Older tickets used 'Open' / 'Resolved' (LEGACY_TICKET_STATUS_MAP).
export const normaliseTicketStatus = (s) => ({ Open: 'OPEN', Resolved: 'RESOLVED' }[s] || s);
export const ticketStatusLabel = (s) => String(normaliseTicketStatus(s) || '').replace(/_/g, ' ');
// Requester rules: RESOLVED can be reopened; CLOSED accepts no replies.
export const canReopen = (s) => normaliseTicketStatus(s) === 'RESOLVED';
export const canReply = (s) => !['RESOLVED', 'CLOSED'].includes(normaliseTicketStatus(s));
