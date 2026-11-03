import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setApiToken, setUnauthorizedHandler } from '../services/apiClient';
import { clearSessionToken, readSessionToken, saveSessionToken } from '../services/storage';
import { deregisterPush } from '../services/push';
import { disconnectRiderSocket } from '../services/socket';
import * as deliveryApi from '../services/delivery.api';
import { isValidDeliveryLogin } from '../utils/session';

/**
 * Rider session. Same rules as the web portal (DeliveryContext + utils/deliverySession.js):
 *  - The server decides who is approved. Nothing stored on the phone grants access.
 *  - A stored token is checked with /api/auth/me (must be a 'delivery' session) and /api/delivery/me.
 *  - 401 ends the session. A network or server error shows a retry screen, never a silent logout.
 *  - An unfinished registration ('incomplete') continues only within the app session that started it;
 *    reopening the app starts again from the phone number, as the web portal does.
 */
const AuthContext = createContext(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({ phase: 'loading', token: null, profile: null, error: '' });
  const registrationToken = useRef(null);   // in memory only: an incomplete registration may continue this session
  const tokenRef = useRef(null);

  const endSession = useCallback(async ({ deregister = true } = {}) => {
    const token = tokenRef.current;
    tokenRef.current = null;
    registrationToken.current = null;
    disconnectRiderSocket();
    if (deregister && token) await deregisterPush(token);
    setApiToken(null);
    await clearSessionToken();
    setState({ phase: 'signedOut', token: null, profile: null, error: '' });
  }, []);

  // Reads the profile for the current token. Returns 'ok' | 'signedOut' | 'error'.
  const loadProfile = useCallback(async (token) => {
    try {
      const identity = await deliveryApi.getIdentity();
      if (identity?.userType !== 'user' || identity?.sessionRole !== 'delivery') { await endSession({ deregister: false }); return 'signedOut'; }
      const profile = await deliveryApi.getMyProfile();
      if (tokenRef.current !== token) return 'signedOut';
      if (!profile || typeof profile.status !== 'string') throw new Error('Delivery profile unavailable');
      if (profile.status === 'incomplete' && registrationToken.current !== token) { await endSession({ deregister: false }); return 'signedOut'; }
      setState({ phase: 'signedIn', token, profile, error: '' });
      return 'ok';
    } catch (error) {
      if (tokenRef.current !== token) return 'signedOut';
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        // 404: signed in, but no delivery profile. They register from the phone screen.
        await endSession({ deregister: false });
        return 'signedOut';
      }
      setState((s) => ({ ...s, phase: 'error', token, error: error.message || 'Unable to verify your delivery session.' }));
      return 'error';
    }
  }, [endSession]);

  // Cold start: restore a stored session if the server still accepts it.
  const bootstrap = useCallback(async () => {
    setState((s) => ({ ...s, phase: 'loading', error: '' }));
    const token = await readSessionToken();
    if (!token) { setState({ phase: 'signedOut', token: null, profile: null, error: '' }); return; }
    tokenRef.current = token;
    setApiToken(token);
    await loadProfile(token);
  }, [loadProfile]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // A 401 from any request ends the session (expired, revoked or replaced token).
  useEffect(() => {
    setUnauthorizedHandler(() => { endSession({ deregister: false }); });
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  /** OTP sign-in or registration. Returns { ok, message? }. */
  const signIn = useCallback(async ({ phone, otp, intent, name }) => {
    try {
      const body = await deliveryApi.verifyLoginOtp(phone, otp, intent);
      let profileState = body?.deliveryState;
      if (intent === 'register') {
        profileState = await deliveryApi.startOnboarding(name, body?.token);
      }
      if (!profileState || typeof profileState.status !== 'string') return { ok: false, message: 'Delivery profile is unavailable. Please sign in again.' };
      if (!isValidDeliveryLogin(body, profileState.status)) return { ok: false, message: 'Invalid delivery sign-in. Please try again.' };
      await saveSessionToken(body.token);
      tokenRef.current = body.token;
      if (profileState.status === 'incomplete') registrationToken.current = body.token;
      setApiToken(body.token);
      const result = await loadProfile(body.token);
      return result === 'ok' ? { ok: true } : { ok: false, message: 'Could not load your delivery profile. Retry.' };
    } catch (error) {
      // `code` (OTP_INVALID, OTP_EXPIRED, NETWORK, …) lets the login screen explain the failure.
      return { ok: false, message: error.message || 'OTP verification failed', code: error.code || null };
    }
  }, [loadProfile]);

  /** Re-reads /api/delivery/me. Keeps the last good profile on a network error. */
  const refreshProfile = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return { ok: false };
    try {
      const profile = await deliveryApi.getMyProfile();
      if (tokenRef.current !== token) return { ok: false };
      setState((s) => ({ ...s, phase: 'signedIn', profile, error: '' }));
      return { ok: true, profile };
    } catch (error) {
      return { ok: false, message: error.message, status: error.status };
    }
  }, []);

  /** Locally merges fields the server just returned (e.g. an onboarding step). */
  const mergeProfile = useCallback((patch) => {
    if (patch) setState((s) => (s.profile ? { ...s, profile: { ...s.profile, ...patch } } : s));
  }, []);

  const value = useMemo(() => ({
    phase: state.phase,
    token: state.token,
    profile: state.profile,
    sessionError: state.error,
    retrySession: () => (tokenRef.current ? loadProfile(tokenRef.current) : bootstrap()),
    signIn,
    signOut: () => endSession({ deregister: true }),
    refreshProfile,
    mergeProfile,
  }), [state, signIn, endSession, refreshProfile, mergeProfile, loadProfile, bootstrap]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
