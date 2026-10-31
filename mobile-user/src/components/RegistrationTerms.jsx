// Port of components/RegistrationTerms.jsx: the published policy (GET /api/privacy-policy/<audience>-policy).
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { request } from '../api/client';
import { Text } from './ui';

export function PolicyContent({ slug, onLoaded }) {
  const [policy, setPolicy] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setPolicy(null); setError('');
    request(`/api/privacy-policy/${slug}`, { auth: false }).then(({ ok, body }) => {
      if (!ok || !body.success || !body.data || body.data.isPublished === false) throw new Error();
      if (!cancelled) { setPolicy(body.data); onLoaded?.(body.data); }
    }).catch(() => { if (!cancelled) setError('This policy could not be loaded. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View>
    {loading && <Text>Loading policy…</Text>}
    {error ? <View accessibilityRole="alert"><Text>{error}</Text><Pressable onPress={() => setAttempt(n => n + 1)} style={styles.secondary}><Text style={styles.secondaryText}>Retry loading policy</Text></Pressable></View> : null}
    {policy && <>
      <Text style={styles.h3}>{policy.roleTitle}</Text>
      {policy.version ? <Text style={styles.version}>Version {policy.version}</Text> : null}
      {policy.summary ? <Text style={styles.body}>{policy.summary}</Text> : null}
      {[...(policy.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((section, index) => <View key={section.id || index} style={{ marginTop: 12 }}>
        <Text style={styles.h4}>{section.title}</Text>
        <Text style={styles.body}>{section.content}</Text>
        {section.points?.length > 0 && section.points.map((point, i) => <Text key={i} style={styles.body}>{'• '}{point}</Text>)}
      </View>)}
    </>}
  </View>;
}

export default function RegistrationTerms({ audience = 'user' }) {
  const [open, setOpen] = useState(false);
  return <>
    <Text onPress={() => setOpen(true)} accessibilityRole="link" style={styles.link}>Terms &amp; Conditions</Text>
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.h2}>Terms &amp; Conditions</Text>
            <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close registration policy" style={styles.close}><Text style={{ fontSize: 24 }}>×</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>{open && <PolicyContent slug={`${audience}-policy`} />}</ScrollView>
          <View style={styles.footer}><Pressable onPress={() => setOpen(false)} style={styles.secondary}><Text style={styles.secondaryText}>Back to registration</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  link: { color: '#0369a1', fontWeight: '700', textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  dialog: { width: '100%', maxHeight: '90%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  h2: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  close: { minWidth: 44, minHeight: 44, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  secondary: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: '#bae6fd', borderRadius: 8, backgroundColor: '#f0f9ff', alignSelf: 'flex-start', justifyContent: 'center', marginTop: 8 },
  secondaryText: { color: '#0369a1', fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  h4: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  version: { color: '#64748b', fontSize: 12 },
  body: { fontSize: 14, lineHeight: 24, color: '#0f172a' },
});
