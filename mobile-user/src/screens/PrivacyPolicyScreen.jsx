// Route /privacy-policy — the customer privacy policy (admin-managed CMS) as its own page.
// Readable without signing in. The seller policy belongs to the seller app.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { request } from '../api/client';
import { useAppTheme } from '../theme/ThemeContext';
import { CustomerPage } from '../components/Shell';
import { Text } from '../components/ui';
import AccountPageHeader from '../components/AccountPageHeader';

const POLICY_SLUG = 'user-policy';

export default function PrivacyPolicyScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { body } = await request(`/api/privacy-policy/${POLICY_SLUG}`, { auth: false });
      setPolicy(body.success && body.data ? body.data : null);
    } catch { setPolicy(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return <CustomerPage nav={false} headerColor={theme.header} background="#f8fafc">
    <AccountPageHeader title="Privacy Policy" />
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom, gap: 16 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} colors={[theme.primary]} />}>
      {loading ? <View style={styles.empty}><Text style={styles.emptyText}>Loading privacy policy...</Text></View>
        : !policy ? <View style={styles.empty}><Text style={styles.emptyText}>Privacy policy content unavailable. Pull down to try again.</Text></View>
          : <>
            <View style={styles.head}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <View style={[styles.icon, { backgroundColor: theme.highlight }]}>
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.actionHover} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#0f172a' }}>{policy.roleTitle}</Text>
                  <Text style={{ fontSize: 11, color: '#64748b' }}>Version {policy.version || '1.0.0'} • Updated {new Date(policy.effectiveDate || policy.updatedAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</Text>
                </View>
              </View>
              {policy.summary ? <Text style={{ fontSize: 12, lineHeight: 19, color: '#475569' }}>{policy.summary}</Text> : null}
            </View>
            <View style={{ gap: 12 }}>
              {(policy.sections || []).map((sec, idx) => <View key={sec.id || idx} style={styles.section}>
                <Text style={{ fontSize: 13, color: '#0f172a', fontWeight: '700', marginBottom: 4 }}>{sec.title}</Text>
                <Text style={{ fontSize: 12, color: '#64748b', lineHeight: 18 }}>{sec.content}</Text>
                {sec.points?.length > 0 && <View style={{ marginTop: 8, gap: 2 }}>{sec.points.map((pt, i) => <Text key={i} style={{ fontSize: 11.5, color: '#475569', lineHeight: 18.4 }}>{'•  '}{pt}</Text>)}</View>}
              </View>)}
            </View>
          </>}
    </ScrollView>
  </CustomerPage>;
}

const styles = StyleSheet.create({
  empty: { backgroundColor: '#fff', padding: 30, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  emptyText: { fontSize: 13, color: '#64748b', textAlign: 'center' },
  head: { backgroundColor: '#fff', paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  section: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
});
