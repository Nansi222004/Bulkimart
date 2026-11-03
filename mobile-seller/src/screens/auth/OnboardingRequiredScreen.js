import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, type } from '../../theme';

// Stage 1 limitation, stated plainly: native onboarding (4 steps with KYC and bank
// document uploads) arrives in Stage 3. Until then registration is finished on the web panel.
export default function OnboardingRequiredScreen() {
  const { retry, signOut } = useAuth();
  return (
    <View style={styles.wrap}>
      <Text style={type.title}>Finish your store registration</Text>
      <Text style={[type.body, styles.text]}>
        Your seller registration is not complete yet. Complete the business details, KYC documents and bank details, then submit your application for review.
      </Text>
      <InlineNotice tone="info">
        Registration is not available in this version of the app yet. Complete it on the Bulkimart seller website with the same mobile number, then tap “Check again”.
      </InlineNotice>
      <AppButton title="Open seller website" variant="accent" onPress={() => Linking.openURL('https://bulkimart.in/seller')} />
      <AppButton title="Check again" variant="outline" onPress={retry} />
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md, backgroundColor: colors.background },
  text: { lineHeight: 21 },
});
