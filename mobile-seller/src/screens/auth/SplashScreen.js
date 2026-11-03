import React from 'react';
import { ActivityIndicator, StyleSheet, Image, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useAuth } from '../../context/AuthContext';
import AppButton from '../../components/AppButton';
import { colors, spacing, type } from '../../theme';

// Shown while the stored session is checked (gate 'loading') or when the check failed ('verifyError').
export default function SplashScreen() {
  const { gate, errorMessage, retry, signOut } = useAuth();
  return (
    <View style={styles.wrap}>
      {/* Logo sits in the exact centre of the screen; status/loader is pinned to the bottom so it can't push the logo up. */}
      <View style={styles.center}>
        <Image source={require('../../assets/seller-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Bulkimart Seller" />
      </View>
      {gate === 'verifyError' ? (
        <View style={styles.box}>
          <Text style={[type.body, styles.text]} accessibilityRole="alert">
            {errorMessage || 'Unable to verify your seller session. Check your connection.'}
          </Text>
          <AppButton title="Retry verification" onPress={retry} />
          <AppButton title="Sign out" variant="ghost" onPress={signOut} />
        </View>
      ) : (
        <View style={styles.box}>
          <ActivityIndicator size="large" color={colors.primaryDark} />
          <Text style={[type.small, styles.text]}>Checking your seller account…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // White matches the logo artwork's own background, so no visible box appears around it.
  wrap: { flex: 1, backgroundColor: colors.white },
  // Explicit edges: StyleSheet.absoluteFillObject no longer exists in RN 0.88.
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 220, height: 220 },
  brand: { fontSize: 30, fontWeight: '900', color: colors.deepBlue },
  accent: { color: colors.orange },
  box: { position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: spacing.xxl * 2, gap: spacing.md, alignItems: 'stretch' },
  text: { textAlign: 'center' },
});
