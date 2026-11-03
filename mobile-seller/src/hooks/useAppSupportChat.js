import { useMemo } from 'react';
import { AppState } from 'react-native';
import { api, getApiToken } from '../services/apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';
import { getSupportSocket } from '../services/supportSocket';
import { useSupportChat } from '../utils/supportChatCore';

/** Seller-app adapter for the shared live chat core (src/utils/supportChatCore.js). */
const multipart = { timeout: UPLOAD_TIMEOUT_MS, headers: { 'Content-Type': 'multipart/form-data' }, transformRequest: (data) => data };

const request = (method, path, body) => {
  if (method === 'GET') return api.get(path);
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  return api.post(path, body ?? {}, isForm ? multipart : undefined);
};

export function useAppSupportChat(options) {
  const token = getApiToken();
  const socket = useMemo(() => getSupportSocket(token), [token]);
  const adapter = useMemo(() => ({
    request,
    socket,
    isForeground: () => AppState.currentState === 'active',
    onForeground: (cb) => {
      const sub = AppState.addEventListener('change', (state) => { if (state === 'active') cb(); });
      return () => sub.remove();
    },
  }), [socket]);
  return useSupportChat(adapter, options);
}
