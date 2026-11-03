import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import { InlineNotice, LoadingView } from '../../components/StateViews';
import { useAuth } from '../../context/AuthContext';
import { partnerStatusLabel } from '../../utils/status';
import { colors, spacing, type } from '../../theme';

export function SplashScreen() {
  return (
    <View style={styles.splash}>
      <Image source={require('../../assets/delivery-logo.png')} style={styles.logoImage} accessibilityLabel="Bulkimart Driver" />
      <Text style={styles.portal}>Delivery Partner</Text>
      <LoadingView message="Checking your session…" />
    </View>
  );
}

/** The session could not be verified (network/server). The token is kept; the rider retries. */
export function SessionErrorScreen() {
  const { sessionError, retrySession, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.center}>
      <Text style={type.title}>Can’t reach Bulkimart</Text>
      <InlineNotice tone="error">{sessionError || 'Unable to verify your delivery session.'} Check your connection and retry.</InlineNotice>
      <AppButton title="Retry" loading={busy} onPress={async () => { setBusy(true); await retrySession(); setBusy(false); }} />
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

/**
 * Pending, rejected or suspended applications. Approval is never granted by the app:
 * "Check status" re-reads /api/delivery/me. A rejected rider may fix details and resubmit
 * (the server unlocks editing for 'rejected'); suspended accounts are locked server-side.
 */
export function ApplicationStatusScreen({ navigation }) {
  const { profile, refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const status = profile?.status;
  const check = async () => {
    setBusy(true); setNote('');
    const r = await refreshProfile();
    setBusy(false);
    if (!r.ok) setNote(r.message || 'Could not check your status.');
    else if (r.profile?.status === status) setNote('No change yet. You will be notified when Bulkimart reviews your application.');
  };
  const tone = status === 'rejected' || status === 'suspended' ? 'error' : 'info';
  const text = {
    pending: 'Your application is with Bulkimart for verification. You will be notified when it is reviewed.',
    under_review: 'Your documents are being reviewed.',
    rejected: 'Your application was not approved. Fix the details below and submit again.',
    suspended: 'Your account is suspended. You cannot take deliveries. Contact support for help.',
  }[status] || 'Your application status could not be read.';

  return (
    <Screen edges={['top', 'bottom']} refreshing={busy} onRefresh={check}>
      <Text style={type.title}>{partnerStatusLabel(status)}</Text>
      <InlineNotice tone={tone}>{text}</InlineNotice>
      {status === 'rejected' && profile?.rejectionReason ? (
        <Card title="Reason given"><Text style={type.body}>{profile.rejectionReason}</Text></Card>
      ) : null}
      {note ? <InlineNotice>{note}</InlineNotice> : null}
      {status === 'rejected' ? <AppButton title="Fix details and resubmit" onPress={() => navigation.navigate('Onboarding')} /> : null}
      <AppButton title="Check status" variant="outline" loading={busy} onPress={check} />
      <AppButton title="Contact support" variant="outline" onPress={() => navigation.navigate('Support')} />
      <AppButton title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  logoImage: { width: 200, height: 200, resizeMode: 'contain' },
  portal: { fontSize: 16, fontWeight: '700', color: colors.orangeDark },
  center: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
});
