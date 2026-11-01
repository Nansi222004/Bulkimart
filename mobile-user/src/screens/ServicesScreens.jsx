// Routes /services and /legal-services (web: UnifiedHeader + CustomerServices / LegalServices).
import React, { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { boundedFetch } from '../api/client';
import { runRefresh } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { HeaderTop, HeaderPinned } from '../components/UnifiedHeader';
import { Text } from '../components/ui';
import { ParcelServiceCard } from '../components/services/ServiceEntries';
import LegalServices from '../components/services/LegalServices';

function Page({ children }) {
  const theme = useAppTheme();
  const bottom = useNavPadding(16);
  const [refreshing, setRefreshing] = useState(false);
  return <CustomerPage headerColor={theme.header}>
    <ScrollView stickyHeaderIndices={[1]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: bottom, backgroundColor: '#f7fafc', flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await runRefresh(); setRefreshing(false); }} colors={[theme.action]} />}>
      <HeaderTop />
      <HeaderPinned />
      {children}
    </ScrollView>
  </CustomerPage>;
}

// Legal Services opens as its own page: a title bar with Back instead of the storefront header and search.
export function LegalServicesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { setActiveNav } = useUser();
  const insets = useSafeAreaInsets();
  const { view, id } = useLocalSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : setActiveNav('home'));
  return <CustomerPage headerColor={theme.header} nav={false}>
    <View style={[styles.appbar, { backgroundColor: theme.header }]}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={styles.backBtn}><ArrowLeft size={24} color={theme.headerText || '#fff'} /></Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.appbarTitle, { color: theme.headerText || '#fff' }]}>{view === 'requests' ? 'My Legal Requests' : 'Legal Services'}</Text>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#f6f8fb' }} contentContainerStyle={{ paddingBottom: 24 + insets.bottom, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await runRefresh(); setRefreshing(false); }} colors={[theme.action]} />}>
      <LegalServices key={`${view || ''}:${id || ''}`} view={view} id={id} />
    </ScrollView>
  </CustomerPage>;
}

const styles = StyleSheet.create({
  appbar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12 },
  backBtn: { padding: 6 },
  appbarTitle: { flex: 1, fontSize: 18, fontWeight: '800' },
});

export function ServicesScreen() {
  const { setActiveNav } = useUser();
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    boundedFetch('/api/customer-services/capabilities', { signal: c.signal }).then(async r => {
      if (!r.ok) throw new Error('Availability check failed');
      const b = await r.json();
      if (b.success === false || typeof b.data?.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      if (!c.signal.aborted) setState(b.data.catalogue ? 'enabled' : 'disabled');
    }).catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <Page>
    <View style={{ paddingTop: 16, paddingHorizontal: 12 }} accessibilityLabel="Services">
      <Pressable onPress={() => setActiveNav('home')} accessibilityRole="link" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}><Text style={{ textDecorationLine: 'underline', color: '#172b4d' }}>Back to home</Text></Pressable>
      <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', marginVertical: 10, color: '#172b4d' }}>Services</Text>
      <ParcelServiceCard />
    </View>
    {state === 'enabled' ? <LegalServices />
      : <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>{state === 'loading' ? <Text>Checking services availability…</Text>
        : state === 'error' ? <Text accessibilityRole="alert">Services could not be loaded. <Text onPress={() => retry(n => n + 1)} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Retry services</Text></Text>
          : <Text>No customer legal services are currently available. Please check back later.</Text>}</View>}
  </Page>;
}
