import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, type } from '../../theme';

// Same as the "No seller account found" block in frontend/src/modules/Seller/routes/index.jsx.
export default function NoSellerAccountScreen() {
  const { signOut } = useAuth();
  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji} accessible={false}>🔍</Text>
      <Text style={type.title}>No seller account found</Text>
      <Text style={[type.small, styles.center]}>This mobile number is not registered as a seller on Bulkimart yet.</Text>
      <Text style={[type.small, styles.center]}>Sign out, then choose “Register store” on the sign-in screen to start registration.</Text>
      <AppButton title="Use a different number" variant="outline" onPress={signOut} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  emoji: { fontSize: 44 },
  center: { textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: spacing.lg },
});
