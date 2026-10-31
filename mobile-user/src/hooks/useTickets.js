// Port of frontend/src/utils/useTickets.js: the shared /api/tickets client. The backend derives the requester's
// role from the session; `role` is only the category/list filter the web sends too.
import { useCallback, useState } from 'react';
import { boundedFetch, authHeaders } from '../api/client';

const unwrap = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
  return body;
};
const tokenHeaders = () => authHeaders(false);
const appendFile = (form, file) => form.append('attachments', { uri: file.uri, name: file.name, type: file.type });

export function useTickets(defaultRole) {
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCategories = useCallback(async (role = defaultRole) => {
    try {
      const body = await unwrap(await boundedFetch(`/api/tickets/categories${role ? `?role=${encodeURIComponent(role)}` : ''}`, { headers: tokenHeaders() }));
      setCategories(body.data?.categories || []);
    } catch { /* the form keeps its empty category list */ }
  }, [defaultRole]);

  const fetchMyTickets = useCallback(async (role = defaultRole) => {
    setLoading(true); setError('');
    try {
      const body = await unwrap(await boundedFetch(`/api/tickets?limit=50${role ? `&role=${encodeURIComponent(role)}` : ''}`, { headers: tokenHeaders() }));
      setTickets(body.data || []);
    } catch (err) { setError(err.message); setTickets([]); } finally { setLoading(false); }
  }, [defaultRole]);

  const fetchTicketDetail = useCallback(async id => unwrap(await boundedFetch(`/api/tickets/${id}`, { headers: tokenHeaders() })), []);

  /** `fields`: { category, subject, description, relatedOrder?, … }; `files`: [{ uri, name, type }]. */
  const createTicket = useCallback(async (fields, files = []) => {
    const form = new FormData();
    const payload = defaultRole ? { role: defaultRole, ...fields } : fields;
    Object.entries(payload).forEach(([key, value]) => { if (value) form.append(key, value); });
    files.forEach(file => appendFile(form, file));
    const body = await unwrap(await boundedFetch('/api/tickets', { method: 'POST', headers: tokenHeaders(), body: form }, 60000));
    setTickets(prev => [body.data, ...prev]);
    return body.data;
  }, [defaultRole]);

  const sendMessage = useCallback(async (ticketId, message, files = []) => {
    const form = new FormData();
    form.append('message', message);
    files.forEach(file => appendFile(form, file));
    return unwrap(await boundedFetch(`/api/tickets/${ticketId}/messages`, { method: 'POST', headers: tokenHeaders(), body: form }, 60000));
  }, []);

  const reopenTicket = useCallback(async ticketId => {
    const body = await unwrap(await boundedFetch(`/api/tickets/${ticketId}/reopen`, { method: 'POST', headers: tokenHeaders() }));
    setTickets(prev => prev.map(t => (t._id === ticketId ? body.data : t)));
    return body.data;
  }, []);

  return { tickets, categories, loading, error, fetchCategories, fetchMyTickets, fetchTicketDetail, createTicket, sendMessage, reopenTicket };
}

export default useTickets;
