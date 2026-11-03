import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import OtpCodeInput from '../../components/OtpCodeInput';
import PhoneNumberField from '../../components/PhoneNumberField';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { sendLoginOtp } from '../../services/delivery.api';
import { isValidPhone } from '../../utils/riderDocuments';
import { describeOtpError, isDeadOtpError, usePhoneNumberHint, useSmsOtpListener } from '../../utils/otpAutofill';
import { API_CONFIGURED } from '../../config/env';
import { colors, radius, spacing, type } from '../../theme';

const DEFAULT_RESEND_SECONDS = 30; // same countdown as the web DeliveryAuthPage
const DEFAULT_OTP_LENGTH = 6;

/**
 * Phone + OTP sign-in for delivery partners (POST /api/auth/delivery/send-otp and /verify-otp).
 * "Register" creates only an incomplete application; approval always comes from an admin.
 * Phone Number Hint prefills the number and SMS Retriever prefills the OTP; the rider
 * still taps Verify and the server checks the code and the partner's status.
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLength, setOtpLength] = useState(DEFAULT_OTP_LENGTH);
  const [otpSent, setOtpSent] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [otpError, setOtpError] = useState('');
  const [autofilled, setAutofilled] = useState(false);
  const otpRef = useRef(null);
  const isRegister = mode === 'register';

  // Countdown from an absolute deadline so it stays right after the app is backgrounded.
  useEffect(() => {
    if (!resendAt) return undefined;
    const tick = () => setTimer(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => { clearInterval(t); sub.remove(); };
  }, [resendAt]);

  const sms = useSmsOtpListener(useCallback((code) => {
    setOtp(code.slice(0, otpLength)); setAutofilled(true); setOtpError('');
  }, [otpLength]));

  const hint = usePhoneNumberHint({
    onPhone: (picked) => { setPhone(picked); setMessage(null); },
    onError: (text) => setMessage({ tone: 'error', text }),
  });

  const changeNumber = () => {
    sms.stop(); setOtpSent(false); setOtp(''); setMessage(null); setOtpError(''); setResendAt(0); setTimer(0); setAutofilled(false);
  };

  const send = async () => {
    if (busy) return;
    if (!isValidPhone(phone)) { setMessage({ tone: 'error', text: 'Enter a valid 10-digit mobile number.' }); return; }
    if (isRegister && name.trim().length < 2) { setMessage({ tone: 'error', text: 'Enter your full name.' }); return; }
    setBusy(true); setMessage(null); setOtpError('');
    // Listen before the SMS can arrive; a failed send stops it again.
    await sms.start();
    try {
      const body = await sendLoginOtp(phone, mode);
      setOtpLength(Number(body?.otpLength) || DEFAULT_OTP_LENGTH);
      setOtpSent(true); setOtp(''); setAutofilled(false);
      setResendAt(Date.now() + (Number(body?.resendAfter) || DEFAULT_RESEND_SECONDS) * 1000);
      // The server returns a code only in its mock OTP mode. Shown in debug (staging) builds only.
      const testCode = __DEV__ && body?.otp ? ` Test code: ${body.otp}` : '';
      setMessage({ tone: 'success', text: `OTP sent to +91 ${phone}.${testCode}` });
      setTimeout(() => otpRef.current?.focus(), 150);
    } catch (e) {
      sms.stop();
      const retryAfter = Number(e.body?.meta?.retryAfter);
      if (e.code === 'OTP_COOLDOWN' && retryAfter > 0) setResendAt(Date.now() + retryAfter * 1000);
      setMessage({ tone: 'error', text: describeOtpError(e, 'Could not send OTP') });
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (busy) return;
    if (otp.length !== otpLength) { setOtpError(`Enter the ${otpLength}-digit OTP sent to your phone.`); return; }
    setBusy(true); setMessage(null); setOtpError('');
    const result = await signIn({ phone, otp, intent: mode, name: isRegister ? name.trim() : undefined });
    setBusy(false);
    if (result.ok) { sms.stop(); return; }
    const code = result.code || '';
    if (code.startsWith('OTP_') || code === 'NETWORK' || code === 'TIMEOUT') {
      setOtpError(describeOtpError(result, 'OTP verification failed'));
      if (isDeadOtpError(result)) { setOtp(''); setAutofilled(false); }
    } else {
      setMessage({ tone: 'error', text: result.message });
    }
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.brand}>
        <Image source={require('../../assets/delivery-logo.png')} style={styles.logoImage} accessibilityLabel="Bulkimart Driver" />
        <Text style={styles.portal}>Delivery Partner</Text>
      </View>

      {!API_CONFIGURED ? (
        <InlineNotice tone="error">
          The server address is not configured (it must be HTTPS), so sign-in is blocked.
        </InlineNotice>
      ) : null}

      {!otpSent ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {['login', 'register'].map((m) => (
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { if (!busy) { setMode(m); setMessage(null); } }}
              style={[styles.tab, mode === m && styles.tabActive]}>
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m === 'login' ? 'Sign in' : 'Register'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!otpSent ? (
        <View style={styles.form}>
          {isRegister ? <AppInput label="Full name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" required /> : null}
          <PhoneNumberField value={phone} onChangeText={(v) => { setPhone(v); setMessage(null); }} editable={!busy}
            onFocus={() => hint.onFieldFocus(phone)} onPickNumber={hint.pick} canPick={hint.supported} picking={hint.picking}
            onSubmitEditing={send} />
          <AppButton title={isRegister ? 'Continue to register' : 'Continue'} onPress={send} loading={busy} disabled={!API_CONFIGURED} />
          {isRegister ? <Text style={type.small}>Registering creates an application. You can deliver after Bulkimart verifies your documents.</Text> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.otpHead}>
            <Text style={type.label}>Enter the {otpLength}-digit OTP</Text>
            <Text style={type.small}>Sent to +91 {phone}</Text>
          </View>
          <OtpCodeInput ref={otpRef} value={otp} length={otpLength} autoFocus editable={!busy} error={!!otpError}
            onChange={(v) => { setOtp(v); setOtpError(''); setAutofilled(false); }} onSubmitEditing={verify}
            accentColor={colors.primaryDark} textColor={colors.text} borderColor={colors.border} errorColor={colors.error} />
          {otpError ? <Text style={styles.otpError} accessibilityRole="alert">{otpError}</Text>
            : autofilled ? <Text style={styles.otpHint}>Code filled from SMS. Tap Verify to continue.</Text>
              : sms.listening ? <Text style={styles.otpHint}>Waiting for the SMS… you can also type the code.</Text> : null}
          <AppButton title={isRegister ? 'Verify and continue' : 'Verify and sign in'} onPress={verify} loading={busy} />
          <View style={styles.row}>
            <AppButton small variant="ghost" title="Change number" disabled={busy} onPress={changeNumber} />
            <AppButton small variant="ghost" title={timer > 0 ? `Resend in ${timer}s` : 'Resend OTP'} disabled={timer > 0 || busy} onPress={send} />
          </View>
        </View>
      )}

      {message ? <InlineNotice tone={message.tone}>{message.text}</InlineNotice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.md },
  logoImage: { width: 180, height: 180, resizeMode: 'contain' },
  portal: { fontSize: 16, fontWeight: '700', color: colors.orangeDark, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: colors.aquaLight, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabActive: { backgroundColor: colors.white, elevation: 2 },
  tabText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  tabTextActive: { color: colors.deepBlue },
  form: { gap: spacing.md },
  otpHead: { gap: 2 },
  otpError: { fontSize: 13, color: colors.error, textAlign: 'center' },
  otpHint: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
