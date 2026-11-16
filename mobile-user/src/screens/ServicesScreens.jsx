// Routes /services and /legal-services (web: UnifiedHeader + CustomerServices / LegalServices).
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { runRefresh } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Text } from '../components/ui';
import ServicesHub from '../components/services/ServicesHub';
import LegalServices from '../components/services/LegalServices';

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
  const theme = useAppTheme();
  const bottom = useNavPadding(16);
  const [refreshing, setRefreshing] = useState(false);
  // No title bar: the bottom nav already says "Services", so the Parcel | Legal toggle sits at the top.
  // The status bar uses the page background (admin theme) so the toggle reads as the first thing on screen.
  return <CustomerPage background={theme.pageBackground} headerColor={theme.pageBackground}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: theme.pageBackground }} contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await runRefresh(); setRefreshing(false); }} colors={[theme.action]} />}>
      <ServicesHub />
    </ScrollView>
  </CustomerPage>;
}
