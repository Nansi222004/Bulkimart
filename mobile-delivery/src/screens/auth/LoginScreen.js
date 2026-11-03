import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { sendLoginOtp } from '../../services/delivery.api';
import { isValidPhone } from '../../utils/riderDocuments';
import { API_CONFIGURED } from '../../config/env';
import { colors, radius, spacing, type } from '../../theme';

const RESEND_SECONDS = 30; // same countdown as the web DeliveryAuthPage

/**
 * Phone + OTP sign-in for delivery partners (POST /api/auth/delivery/send-otp and /verify-otp).
 * "Register" creates only an incomplete application; approval always comes from an admin.
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const isRegister = mode === 'register';

  useEffect(() => {
    if (timer <= 0) return undefined;
    const t = setTimeout(() => setTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const send = async () => {
    if (!isValidPhone(phone)) { setMessage({ tone: 'error', text: 'Enter a valid 10-digit mobile number.' }); return; }
    if (isRegister && name.trim().length < 2) { setMessage({ tone: 'error', text: 'Enter your full name.' }); return; }
    setBusy(true); setMessage(null);
    try {
      const body = await sendLoginOtp(phone, mode);
      setOtpSent(true); setTimer(RESEND_SECONDS); setOtp('');
      // The server returns a code only in its mock OTP mode. Shown in debug (staging) builds only.
      const testCode = __DEV__ && body?.otp ? ` Test code: ${body.otp}` : '';
      setMessage({ tone: 'success', text: `OTP sent to +91 ${phone}.${testCode}` });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message || 'Could not send OTP' });
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!/^\d{4,6}$/.test(otp)) { setMessage({ tone: 'error', text: 'Enter the OTP sent to your phone.' }); return; }
    setBusy(true); setMessage(null);
    const result = await signIn({ phone, otp, intent: mode, name: isRegister ? name.trim() : undefined });
    setBusy(false);
    if (!result.ok) setMessage({ tone: 'error', text: result.message });
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
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setMessage(null); }}
              style={[styles.tab, mode === m && styles.tabActive]}>
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>{m === 'login' ? 'Sign in' : 'Register'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!otpSent ? (
        <View style={styles.form}>
          {isRegister ? <AppInput label="Full name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" required /> : null}
          <AppInput label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad" maxLength={10} placeholder="10-digit number" autoComplete="tel" required />
          <AppButton title={isRegister ? 'Send OTP to register' : 'Send OTP'} onPress={send} loading={busy} disabled={!API_CONFIGURED} />
          {isRegister ? <Text style={type.small}>Registering creates an application. You can deliver after Bulkimart verifies your documents.</Text> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={type.body}>Enter the OTP sent to +91 {phone}</Text>
          <AppInput label="OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
            autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} style={styles.otp} autoFocus />
          <AppButton title={isRegister ? 'Verify and continue' : 'Verify and sign in'} onPress={verify} loading={busy} />
          <View style={styles.row}>
            <AppButton small variant="ghost" title={timer > 0 ? `Resend in ${timer}s` : 'Resend OTP'} disabled={timer > 0 || busy} onPress={send} />
            <AppButton small variant="ghost" title="Change number" disabled={busy} onPress={() => { setOtpSent(false); setOtp(''); setMessage(null); setTimer(0); }} />
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
  otp: { },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
