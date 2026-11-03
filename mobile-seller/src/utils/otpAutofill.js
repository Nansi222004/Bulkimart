/**
 * JS side of the native BulkimartOtpAutofill module
 * (android/app/src/main/java/.../otp/OtpAutofillModule.kt).
 *
 * - pickPhoneNumber(): Google Phone Number Hint picker (user consent, no permission).
 * - useSmsOtpListener(): SMS Retriever autofill (no SMS permission).
 * - getAppHash(): this install's SMS Retriever hash, sent with send-otp so the
 *   server can end the SMS with it.
 *
 * Everything degrades to manual entry: iOS, no Play services, no SIM, or a
 * build without the native module. OTP values are never logged.
 *
 * Keep identical in mobile-user, mobile-seller and mobile-delivery.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

const Native = Platform.OS === 'android' ? NativeModules.BulkimartOtpAutofill ?? null : null;
const EVENT_CODE = 'BulkimartOtpAutofill:code';
const EVENT_TIMEOUT = 'BulkimartOtpAutofill:timeout';

let hashPromise = null;
/** The 11-character SMS Retriever hash, or null when unavailable. Cached. */
export function getAppHash() {
  if (!Native) return Promise.resolve(null);
  if (!hashPromise) {
    hashPromise = Native.getAppHash()
      .then((hash) => (typeof hash === 'string' && /^[A-Za-z0-9+/]{11}$/.test(hash) ? hash : null))
      .catch(() => null);
  }
  return hashPromise;
}

/** Whether the phone number picker / SMS autofill can work on this device. */
export function useOtpAutofillSupport() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    if (Native) Native.isSupported().then((ok) => alive && setSupported(!!ok)).catch(() => {});
    return () => { alive = false; };
  }, []);
  return supported;
}

/** "+91 98765 43210" / "919876543210" / "09876543210" → "9876543210"; null if not an Indian mobile. */
export function toIndianMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  if (/^0?[6-9]\d{9}$/.test(digits)) return digits.slice(-10);
  return null;
}

const PICKER_ERRORS = {
  E_NO_HINT: 'No phone number was found on this device. Please type your number.',
  E_UNAVAILABLE: 'Number suggestions need Google Play services. Please type your number.',
};

/**
 * Opens the system phone number picker.
 * Resolves { phone } | { cancelled: true } | { error }.
 */
export async function pickPhoneNumber() {
  if (!Native) return { error: 'Number suggestions are not available on this device. Please type your number.' };
  try {
    const number = await Native.requestPhoneNumber();
    if (!number) return { cancelled: true };
    const phone = toIndianMobile(number);
    return phone ? { phone } : { error: 'Only Indian (+91) mobile numbers are supported. Please type your number.' };
  } catch (error) {
    if (error?.code === 'E_IN_PROGRESS') return { cancelled: true };
    return { error: PICKER_ERRORS[error?.code] || 'Could not open the number picker. Please type your number.' };
  }
}

/**
 * Phone number hint for a login field: `pick()` on the button, and
 * `onFieldFocus()` offers the picker once when the user first focuses an
 * empty field (Google's recommended moment). Nothing opens without a tap.
 */
export function usePhoneNumberHint({ onPhone, onError }) {
  const supported = useOtpAutofillSupport();
  const [picking, setPicking] = useState(false);
  const offered = useRef(false);
  const handlers = useRef({ onPhone, onError });
  handlers.current = { onPhone, onError };

  const pick = useCallback(async () => {
    if (picking) return;
    offered.current = true;
    setPicking(true);
    const result = await pickPhoneNumber();
    setPicking(false);
    if (result.phone) handlers.current.onPhone?.(result.phone);
    else if (result.error) handlers.current.onError?.(result.error);
  }, [picking]);

  const onFieldFocus = useCallback((currentValue) => {
    if (!supported || offered.current || String(currentValue || '').length) return;
    pick();
  }, [supported, pick]);

  return { supported, picking, pick, onFieldFocus };
}

/**
 * SMS Retriever session. Call `start()` right before requesting an OTP
 * (and again on resend); `onCode(code)` fires once if the SMS arrives within
 * 5 minutes. The caller fills the input — it must not auto-submit.
 */
export function useSmsOtpListener(onCode) {
  const [listening, setListening] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!Native) return undefined;
    const codeSub = DeviceEventEmitter.addListener(EVENT_CODE, (event) => {
      setListening(false);
      const code = typeof event?.code === 'string' ? event.code.replace(/\D/g, '') : '';
      if (code) onCodeRef.current?.(code);
    });
    const timeoutSub = DeviceEventEmitter.addListener(EVENT_TIMEOUT, () => setListening(false));
    return () => {
      codeSub.remove();
      timeoutSub.remove();
      Native.stopSmsListener();
    };
  }, []);

  const start = useCallback(async () => {
    if (!Native) return false;
    const ok = await Native.startSmsListener().catch(() => false);
    setListening(!!ok);
    return !!ok;
  }, []);

  const stop = useCallback(() => {
    if (Native) Native.stopSmsListener();
    setListening(false);
  }, []);

  return { listening, start, stop };
}

/** User-facing text for an OTP send/verify failure ({ code, message } from the API). */
export function describeOtpError(error, fallback = 'Something went wrong. Please try again.') {
  switch (error?.code) {
    case 'OTP_INVALID': return 'Incorrect OTP. Please check the code and try again.';
    case 'OTP_EXPIRED': return 'This OTP has expired. Tap "Resend OTP" to get a new code.';
    case 'OTP_NOT_FOUND': return 'This OTP is no longer valid. Tap "Resend OTP" to get a new code.';
    case 'OTP_ATTEMPTS_EXCEEDED': return 'Too many incorrect attempts. Tap "Resend OTP" to get a new code.';
    case 'NETWORK':
    case 'TIMEOUT': return 'Network error. Check your internet connection and try again.';
    default: return error?.message || fallback;
  }
}

/** True when the entered code can no longer succeed and should be cleared. */
export const isDeadOtpError = (error) => ['OTP_EXPIRED', 'OTP_NOT_FOUND', 'OTP_ATTEMPTS_EXCEEDED'].includes(error?.code);
