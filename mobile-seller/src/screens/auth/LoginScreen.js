import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Image, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import OtpCodeInput from '../../components/OtpCodeInput';
import PhoneNumberField from '../../components/PhoneNumberField';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { sendSellerOtp } from '../../services/auth.api';
import { isValidIndianMobile, normalizePhoneInput } from '../../utils/phone';
import { describeOtpError, isDeadOtpError, usePhoneNumberHint, useSmsOtpListener } from '../../utils/otpAutofill';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/pages/SellerLoginPage.jsx (phone OTP, login or register intent).
// Phone Number Hint prefills the number; SMS Retriever prefills the OTP. Neither
// signs anyone in: the seller still taps Verify and the server checks the code.
const DEFAULT_RESEND_SECONDS = 30;
const DEFAULT_OTP_LENGTH = 6;

export default function LoginScreen() {
  const { completeOtpLogin, setIntent } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLength, setOtpLength] = useState(DEFAULT_OTP_LENGTH);
  const [otpSent, setOtpSent] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [info, setInfo] = useState('');
  const [autofilled, setAutofilled] = useState(false);
  const [noSellerFound, setNoSellerFound] = useState(false);
  const otpRef = useRef(null);

  // Countdown from an absolute deadline so it stays right after the app is backgrounded.
  useEffect(() => {
    if (!resendAt) return undefined;
    const tick = () => setTimer(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => { clearInterval(id); sub.remove(); };
  }, [resendAt]);

  const sms = useSmsOtpListener(useCallback((code) => {
    setOtp(code.slice(0, otpLength)); setAutofilled(true); setOtpError('');
  }, [otpLength]));

  const hint = usePhoneNumberHint({
    onPhone: (picked) => { setPhone(picked); setError(''); },
    onError: (message) => setError(message),
  });

  const digits = normalizePhoneInput(phone);
  const isRegister = mode === 'register';

  const resetOtpStep = () => {
    sms.stop(); setOtpSent(false); setOtp(''); setResendAt(0); setTimer(0); setInfo(''); setOtpError(''); setAutofilled(false);
  };

  const switchMode = (next) => {
    setMode(next); setIntent(next); setError(''); setNoSellerFound(false);
    resetOtpStep();
  };

  const handleSend = async () => {
    if (busy) return;
    setError(''); setOtpError(''); setInfo(''); setNoSellerFound(false);
    if (!isValidIndianMobile(digits)) { setError('Please enter a valid 10-digit mobile number.'); return; }
    setBusy(true);
    // Listen before the SMS can arrive; a failed send stops it again.
    await sms.start();
    try {
      const body = await sendSellerOtp(digits, mode);
      const length = Number(body?.otpLength) || DEFAULT_OTP_LENGTH;
      setOtpLength(length);
      setOtpSent(true); setOtp(''); setAutofilled(false);
      setResendAt(Date.now() + (Number(body?.resendAfter) || DEFAULT_RESEND_SECONDS) * 1000);
      // Mock OTP mode on the server returns the code for testing (same as the web panel).
      setInfo(body?.otp ? `OTP sent. Test code: ${body.otp}` : `OTP sent to +91 ${digits}.`);
      setTimeout(() => otpRef.current?.focus(), 150);
    } catch (e) {
      sms.stop();
      if (mode === 'login' && (e.code === 'SELLER_NOT_FOUND' || e.code === 'NOT_A_MEMBER')) { setNoSellerFound(true); return; }
      const retryAfter = Number(e.body?.meta?.retryAfter);
      if ((e.code === 'OTP_COOLDOWN') && retryAfter > 0) setResendAt(Date.now() + retryAfter * 1000);
      (otpSent ? setOtpError : setError)(describeOtpError(e, 'Could not send OTP.'));
      if (e.code === 'SELLER_EXISTS') { setMode('login'); setIntent('login'); }
    } finally { setBusy(false); }
  };

  const handleVerify = async () => {
    if (busy) return;
    setOtpError('');
    if (otp.length !== otpLength) { setOtpError(`Enter the ${otpLength}-digit OTP sent to your mobile.`); return; }
    setBusy(true);
    try {
      await completeOtpLogin(digits, otp, mode);
      sms.stop();
    } catch (e) {
      setOtpError(describeOtpError(e, 'OTP verification failed.'));
      if (isDeadOtpError(e)) { setOtp(''); setAutofilled(false); }
    } finally { setBusy(false); }
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.hero}>
        <Image source={require('../../assets/seller-logo.png')} style={styles.logo} accessibilityLabel="Bulkimart Seller" />
        <Text style={[type.small, styles.center]}>
          {isRegister ? 'Register your store with your mobile number.' : 'Sign in with the mobile number you registered your store with.'}
        </Text>
      </View>

      {!otpSent ? (
        <View style={styles.modeRow} accessibilityRole="tablist">
          {['login', 'register'].map((value) => (
            <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }}
              onPress={() => !busy && switchMode(value)} style={[styles.modeButton, mode === value && styles.modeActive]}>
              <Text style={[styles.modeText, mode === value && styles.modeTextActive]}>{value === 'login' ? 'Sign in' : 'Register store'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        {!otpSent ? (
          <>
            <PhoneNumberField value={phone} onChangeText={(v) => { setPhone(v); setError(''); }} editable={!busy}
              onFocus={() => hint.onFieldFocus(phone)} onPickNumber={hint.pick} canPick={hint.supported} picking={hint.picking}
              onSubmitEditing={handleSend} />
            <AppButton title="Continue" onPress={handleSend} loading={busy} />
          </>
        ) : (
          <>
            <View style={styles.otpHead}>
              <Text style={type.label}>Enter the {otpLength}-digit OTP</Text>
              <Text style={type.small}>Sent to +91 {digits}</Text>
            </View>
            <OtpCodeInput ref={otpRef} value={otp} length={otpLength} autoFocus editable={!busy} error={!!otpError}
              onChange={(v) => { setOtp(v); setOtpError(''); setAutofilled(false); }} onSubmitEditing={handleVerify}
              accentColor={colors.primaryDark} textColor={colors.text} borderColor={colors.border} errorColor={colors.error} />
            {otpError ? <Text style={styles.otpError} accessibilityRole="alert">{otpError}</Text>
              : autofilled ? <Text style={styles.otpHint}>Code filled from SMS. Tap Verify to continue.</Text>
                : sms.listening ? <Text style={styles.otpHint}>Waiting for the SMS… you can also type the code.</Text> : null}
            <AppButton title={isRegister ? 'Verify & continue' : 'Verify & sign in'} onPress={handleVerify} loading={busy} />
            <View style={styles.linkRow}>
              <AppButton small variant="ghost" title="Change number" disabled={busy} onPress={resetOtpStep} />
              <AppButton small variant="ghost" title={timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'} disabled={timer > 0 || busy} onPress={handleSend} />
            </View>
          </>
        )}

        {info ? <InlineNotice tone="success">{info}</InlineNotice> : null}
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {noSellerFound ? (
          <View style={styles.noSeller}>
            <InlineNotice tone="warning">No seller account found with this mobile number.</InlineNotice>
            <AppButton title="Register my store" variant="accent" onPress={() => switchMode('register')} />
          </View>
        ) : null}
        {isRegister ? (
          <Text style={type.small}>Registering creates your Bulkimart account for this number. Read the seller registration terms on bulkimart.in before you continue.</Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  logo: { width: 200, height: 200, borderRadius: 24 },
  center: { textAlign: 'center' },
  modeRow: { flexDirection: 'row', backgroundColor: colors.aquaLight, borderRadius: radius.pill, padding: 4 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  modeActive: { backgroundColor: colors.white },
  modeText: { fontWeight: '700', color: colors.textSecondary },
  modeTextActive: { color: colors.primaryDark },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  otpHead: { gap: 2 },
  otpError: { fontSize: 12, color: colors.error, textAlign: 'center' },
  otpHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  noSeller: { gap: spacing.sm },
});
