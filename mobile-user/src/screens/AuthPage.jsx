// Port of modules/User/pages/AuthPage.jsx — customer Sign In / Register with phone OTP.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { Text } from '../components/ui';
import { ArrowRight } from '../components/icons';
import RegistrationTerms from '../components/RegistrationTerms';

const logo = require('../../assets/images/Bulkimart-logo-transparent.png');

function Input({ label, error, ...props }) {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    <Text style={styles.label}>{label}</Text>
    <TextInput placeholderTextColor="#94a3b8" {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.input, focused && { borderColor: theme.primary }, error && { borderColor: '#ef4444', backgroundColor: '#fef2f2' }]} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

export default function AuthPage() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { sendOtp, verifyOtp, updateUserProfile, setActiveNav } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [step, setStep] = useState('phone');
  const [enteredOtp, setEnteredOtp] = useState('');
  const [resendDeadline, setResendDeadline] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRequest = useRef(false);
  const [phone, setPhone] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState(''), [agreeTerms, setAgreeTerms] = useState(false);
  const slider = useRef(new Animated.Value(0)).current;
  const [tabWidth, setTabWidth] = useState(0);
  useEffect(() => { Animated.timing(slider, { toValue: isLogin ? 0 : 1, duration: 280, useNativeDriver: true }).start(); }, [isLogin, slider]);

  useEffect(() => {
    if (step !== 'otp' || !resendDeadline) return undefined;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [step, resendDeadline]);

  const validatePhone = () => {
    const next = {};
    if (!phone.trim()) next.phone = 'Phone number is required';
    else if (phone.trim().length !== 10 || !/^\d+$/.test(phone)) next.phone = 'Phone number must be exactly 10 digits';
    if (!isLogin) {
      if (!name.trim()) next.name = 'Full name is required';
      if (!email.trim()) next.email = 'Email address is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Invalid email address format';
      if (!agreeTerms) next.terms = 'You must agree to the Terms & Conditions';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSendOTP = async () => {
    if (otpRequest.current || isLoading || (step === 'otp' && Date.now() < resendDeadline)) return;
    if (!validatePhone()) return;
    otpRequest.current = true; setIsLoading(true); setErrors({}); setSuccessMessage('');
    try {
      const result = await sendOtp(phone.trim(), isLogin);
      if (result.success) {
        setStep('otp'); setEnteredOtp(''); setResendDeadline(Date.now() + 30000); setResendSeconds(30);
        setSuccessMessage('OTP sent successfully to your mobile number.');
      } else setErrors({ api: result.message || 'Failed to send OTP.' });
    } catch (error) {
      setErrors({ api: error.message || 'Failed to send OTP.' });
    } finally { otpRequest.current = false; setIsLoading(false); }
  };

  const handleVerifyOTP = async () => {
    if (isLoading) return;
    if (!enteredOtp || enteredOtp.trim().length !== 4) { setErrors({ otp: 'Please enter a valid 4-digit OTP' }); return; }
    setIsLoading(true); setErrors({});
    const result = await verifyOtp(phone.trim(), enteredOtp.trim(), isLogin, name.trim(), email.trim());
    if (result.success) {
      if (!isLogin && (name.trim() || email.trim())) await updateUserProfile(name.trim(), email.trim());
      setIsLoading(false);
    } else { setIsLoading(false); setErrors({ otp: result.message || 'OTP verification failed' }); }
  };

  const backToPhone = () => { if (isLoading) return; setStep('phone'); setEnteredOtp(''); setResendDeadline(0); setResendSeconds(0); setErrors({}); setSuccessMessage(''); };
  const switchTab = login => { setIsLogin(login); setErrors({}); setPhone(''); setName(''); setEmail(''); setAgreeTerms(false); };
  const submitColors = theme.action ? [theme.action, theme.action] : ['#08b9e8', '#078ccb'];

  return <LinearGradient colors={[theme.highlight || '#FFF0B3', '#ffffff', '#fff3e5']} locations={[0, 0.52, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.blob, { width: 300, height: 300, top: -50, left: -50, backgroundColor: 'rgba(8,185,232,0.18)' }]} />
      <View style={[styles.blob, { width: 350, height: 350, bottom: -80, right: -50, backgroundColor: 'rgba(255,133,0,0.18)' }]} />
    </View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.container, { paddingTop: Math.max(20, insets.top + 12), paddingBottom: Math.max(20, insets.bottom + 12) }]}>
        <View style={styles.card}>
          {isLoading && <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={theme.action} /><Text style={[styles.loadingText, { color: theme.action }]}>{step === 'phone' ? 'Sending OTP...' : 'Verifying OTP...'}</Text></View>}
          <View style={styles.brand}><Image source={logo} style={{ width: 194, height: 154 }} contentFit="contain" accessibilityLabel="Bulkimart — Sabse Smart Bulkimart" /></View>
          {step === 'phone' && <View style={styles.tabs} onLayout={e => setTabWidth((e.nativeEvent.layout.width - 10) / 2)}>
            <Animated.View style={[styles.tabBg, { width: tabWidth, transform: [{ translateX: slider.interpolate({ inputRange: [0, 1], outputRange: [0, tabWidth] }) }] }]} />
            {[['Sign In', true], ['Register', false]].map(([label, login]) => <Pressable key={label} disabled={isLoading} onPress={() => switchTab(login)} style={styles.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: isLogin === login }}>
              <Text style={[styles.tabText, isLogin === login && { color: theme.action }]}>{label}</Text>
            </Pressable>)}
          </View>}
          {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}
          {errors.api ? <Text style={styles.apiError} accessibilityRole="alert">{errors.api}</Text> : null}
          {step === 'phone' ? <View style={{ gap: 16 }}>
            {!isLogin && <>
              <Input label="FULL NAME" placeholder="e.g. Rahul Sharma" value={name} onChangeText={setName} error={errors.name} autoComplete="name" textContentType="name" />
              <Input label="EMAIL ADDRESS" placeholder="email@example.com" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            </>}
            <Input label="PHONE NUMBER" placeholder="10-digit mobile number" value={phone} onChangeText={value => setPhone(value.replace(/\D/g, '').slice(0, 10))} error={errors.phone}
              keyboardType="phone-pad" maxLength={10} autoComplete="tel" returnKeyType="done" onSubmitEditing={handleSendOTP} />
            {!isLogin && <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable onPress={() => setAgreeTerms(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: agreeTerms }} accessibilityLabel="I agree to the Terms & Conditions" hitSlop={8}
                  style={[styles.checkbox, agreeTerms && { backgroundColor: theme.action, borderColor: theme.action }, errors.terms && { borderColor: '#ef4444' }]}>
                  {agreeTerms && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>}
                </Pressable>
                <Text style={{ fontSize: 13, color: '#475569', flexShrink: 1 }}>I agree to the <RegistrationTerms audience="user" /></Text>
              </View>
              {errors.terms ? <Text style={styles.error}>{errors.terms}</Text> : null}
            </View>}
            <Pressable disabled={isLoading} onPress={handleSendOTP} accessibilityRole="button">
              <LinearGradient colors={submitColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submit}><Text style={styles.submitText}>Send OTP Verification</Text></LinearGradient>
            </Pressable>
          </View> : <View style={{ gap: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={[styles.label, { textAlign: 'center' }]}>Enter 4-Digit OTP sent to +91 {phone}</Text>
              <TextInput value={enteredOtp} onChangeText={value => setEnteredOtp(value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" placeholderTextColor="#94a3b8"
                keyboardType="number-pad" maxLength={4} autoComplete="sms-otp" textContentType="oneTimeCode" autoFocus onSubmitEditing={handleVerifyOTP}
                style={[styles.otp, errors.otp && { borderColor: '#ef4444' }]} accessibilityLabel="One-time password" />
              {errors.otp ? <Text style={[styles.error, { textAlign: 'center' }]} accessibilityRole="alert">{errors.otp}</Text> : null}
            </View>
            <Pressable disabled={isLoading} onPress={handleVerifyOTP} accessibilityRole="button">
              <LinearGradient colors={submitColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submit}><Text style={styles.submitText}>{isLogin ? 'Verify & Sign In' : 'Verify & Register'}</Text></LinearGradient>
            </Pressable>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
              <Pressable onPress={backToPhone} disabled={isLoading}><Text style={[styles.link, { color: '#94a3b8' }]}>← Back to Phone</Text></Pressable>
              <Pressable onPress={handleSendOTP} disabled={isLoading || resendSeconds > 0}><Text style={[styles.link, { color: theme.primary, opacity: isLoading || resendSeconds > 0 ? 0.5 : 1 }]}>{resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : 'Resend OTP'}</Text></Pressable>
            </View>
          </View>}
          <View style={{ marginTop: 20, alignItems: 'center' }}>
            <Pressable onPress={() => setActiveNav('home')} style={styles.guest} accessibilityRole="button">
              <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '700' }}>Continue as Guest</Text>
              <ArrowRight size={14} color="#64748b" width={2.5} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  blob: { position: 'absolute', borderRadius: 999 },
  card: { width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 24, paddingVertical: 32, paddingHorizontal: 28, elevation: 10, shadowColor: '#073b78', shadowOpacity: 0.24, shadowRadius: 30, shadowOffset: { width: 0, height: 24 } },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.85)', zIndex: 100, borderRadius: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  brand: { alignItems: 'center', marginBottom: 24 },
  tabs: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 4, marginBottom: 24, borderWidth: 1, borderColor: '#e2e8f0' },
  tabBg: { position: 'absolute', top: 4, bottom: 4, left: 4, backgroundColor: '#fff', borderRadius: 8, elevation: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', zIndex: 2 },
  tabText: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  label: { fontSize: 11, fontWeight: '700', color: '#475569', letterSpacing: 0.25 },
  input: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#cbd5e1', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, fontSize: 14, color: '#0f172a' },
  error: { fontSize: 11, color: '#ef4444', fontWeight: '600', marginTop: 2 },
  success: { backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)', borderRadius: 10, padding: 12, color: '#059669', fontSize: 13, marginBottom: 16, textAlign: 'center', overflow: 'hidden' },
  apiError: { backgroundColor: 'rgba(239,68,68,0.15)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 10, padding: 12, color: '#dc2626', fontSize: 13, marginBottom: 16, textAlign: 'center', overflow: 'hidden' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  submit: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4, elevation: 4 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  otp: { fontSize: 26, letterSpacing: 10, textAlign: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#cbd5e1', backgroundColor: '#fff', color: '#0f172a', width: 210, marginVertical: 12, fontVariant: ['tabular-nums'] },
  link: { fontSize: 12.5, fontWeight: '700' },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
});
