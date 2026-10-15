import { getPortalToken } from './portalSession';
import { useState, useCallback } from 'react';
import { apiUrl } from './api';

/**
 * Shared data hook for the Support/Ticket system — one implementation used
 * by Customer, Seller, SHG and Delivery Partner; all four call the exact
 * same `/api/tickets` endpoints with no role field at all. The backend
 * derives which role the request is acting as entirely from the
 * authenticated session (JWT claim + live approval records — see
 * ticket.service.js::resolveRequester); the frontend has no say in it and
 * sends nothing role-related.
 */
export const useTickets = (defaultRole) => {
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const authHeaders = useCallback(() => {
    const token = getPortalToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const unwrap = async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
    return body;
  };

  const fetchCategories = useCallback(async (role = defaultRole) => {
    try {
      const q = role ? `?role=${encodeURIComponent(role)}` : '';
      const res = await fetch(apiUrl(`/api/tickets/categories${q}`), { headers: authHeaders() });
      const body = await unwrap(res);
      setCategories(body.data?.categories || []);
    } catch (err) {
      console.error('[TICKETS] fetch categories failed:', err.message);
    }
  }, [authHeaders, defaultRole]);

  const fetchMyTickets = useCallback(async (role = defaultRole) => {
    setLoading(true);
    setError('');
    try {
      const q = role ? `&role=${encodeURIComponent(role)}` : '';
      const res = await fetch(apiUrl(`/api/tickets?limit=50${q}`), { headers: authHeaders() });
      const body = await unwrap(res);
      setTickets(body.data || []);
    } catch (err) {
      setError(err.message);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, defaultRole]);

  const fetchTicketDetail = useCallback(async (id) => {
    const res = await fetch(apiUrl(`/api/tickets/${id}`), { headers: authHeaders() });
    return unwrap(res);
  }, [authHeaders]);

  /** `fields`: { category, subject, description, relatedOrder?, relatedProduct?, relatedDelivery? }, `files`: File[] */
  const createTicket = useCallback(async (fields, files = []) => {
    const form = new FormData();
    const payload = defaultRole ? { role: defaultRole, ...fields } : fields;
    Object.entries(payload).forEach(([k, v]) => { if (v) form.append(k, v); });
    files.forEach((f) => form.append('attachments', f));

    const res = await fetch(apiUrl('/api/tickets'), { method: 'POST', headers: authHeaders(), body: form });
    const body = await unwrap(res);
    setTickets((prev) => [body.data, ...prev]);
    return body.data;
  }, [authHeaders, defaultRole]);

  const sendMessage = useCallback(async (ticketId, message, files = []) => {
    const form = new FormData();
    form.append('message', message);
    files.forEach((f) => form.append('attachments', f));
    const res = await fetch(apiUrl(`/api/tickets/${ticketId}/messages`), { method: 'POST', headers: authHeaders(), body: form });
    return unwrap(res);
  }, [authHeaders]);

  const reopenTicket = useCallback(async (ticketId) => {
    const res = await fetch(apiUrl(`/api/tickets/${ticketId}/reopen`), { method: 'POST', headers: authHeaders() });
    const body = await unwrap(res);
    setTickets((prev) => prev.map((t) => (t._id === ticketId ? body.data : t)));
    return body.data;
  }, [authHeaders]);

  return {
    tickets, categories, loading, error,
    fetchCategories, fetchMyTickets, fetchTicketDetail, createTicket, sendMessage, reopenTicket,
  };
};

export default useTickets;
