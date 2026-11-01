import React from 'react';
import { ActivityIndicator, StyleSheet, Image, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import AppButton from '../../components/AppButton';
import { colors, spacing, type } from '../../theme';

// Shown while the stored session is checked (gate 'loading') or when the check failed ('verifyError').
export default function SplashScreen() {
  const { gate, errorMessage, retry, signOut } = useAuth();
  return (
    <View style={styles.wrap}>
      <Image source={require('../../assets/seller-logo.png')} style={styles.logo} accessibilityLabel="Bulkimart Seller" />
      {gate === 'verifyError' ? (
        <View style={styles.box}>
          <Text style={[type.body, styles.center]} accessibilityRole="alert">
            {errorMessage || 'Unable to verify your seller session. Check your connection.'}
          </Text>
          <AppButton title="Retry verification" onPress={retry} />
          <AppButton title="Sign out" variant="ghost" onPress={signOut} />
        </View>
      ) : (
        <View style={styles.box}>
          <ActivityIndicator size="large" color={colors.primaryDark} />
          <Text style={[type.small, styles.center]}>Checking your seller account…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logo: { width: 200, height: 200, borderRadius: 24 },
  brand: { fontSize: 30, fontWeight: '900', color: colors.deepBlue },
  accent: { color: colors.orange },
  box: { marginTop: spacing.xxl, gap: spacing.md, alignSelf: 'stretch', alignItems: 'stretch' },
  center: { textAlign: 'center' },
});
