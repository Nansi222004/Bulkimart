// Realtime order updates — port of frontend/src/utils/socket.js (same socket.io-client, same rooms).
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { SOCKET_ORIGIN } from '../config';
import { on, EVENTS } from './events';

export const socket = io(SOCKET_ORIGIN, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  // React Native has no XHR long-polling cookies; WebSocket is the reliable transport.
  transports: ['websocket'],
});

let identity = null;
let transportIdentity = null;
let disposal;
// Back in the foreground or back online: reconnect now rather than waiting out the retry delay.
const resume = () => { if (identity && !socket.connected && !socket.active) socket.connect(); };
AppState.addEventListener('change', state => { if (state === 'active') resume(); });
on(EVENTS.ONLINE, resume);

socket.on('connect', () => {
  if (identity?.role === 'buyer') socket.emit('join_user', identity.id);
});

export const connectSocket = (token, role, id) => {
  if (!token) return;
  clearTimeout(disposal);
  if (transportIdentity && (transportIdentity.token !== token || transportIdentity.role !== role || transportIdentity.id !== id)) {
    socket.disconnect();
    socket.sendBuffer.length = 0;
  }
  identity = { token, role, id };
  transportIdentity = identity;
  socket.auth = { token };
  if (!socket.connected && !socket.active) socket.connect();
};

export const disconnectSocket = () => {
  identity = null;
  clearTimeout(disposal);
  disposal = setTimeout(() => {
    if (identity) return;
    socket.disconnect();
    socket.auth = {};
    transportIdentity = null;
    socket.sendBuffer.length = 0;
  }, 0);
};
