import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { api } from '../../services/apiClient';
import { colors, type } from '../../theme';

// GET /api/privacy-policy/delivery-policy — public, admin-managed (backend/controllers/privacyPolicyController.js).
async function getDeliveryPrivacyPolicy() {
  const body = await api.get('/api/privacy-policy/delivery-policy');
  if (!body?.success || !body.data) throw new Error('Privacy policy is not available right now.');
  return body.data;
}

/** Delivery partner privacy policy, as its own page (opened from Profile → Help). */
export default function PrivacyPolicyScreen() {
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    setError('');
    try { setPolicy(await getDeliveryPrivacyPolicy()); } catch (err) { setError(err.message || 'Could not load the privacy policy.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingView message="Loading privacy policy…" />;
  if (error && !policy) return <ErrorView message={error} onRetry={() => load()} />;

  const updated = new Date(policy.effectiveDate || policy.updatedAt);
  return (
    <Screen refreshing={refreshing} onRefresh={() => load(true)}>
      <Card>
        <Text style={type.heading} accessibilityRole="header">{policy.roleTitle || 'Delivery partner privacy policy'}</Text>
        <Text style={type.small}>
          Version {policy.version || '1.0.0'}{Number.isNaN(updated.getTime()) ? '' : ` • Updated ${updated.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
        </Text>
        {policy.summary ? <Text style={styles.body}>{policy.summary}</Text> : null}
      </Card>
      {(policy.sections || []).map((sec, idx) => (
        <Card key={sec.id || idx}>
          <Text style={type.label}>{sec.title}</Text>
          {sec.content ? <Text style={styles.body}>{sec.content}</Text> : null}
          {sec.points?.length ? sec.points.map((pt, i) => <Text key={i} style={styles.point}>{'•  '}{pt}</Text>) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  point: { fontSize: 13.5, lineHeight: 20, color: colors.text },
});
