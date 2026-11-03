import { useMemo } from 'react';
import { socket } from './socket';
import { apiUrl } from './api';
import { getPortalToken } from './portalSession';
import { useSupportChat } from './supportChatCore';

/**
 * Web adapter for the live chat core: the current portal's own token
 * (customer / seller / delivery never share credentials) and the shared
 * Socket.IO connection that portal already opened.
 */
const request = async (method, path, body) => {
  const token = getPortalToken();
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Network error. Check your connection and try again.'), { code: 'NETWORK', status: 0 });
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw Object.assign(new Error(json.message || `Request failed (${response.status})`), { code: json.meta?.code || null, status: response.status });
  }
  return json;
};

const adapter = {
  request,
  socket,
  isForeground: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  onForeground: (cb) => {
    const handler = () => { if (document.visibilityState === 'visible') cb(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

export const useWebSupportChat = (options) => useSupportChat(useMemo(() => adapter, []), options);
export default useWebSupportChat;
