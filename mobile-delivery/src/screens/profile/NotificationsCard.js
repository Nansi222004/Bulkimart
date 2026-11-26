import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import { InlineNotice } from '../../components/StateViews';
import { lastPushResult, pushServerStatus, registerPush, sendTestPush } from '../../services/push';
import { isRingingEnabled, openOfferSoundSettings, ringingSupported, setRingingEnabled } from '../../services/orderAlert';
import { formatDateTime } from '../../utils/format';
import { spacing, type } from '../../theme';

/**
 * Profile → Notifications. A rider who misses order pop-ups while the app is closed can see whether
 * this phone is registered for push, why not, re-register it, and send themselves a test notification.
 */
const REASON = {
  permission: 'Notifications are turned off for this app. Allow them in Android Settings → Apps → Bulkimart Driver → Notifications.',
  token: 'This phone could not get a notification address from Google. Check that Google Play services is installed and up to date.',
  error: 'Registering this phone failed',
};

export default function NotificationsCard({ toast }) {
  const [status, setStatus] = useState(null);
  const [last, setLast] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [ringOn, setRingOn] = useState(true);
  useEffect(() => { isRingingEnabled().then(setRingOn); }, []);
  const toggleRing = (value) => { setRingOn(value); setRingingEnabled(value); };

  const check = useCallback(async () => {
    setError('');
    setLast(await lastPushResult());
    try { setStatus(await pushServerStatus()); }
    catch (e) { setStatus(null); setError(e.message || 'Could not check notifications.'); }
  }, []);
  useEffect(() => { check(); }, [check]);

  const reRegister = async () => {
    setBusy('register');
    try {
      const result = await registerPush({ askPermission: true });
      toast?.show(result.ok ? 'This phone is registered for notifications.' : 'Registration failed. See the reason below.', result.ok ? 'success' : 'error');
    } finally { await check(); setBusy(''); }
  };
  const test = async () => {
    setBusy('test');
    try {
      const result = await sendTestPush();
      toast?.show(result.sent ? 'Test sent. A notification should appear within a few seconds.' : 'No test notification could be sent.', result.sent ? 'success' : 'error');
      if (!result.sent || result.failed) setError(`Not delivered: ${(result.errors || []).join(', ') || 'unknown reason'}`);
    } catch (e) { setError(e.message || 'Could not send a test notification.'); }
    finally { setBusy(''); }
  };

  const registered = status?.thisDeviceRegistered;
  return (
    <Card title="Notifications">
      <Text style={[styles.state, registered ? styles.ok : styles.bad]}>
        {status ? (registered ? '✓ This phone gets order notifications' : '✕ This phone is not set up for notifications') : 'Checking…'}
      </Text>
      {status && !registered ? (
        <Text style={type.small}>
          {!status.hasLocalToken ? 'This phone has no notification address yet. '
            : status.thisDeviceDisabled ? 'Google reported this phone\'s address as no longer valid. '
              : 'Bulkimart has no record of this phone. '}
          New orders still appear while the app is open, but not when it is closed. Tap Re-register.
        </Text>
      ) : null}
      {last && !last.ok ? (
        <InlineNotice tone="warning">
          {REASON[last.reason] || 'Registration failed'}{last.message ? `: ${last.message}` : ''} ({formatDateTime(last.at)})
        </InlineNotice>
      ) : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <View style={styles.row}>
        <AppButton small title="Re-register" variant="outline" loading={busy === 'register'} disabled={Boolean(busy)} onPress={reRegister} style={styles.flex} />
        <AppButton small title="Send test" loading={busy === 'test'} disabled={Boolean(busy) || !registered} onPress={test} style={styles.flex} />
      </View>
      {ringingSupported() ? (
        <>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={type.label}>Ring for new offers</Text>
              <Text style={type.small}>Plays the offer ringtone until you accept or decline, while the app is open.</Text>
            </View>
            <Switch value={ringOn} onValueChange={toggleRing} accessibilityLabel="Ring for new offers" />
          </View>
          <AppButton small title="Offer sound with app closed" variant="outline" onPress={openOfferSoundSettings} />
          <Text style={type.small}>Opens Android's settings for "New order offers" (sound, volume, pop-up). Also set Battery → No restrictions for this app, so offers reach you when it is closed.</Text>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  state: { fontSize: 14, fontWeight: '700' },
  ok: { color: '#15803d' },
  bad: { color: '#b91c1c' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
});
