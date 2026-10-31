// Port of components/services/CustomerServices.jsx (LegalServiceCard, ParcelServiceCard, HomeServiceEntries)
// and components/parcels/parcelAvailability.js.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Package, BriefcaseBusiness } from 'lucide-react-native';
import { boundedFetch } from '../../api/client';
import { useAppTheme } from '../../theme/ThemeContext';
import { Text } from '../ui';

export function parcelBookingEnabled(flags) {
  return ['catalogue', 'booking', 'auto_assignment', 'admin_fallback', 'fulfilment'].every(key => flags?.[key] === true)
    && flags.productionBlocked === false && (flags.online_payment === true || flags.pay_driver === true);
}
export function parcelBookingReady(flags, policy) {
  return parcelBookingEnabled(flags) && policy?.ready === true
    && policy.areas?.length > 0 && policy.categories?.length > 0
    && Array.isArray(policy.prohibitedItems)
    && (flags.online_payment === true || (policy.payDriverEnabled === true && policy.payDriverCategories?.some(category => policy.categories.includes(category))));
}

function ServiceLink({ title, onPress, primary, disabled }) {
  const theme = useAppTheme();
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button"
    style={[styles.link, { borderColor: primary ? theme.action : theme.border, backgroundColor: primary ? theme.action : theme.highlight }, primary && { width: 180 }, disabled && { opacity: 0.5 }]}>
    <Text style={{ fontSize: 14, fontWeight: '600', color: primary ? '#fff' : theme.highlightText, textAlign: 'center' }}>{title}</Text>
  </Pressable>;
}

function Card({ Icon, title, body, children }) {
  const theme = useAppTheme();
  return <View style={[styles.card, { borderColor: theme.border }]}>
    <Icon size={24} color="#ed8719" />
    <Text style={styles.cardTitle}>{title}</Text>
    <Text style={styles.cardBody}>{body}</Text>
    {children}
  </View>;
}

function Status({ text, alert, onRetry, retryLabel }) {
  return <Text accessibilityRole={alert ? 'alert' : undefined} style={styles.cardBody}>{text}{onRetry ? ' ' : ''}{onRetry ? <Text onPress={onRetry} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>{retryLabel}</Text> : null}</Text>;
}

export function LegalServiceCard() {
  const router = useRouter();
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    const get = async path => {
      const r = await boundedFetch(path, { signal: c.signal });
      const b = await r.json();
      if (!r.ok || b.success === false) throw new Error('Availability check failed');
      return b;
    };
    (async () => {
      const b = await get('/api/customer-services/capabilities');
      if (typeof b.data?.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      if (!b.data.catalogue) { if (!c.signal.aborted) setState('empty'); return; }
      const catalogue = await get('/api/customer-services?page=1&limit=1');
      if (!Array.isArray(catalogue.data) || !Number.isSafeInteger(catalogue.meta?.total) || catalogue.meta.total < 0
        || catalogue.data.length > 1 || catalogue.data.some(s => !/^[a-f\d]{24}$/i.test(s?._id || ''))
        || (catalogue.meta.total > 0) !== (catalogue.data.length > 0)) throw new Error('Invalid catalogue');
      if (!c.signal.aborted) setState(catalogue.data.length ? 'enabled' : 'empty');
    })().catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <Card Icon={BriefcaseBusiness} title="Legal Services" body="Explore legal services and their requirements. Requests are reviewed by the team.">
    {state === 'enabled' ? <ServiceLink primary title="Browse Legal Services" onPress={() => router.push('/legal-services')} />
      : state === 'loading' ? <Status text="Checking legal services availability…" />
        : state === 'error' ? <Status alert text="Legal services availability could not be checked." onRetry={() => retry(n => n + 1)} retryLabel="Retry legal availability" />
          : <Status text="No customer legal services are currently available. Please check back later." />}
  </Card>;
}

export function ParcelServiceCard() {
  const router = useRouter();
  const [state, setState] = useState('loading'), [attempt, retry] = useState(0);
  useEffect(() => {
    const c = new AbortController(); setState('loading');
    const get = async path => {
      const r = await boundedFetch(`/api/parcel-delivery/${path}`, { signal: c.signal });
      if (!r.ok) throw new Error('Availability check failed');
      return (await r.json()).data;
    };
    (async () => {
      const f = await get('capabilities');
      if (!f || typeof f.catalogue !== 'boolean') throw new Error('Invalid capabilities');
      const enabled = parcelBookingEnabled(f);
      const policy = enabled ? await get('catalogue') : null;
      if (!c.signal.aborted) setState((enabled && (policy?.ready === true || parcelBookingReady(f, policy))) ? 'enabled' : !f.catalogue ? 'unavailable' : 'disabled');
    })().catch(() => { if (!c.signal.aborted) setState('error'); });
    return () => c.abort();
  }, [attempt]);
  return <Card Icon={Package} title="Send a Parcel" body="Doorstep pickup. A delivery fee before you book. Your parcel, delivered with care.">
    {state === 'loading' ? <Status text="Checking parcel availability…" />
      : state === 'enabled' ? <Status text="Ready to send? Get a delivery fee before confirming." />
        : state === 'error' ? <Status alert text="Parcel availability could not be checked." onRetry={() => retry(n => n + 1)} retryLabel="Retry parcel availability" />
          : <Status text="New deliveries are currently unavailable. You can still view your delivery history." />}
    <View style={styles.actions}>
      {state === 'enabled' || state === 'unavailable' ? <ServiceLink primary title="Send a Parcel" onPress={() => router.push('/parcel-delivery?view=book')} />
        : state === 'disabled' ? <ServiceLink primary disabled title="Send a Parcel" /> : null}
      <ServiceLink title="Delivery history" onPress={() => router.push('/parcel-delivery?view=history')} />
    </View>
  </Card>;
}

export function HomeServiceEntries() {
  return <View style={{ gap: 10, marginVertical: 12, paddingHorizontal: 8 }} accessibilityLabel="Customer services"><LegalServiceCard /><ParcelServiceCard /></View>;
}

const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff', alignItems: 'flex-start' },
  cardTitle: { fontSize: 18, fontWeight: '700', marginVertical: 8, color: '#172b4d' },
  cardBody: { fontSize: 14, lineHeight: 20, color: '#172b4d', marginBottom: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 6 },
  link: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
