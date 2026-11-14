import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import Icon from '../../components/Icon';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { getSellerPrivacyPolicy } from '../../services/privacyPolicy.api';
import { colors, radius, spacing, type } from '../../theme';

// Seller privacy policy (admin-managed), as its own page. Same content as the seller policy on the website.
export default function PrivacyPolicyScreen() {
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    setError('');
    try { setPolicy(await getSellerPrivacyPolicy()); } catch (err) { setError(err.message || 'Could not load the privacy policy.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingView message="Loading privacy policy…" />;
  if (error && !policy) return <ErrorView message={error} onRetry={() => load()} />;

  const updated = new Date(policy.effectiveDate || policy.updatedAt);
  return (
    <Screen refreshing={refreshing} onRefresh={() => load(true)}>
      <Card>
        <View style={styles.head}>
          <View style={styles.icon}><Icon name="shield" size={18} color={colors.primaryDark} /></View>
          <View style={styles.flex}>
            <Text style={type.heading} accessibilityRole="header">{policy.roleTitle || 'Seller privacy policy'}</Text>
            <Text style={type.small}>
              Version {policy.version || '1.0.0'}{Number.isNaN(updated.getTime()) ? '' : ` • Updated ${updated.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`}
            </Text>
          </View>
        </View>
        {policy.summary ? <Text style={styles.summary}>{policy.summary}</Text> : null}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  summary: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  body: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  point: { fontSize: 12.5, lineHeight: 19, color: colors.text },
});
