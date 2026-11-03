import { useMemo } from 'react';
import { AppState } from 'react-native';
import { authHeaders, boundedFetch } from '../api/client';
import { appendFormFile } from '../lib/formData';
import { socket } from '../lib/socket';
import { useSupportChat as useSupportChatCore } from '../utils/supportChatCore';

/**
 * Customer-app adapter for the shared live chat core (src/utils/supportChatCore.js):
 * the customer session token, the app's existing Socket.IO connection (opened by
 * UserContext on sign-in) and Expo-compatible file uploads.
 */
const request = async (method, path, body) => {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response;
  try {
    response = await boundedFetch(path, {
      method,
      headers: authHeaders(!isForm && body !== undefined),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    }, isForm ? 60000 : undefined);
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
  appendFile: (form, field, file) => appendFormFile(form, field, file),
  isForeground: () => AppState.currentState === 'active',
  onForeground: (cb) => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') cb(); });
    return () => sub.remove();
  },
};

export function useSupportChat(options) {
  return useSupportChatCore(useMemo(() => adapter, []), options);
}
