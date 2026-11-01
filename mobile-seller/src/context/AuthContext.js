import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readSessionToken, saveSessionToken, clearSessionToken } from '../services/storage';
import { setApiToken, setUnauthorizedHandler, ApiError } from '../services/apiClient';
import { getIdentity, logoutSession, verifySellerOtp } from '../services/auth.api';
import { getSellerMe } from '../services/seller.api';
import { deregisterPush } from '../services/push';

/**
 * The server decides seller access, never local state. Ported from
 * frontend/src/modules/Seller/routes/index.jsx (loadStatus):
 *
 *   gate = 'loading'       checking the stored session
 *        | 'signedOut'     no session → login
 *        | 'verifyError'   server or network unavailable → retry
 *        | 'noSeller'      signed in through "login" but no store on this number
 *        | 'onboarding'    no profile yet (register intent) or status 'none' | 'incomplete'
 *        | 'status'        pending | under_review | rejected | suspended
 *        | 'approved'      dashboard
 */

const AuthContext = createContext(null);

const SIGNED_OUT = { gate: 'signedOut', seller: null, identity: null, limits: null, errorMessage: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...SIGNED_OUT, gate: 'loading' });
  const tokenRef = useRef(null);
  const intentRef = useRef('login');

  const endSession = useCallback(async () => {
    tokenRef.current = null;
    setApiToken(null);
    await clearSessionToken();
    intentRef.current = 'login';
    setState(SIGNED_OUT);
  }, []);

  const loadStatus = useCallback(async (activeIntent) => {
    const token = tokenRef.current;
    if (!token) { setState(SIGNED_OUT); return; }
    setState((previous) => ({ ...previous, gate: previous.gate === 'approved' ? 'approved' : 'loading', errorMessage: null }));
    const stillCurrent = () => token === tokenRef.current;
    try {
      let identity;
      try {
        identity = await getIdentity();
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) { if (stillCurrent()) await endSession(); return; }
        throw error;
      }
      if (!stillCurrent()) return;
      if (!identity?.success || identity.sessionRole !== 'seller' || !identity.profile?._id) { await endSession(); return; }

      let body;
      try {
        body = await getSellerMe();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 401) { if (stillCurrent()) await endSession(); return; }
        if (error.status === 404) body = { success: true, seller: null };
        else if (error.status >= 500 || error.status === 0) throw error;
        else { if (stillCurrent()) await endSession(); return; }
      }
      if (!stillCurrent()) return;

      if (body?.success && body.seller === null) {
        const intent = activeIntent || intentRef.current;
        setState({ gate: intent === 'register' ? 'onboarding' : 'noSeller', seller: null, identity: identity.profile, limits: null, errorMessage: null });
        return;
      }
      const seller = body?.seller;
      if (!seller?._id && !seller?.id) throw new ApiError('Seller profile response is unavailable. Retry loading your profile.');
      const status = seller.status || 'none';
      const gate = status === 'approved' ? 'approved'
        : status === 'none' || status === 'incomplete' ? 'onboarding'
          : 'status';
      setState({ gate, seller, identity: identity.profile, limits: body.limits || null, errorMessage: null });
    } catch (error) {
      if (!stillCurrent()) return;
      const message = error?.message || 'Unable to verify your seller session. Check your connection.';
      // A failed background refresh keeps an approved seller in the panel with the last confirmed profile.
      // Every protected API call is still authorized by the server.
      setState((previous) => (previous.gate === 'approved' && previous.seller
        ? { ...previous, errorMessage: message }
        : { ...previous, gate: 'verifyError', errorMessage: message }));
    }
  }, [endSession]);

  // Load the stored session once at start-up.
  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await readSessionToken();
      if (!active) return;
      tokenRef.current = stored;
      setApiToken(stored);
      if (stored) loadStatus(); else setState(SIGNED_OUT);
    })();
    return () => { active = false; };
  }, [loadStatus]);

  // Any 401 on a protected call means the token expired or was revoked.
  useEffect(() => {
    setUnauthorizedHandler(() => { endSession(); });
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  const completeOtpLogin = useCallback(async (phone, otp, intent) => {
    const result = await verifySellerOtp(phone, otp, intent);
    if (!result?.success || !result.token || result.sessionRole !== 'seller') {
      throw new ApiError(result?.message || 'Sign-in could not be confirmed. Please retry.');
    }
    await saveSessionToken(result.token);
    tokenRef.current = result.token;
    setApiToken(result.token);
    intentRef.current = intent === 'register' ? 'register' : 'login';
    await loadStatus(intentRef.current);
  }, [loadStatus]);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    // Remove this device's push token for the seller session first (keeps the on/off preference for next sign-in).
    try { await deregisterPush(token); } catch { /* Local sign-out must not depend on the network. */ }
    if (token) { try { await logoutSession(token); } catch { /* Local sign-out must not depend on the network. */ } }
    await endSession();
  }, [endSession]);

  const refreshSeller = useCallback(() => loadStatus(), [loadStatus]);

  const value = useMemo(() => ({
    ...state,
    sellerId: state.seller?._id || state.seller?.id || null,
    salesChannels: Array.isArray(state.seller?.salesChannels) ? state.seller.salesChannels : [],
    completeOtpLogin,
    signOut,
    retry: () => loadStatus(),
    refreshSeller,
    setIntent: (intent) => { intentRef.current = intent === 'register' ? 'register' : 'login'; },
  }), [state, completeOtpLogin, signOut, loadStatus, refreshSeller]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
