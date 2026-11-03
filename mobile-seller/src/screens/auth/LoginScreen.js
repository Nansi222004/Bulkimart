import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Image, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { sendSellerOtp } from '../../services/auth.api';
import { isValidIndianMobile, normalizePhoneInput } from '../../utils/phone';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/pages/SellerLoginPage.jsx (phone OTP, login or register intent).
const RESEND_SECONDS = 30;

export default function LoginScreen() {
  const { completeOtpLogin, setIntent } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [noSellerFound, setNoSellerFound] = useState(false);
  const otpRef = useRef(null);

  useEffect(() => {
    if (timer <= 0) return undefined;
    const id = setTimeout(() => setTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  const digits = normalizePhoneInput(phone);
  const isRegister = mode === 'register';

  const switchMode = (next) => {
    setMode(next); setIntent(next); setError(''); setInfo(''); setNoSellerFound(false);
    setOtpSent(false); setOtp(''); setTimer(0);
  };

  const handleSend = async () => {
    setError(''); setInfo(''); setNoSellerFound(false);
    if (!isValidIndianMobile(digits)) { setError('Please enter a valid 10-digit mobile number.'); return; }
    setBusy(true);
    try {
      const body = await sendSellerOtp(digits, mode);
      setOtpSent(true); setTimer(RESEND_SECONDS); setOtp('');
      // Mock OTP mode on the server returns the code for testing (same as the web panel).
      setInfo(body?.otp ? `OTP sent. Test code: ${body.otp}` : 'OTP sent to your mobile.');
      setTimeout(() => otpRef.current?.focus(), 150);
    } catch (e) {
      if (mode === 'login' && (e.code === 'SELLER_NOT_FOUND' || e.code === 'NOT_A_MEMBER')) { setNoSellerFound(true); return; }
      setError(e.message || 'Could not send OTP.');
      if (e.code === 'SELLER_EXISTS') { setMode('login'); setIntent('login'); }
    } finally { setBusy(false); }
  };

  const handleVerify = async () => {
    setError('');
    if (!/^\d{4,6}$/.test(otp)) { setError('Enter the OTP sent to your mobile.'); return; }
    setBusy(true);
    try {
      await completeOtpLogin(digits, otp, mode);
    } catch (e) {
      setError(e.message || 'OTP verification failed.');
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

      <View style={styles.modeRow} accessibilityRole="tablist">
        {['login', 'register'].map((value) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }}
            onPress={() => !busy && switchMode(value)} style={[styles.modeButton, mode === value && styles.modeActive]}>
            <Text style={[styles.modeText, mode === value && styles.modeTextActive]}>{value === 'login' ? 'Sign in' : 'Register store'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <AppInput label="Mobile number" placeholder="10-digit mobile number" keyboardType="phone-pad" maxLength={10}
          value={phone} onChangeText={(text) => setPhone(text.replace(/\D/g, ''))} editable={!otpSent && !busy}
          autoComplete="tel" textContentType="telephoneNumber" />

        {otpSent ? (
          <>
            <AppInput ref={otpRef} label="OTP" placeholder="Enter OTP" keyboardType="number-pad" maxLength={6}
              value={otp} onChangeText={(text) => setOtp(text.replace(/\D/g, ''))} editable={!busy}
              autoComplete="sms-otp" textContentType="oneTimeCode" />
            <AppButton title={isRegister ? 'Verify & continue' : 'Verify & sign in'} onPress={handleVerify} loading={busy} />
            <View style={styles.linkRow}>
              <AppButton small variant="ghost" title={timer > 0 ? `Resend OTP in ${timer}s` : 'Resend OTP'} disabled={timer > 0 || busy} onPress={handleSend} />
              <AppButton small variant="ghost" title="Change number" disabled={busy} onPress={() => { setOtpSent(false); setOtp(''); setTimer(0); setInfo(''); }} />
            </View>
          </>
        ) : (
          <AppButton title="Send OTP" onPress={handleSend} loading={busy} />
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
  brand: { fontSize: 30, fontWeight: '900', color: colors.deepBlue },
  accent: { color: colors.orange },
  center: { textAlign: 'center' },
  modeRow: { flexDirection: 'row', backgroundColor: colors.aquaLight, borderRadius: radius.pill, padding: 4 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  modeActive: { backgroundColor: colors.white },
  modeText: { fontWeight: '700', color: colors.textSecondary },
  modeTextActive: { color: colors.primaryDark },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  noSeller: { gap: spacing.sm },
});
