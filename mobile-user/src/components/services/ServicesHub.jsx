// The Services tab: a Parcel | Legal Services toggle at the top and the selected service below.
// Every colour comes from the admin's storefront theme (useAppTheme), never a fixed palette.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, ClipboardList, History, MapPin, Package, Scale, Search } from 'lucide-react-native';
import { blend, rupees, serviceIcon } from './serviceUi';
import { boundedFetch, getToken } from '../../api/client';
import { useUser } from '../../context/UserContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { useRefreshHandler } from '../../lib/refresh';
import { Text, TextInput } from '../ui';
import { ParcelVehicleIcon } from '../parcels/ParcelUI';
import { parcelCustomerStatus, parcelMoney, parcelRequest } from '../parcels/parcelLogic';
import { parcelBookingEnabled } from './ServiceEntries';
import { useLegalApi } from './LegalServices';

const ID = /^[a-f\d]{24}$/i;
const ACTIVE = ['payment_pending', 'searching_for_driver', 'needs_admin_assignment', 'driver_assigned', 'driver_arriving', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff'];

function useColors() {
  const t = useAppTheme();
  return { action: t.action, onAction: t.actionText || '#fff', tint: t.highlight, onTint: t.highlightText || t.action,
    text: t.text || '#172b4d', muted: t.muted || '#64748b', border: t.border || '#e2e8f0', surface: t.surface || '#fff', page: t.background || '#f6f8fb' };
}

// Header tabs (same as the website): big cards with the icon above the label; the selected card joins a thin tinted
// strip, like a folder tab.
const SERVICE_TABS = [
  ['parcel', 'Parcel', Package, 'Doorstep pickup | Live tracking'],
  ['legal', 'Legal Services', Scale, 'Expert paperwork | Prices include GST'],
];

export default function ServicesHub({ initialTab }) {
  const c = useColors();
  const router = useRouter();
  const { currentUser } = useUser();
  // /services?tab=legal (the home Services tile) opens with Legal Services selected.
  const [tab, setTab] = useState(initialTab === 'legal' ? 'legal' : 'parcel');
  useEffect(() => { if (initialTab === 'legal' || initialTab === 'parcel') setTab(initialTab); }, [initialTab]);
  // Shortcuts to the customer's own history; guests are sent to sign in first.
  const openMine = path => router.push(currentUser && getToken() ? path : '/account');
  const [revision, reload] = useState(0);
  useRefreshHandler(async () => { reload(n => n + 1); });
  const soft = blend(c.action, c.surface, 0.07), softEdge = blend(c.action, c.surface, 0.22);
  return <View>
    <View style={[styles.head, { backgroundColor: c.surface }]}>
      <View style={styles.topbar}>
        <Text accessibilityRole="header" style={[styles.topTitle, { color: c.text }]}>Services</Text>
        <View style={styles.shortcuts}>
          <Pressable onPress={() => openMine('/legal-services?view=requests')} accessibilityRole="button" accessibilityLabel="My requests" hitSlop={6} style={styles.shortcut}>
            <ClipboardList size={20} color={c.action} /><Text style={[styles.shortcutText, { color: c.muted }]}>My requests</Text>
          </Pressable>
          <Pressable onPress={() => openMine('/parcel-delivery?view=history')} accessibilityRole="button" accessibilityLabel="My parcels" hitSlop={6} style={styles.shortcut}>
            <History size={20} color={c.action} /><Text style={[styles.shortcutText, { color: c.muted }]}>My parcels</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.toggle} accessibilityRole="tablist">
        {SERVICE_TABS.map(([key, label, Icon]) => {
          const on = key === tab;
          return <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[styles.toggleBtn, { backgroundColor: c.surface, borderColor: c.border },
              on && [styles.toggleBtnOn, { backgroundColor: soft, borderColor: softEdge, borderBottomColor: soft }]]}>
            <Icon size={24} color={on ? c.text : c.muted} />
            <Text style={[styles.toggleText, { color: on ? c.text : c.muted, fontWeight: on ? '800' : '700' }]}>{label}</Text>
          </Pressable>;
        })}
      </View>
      {/* Thin tinted strip (no tagline text) so the selected tab keeps its folder shape. */}
      <View style={[styles.tagline, { backgroundColor: soft, borderTopColor: softEdge }]} />
    </View>
    {tab === 'parcel' ? <ParcelPanel key={revision} c={c} /> : <LegalPanel key={revision} c={c} />}
  </View>;
}

function Section({ title, action, onAction, c, children }) {
  return <View style={{ marginTop: 22 }}>
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
      {action ? <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button"><Text style={{ color: c.action, fontWeight: '700', fontSize: 14 }}>{action}</Text></Pressable> : null}
    </View>
    {children}
  </View>;
}

function ParcelPanel({ c }) {
  const router = useRouter();
  const { currentUser } = useUser();
  const [state, setState] = useState('loading'), [vehicles, setVehicles] = useState([]), [recent, setRecent] = useState([]);
  useEffect(() => {
    const ctl = new AbortController();
    const get = async path => {
      const r = await boundedFetch(`/api/parcel-delivery/${path}`, { signal: ctl.signal });
      if (!r.ok) throw new Error('unavailable');
      return (await r.json()).data;
    };
    (async () => {
      const flags = await get('capabilities');
      if (!parcelBookingEnabled(flags)) { if (!ctl.signal.aborted) setState('disabled'); return; }
      const policy = await get('catalogue');
      if (ctl.signal.aborted) return;
      setVehicles(Array.isArray(policy?.vehicles) ? policy.vehicles : []);
      setState(policy?.ready === true ? 'enabled' : 'disabled');
    })().catch(() => { if (!ctl.signal.aborted) setState('error'); });
    if (currentUser && getToken()) parcelRequest('/bookings?page=1', { signal: ctl.signal })
      .then(b => { if (!ctl.signal.aborted && Array.isArray(b.data)) setRecent(b.data.slice(0, 3)); }).catch(() => {});
    return () => ctl.abort();
  }, [currentUser]);
  const book = () => router.push('/parcel-delivery?view=book');
  const track = id => router.push({ pathname: '/parcel-delivery', params: { view: 'track', id } });
  const active = recent.find(b => ACTIVE.includes(b.status));
  const past = recent.filter(b => b !== active).slice(0, 2);
  const open = state === 'enabled';

  return <View style={styles.panel}>
    {active ? <Pressable onPress={() => track(active._id)} accessibilityRole="button" style={[styles.liveCard, { backgroundColor: c.tint, borderColor: c.action }]}>
      <View style={[styles.liveDot, { backgroundColor: c.action }]} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.onTint, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>PARCEL IN PROGRESS</Text>
        <Text style={{ color: c.text, fontSize: 15.5, fontWeight: '700', marginTop: 2 }}>{parcelCustomerStatus(active.status)}</Text>
      </View>
      <Text style={{ color: c.action, fontWeight: '800' }}>Track</Text>
      <ChevronRight size={18} color={c.action} />
    </Pressable> : null}

    {/* The customer's real task first: from where, to where. */}
    <Pressable onPress={open ? book : undefined} disabled={!open} accessibilityRole="button" accessibilityLabel="Book a parcel: choose pickup and drop"
      style={[styles.routeCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={[styles.routeHeading, { color: c.text }]}>Send a parcel</Text>
      <Text style={{ color: c.muted, fontSize: 13.5, marginBottom: 14 }}>Doorstep pickup, live tracking, cash or online payment</Text>
      <View style={styles.routeRow}>
        <View style={[styles.stopDot, { borderColor: '#16a34a' }]} />
        <View style={[styles.routeField, { borderColor: c.border }]}><Text style={{ color: c.muted, fontSize: 15 }}>Pickup location</Text></View>
      </View>
      <View style={[styles.routeLine, { borderColor: c.border }]} />
      <View style={styles.routeRow}>
        <MapPin size={16} color={c.action} />
        <View style={[styles.routeField, { borderColor: c.border }]}><Text style={{ color: c.muted, fontSize: 15 }}>Drop location</Text></View>
      </View>
      {state === 'loading' ? <Text style={[styles.note, { color: c.muted }]}>Checking availability…</Text>
        : state === 'error' ? <Text style={[styles.note, { color: c.muted }]} accessibilityRole="alert">Could not check availability. Pull down to try again.</Text>
          : !open ? <Text style={[styles.note, { color: c.muted }]}>New bookings are paused right now. Your existing parcels are still tracked.</Text>
            : <View style={[styles.primary, { backgroundColor: c.action }]}><Text style={[styles.primaryText, { color: c.onAction }]}>Book a parcel</Text></View>}
    </Pressable>

    {vehicles.length > 0 && <Section title="Vehicles" c={c}>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: -6, marginBottom: 10 }}>Pick the one that fits your parcel while booking.</Text>
      <View style={styles.vehicleRow}>
        {vehicles.map(v => <View key={v.id} style={[styles.vehicle, { backgroundColor: c.surface, borderColor: c.border }]}>
          <ParcelVehicleIcon icon={v.icon} size={34} />
          <Text numberOfLines={1} style={[styles.vehicleName, { color: c.text }]}>{v.name}</Text>
          {v.maxWeightKg ? <Text style={{ color: c.muted, fontSize: 12 }}>Up to {v.maxWeightKg} kg</Text> : null}
        </View>)}
      </View>
    </Section>}

    <Section title="How it works" c={c}>
      <View style={[styles.steps, { backgroundColor: c.surface, borderColor: c.border }]}>
        {[['Book', 'Add pickup, drop and parcel details. See the fare before you confirm.'],
          ['Hand over', 'Share the pickup code with the delivery partner when they arrive.'],
          ['Track & receive', 'Follow it live. The receiver shares the delivery code to complete.']].map(([title, body], i) =>
          <View key={title} style={styles.step}>
            <View style={[styles.stepNo, { backgroundColor: c.tint }]}><Text style={{ color: c.onTint, fontWeight: '800' }}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14.5 }}>{title}</Text>
              <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{body}</Text>
            </View>
          </View>)}
      </View>
    </Section>

    <Section title="Recent parcels" action={currentUser ? 'See all' : undefined} onAction={() => router.push('/parcel-delivery?view=history')} c={c}>
      {past.length ? past.map(b => <Pressable key={b._id} onPress={() => track(b._id)} accessibilityRole="button"
        style={[styles.recent, { backgroundColor: c.surface, borderColor: c.border }]}>
        <ParcelVehicleIcon icon={b.service?.icon || 'parcel'} size={26} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.text, fontWeight: '700' }}>{b.service?.name || 'Parcel'} · {parcelMoney(b.feePaise)}</Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>{parcelCustomerStatus(b.status)} · {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
        </View>
        <ChevronRight size={18} color={c.muted} />
      </Pressable>)
        : <Text style={{ color: c.muted, fontSize: 13.5 }}>{currentUser ? 'Your parcels will appear here.' : 'Sign in to see your parcels.'}</Text>}
    </Section>
  </View>;
}

function LegalPanel({ c }) {
  const router = useRouter();
  const request = useLegalApi();
  const [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [items, setItems] = useState([]), [state, setState] = useState('loading');
  useEffect(() => { const id = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(id); }, [query]);
  useEffect(() => {
    const ctl = new AbortController(); setState('loading');
    request(`/api/customer-services?q=${encodeURIComponent(search)}&page=1`, { signal: ctl.signal }).then(b => {
      if (ctl.signal.aborted) return;
      setItems(Array.isArray(b.data) ? b.data.filter(s => ID.test(s?._id || '')) : []); setState('ready');
    }).catch(e => { if (!ctl.signal.aborted && e.name !== 'AbortError') setState('error'); });
    return () => ctl.abort();
  }, [request, search]);
  // Service details are public; the page asks guests to sign in only when they submit, so the chosen service isn't lost.
  const open = useCallback(id => router.push({ pathname: '/legal-services', params: { id } }), [router]);
  // Buy opens the service straight at its order form; paying needs the details that service asks for.
  const buy = useCallback(id => router.push({ pathname: '/legal-services', params: { id, buy: '1' } }), [router]);
  const buySoft = blend(c.action, c.surface, 0.1), buyEdge = blend(c.action, c.surface, 0.22);
  return <View style={styles.panel}>
    <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Search size={18} color={c.muted} />
      <TextInput value={query} onChangeText={setQuery} maxLength={100} placeholder="Search company setup, trademark, GST…" placeholderTextColor={c.muted} accessibilityLabel="Search services" style={[styles.searchInput, { color: c.text }]} />
    </View>
    <Section title="Business & legal services" c={c}>
      <Text style={{ color: c.muted, fontSize: 13, marginTop: -6, marginBottom: 12 }}>Prices include GST. Our experts handle the paperwork.</Text>
      {state === 'loading' ? <Text style={{ color: c.muted }}>Loading services…</Text>
        : state === 'error' ? <Text style={{ color: c.muted }} accessibilityRole="alert">Services could not be loaded. Pull down to try again.</Text>
          : !items.length ? <Text style={{ color: c.muted }}>{search ? 'No service matches your search.' : 'No services are available right now.'}</Text>
            : <View style={styles.list}>
              {/* One full-width card per row: icon + name/description, then price and View / Buy now. */}
              {items.map(s => {
                const Icon = serviceIcon(s.name), paise = s.fee?.totalPaise;
                return <View key={s._id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <View style={styles.cardTop}>
                    <View style={[styles.iconTile, { backgroundColor: c.tint }]}><Icon size={22} color={c.onTint} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tileTitle, { color: c.text }]}>{s.name}</Text>
                      {s.description ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12.5, lineHeight: 17, marginTop: 3 }}>{s.description}</Text> : null}
                    </View>
                  </View>
                  <View style={[styles.cardFoot, { borderTopColor: c.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.price, { color: paise > 0 ? c.text : c.muted }]}>{paise > 0 ? rupees(paise) : 'Price after review'}</Text>
                      {paise > 0 ? <Text style={{ color: c.muted, fontSize: 11 }}>incl. GST</Text> : null}
                    </View>
                    <Pressable onPress={() => open(s._id)} accessibilityRole="button" accessibilityLabel={`View ${s.name}`}
                      style={({ pressed }) => [styles.actionBtn, { borderColor: c.border, backgroundColor: c.surface }, pressed && styles.pressed]}>
                      <Text style={[styles.actionText, { color: c.text }]}>View</Text>
                    </Pressable>
                    <Pressable onPress={() => buy(s._id)} accessibilityRole="button" accessibilityLabel={`Buy ${s.name}`}
                      style={({ pressed }) => [styles.actionBtn, { borderColor: buyEdge, backgroundColor: buySoft }, pressed && styles.pressed]}>
                      <Text style={[styles.actionText, { color: c.action }]}>Buy now</Text>
                    </Pressable>
                  </View>
                </View>;
              })}
            </View>}
    </Section>
  </View>;
}

const styles = StyleSheet.create({
  head: { paddingTop: 14, paddingHorizontal: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  topTitle: { fontSize: 20, fontWeight: '800' },
  shortcuts: { flexDirection: 'row', gap: 6 },
  shortcut: { alignItems: 'center', gap: 2, minWidth: 64, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 12 },
  shortcutText: { fontSize: 11, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, zIndex: 1 },
  toggleBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 84, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 16, borderWidth: 1.5, elevation: 1, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  // The selected card sits on the strip's top border so the two read as one shape.
  toggleBtnOn: { minHeight: 96, marginBottom: -1.5, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, elevation: 0, shadowOpacity: 0 },
  toggleText: { fontSize: 15 },
  tagline: { marginHorizontal: -12, height: 10, borderTopWidth: 1.5 },
  panel: { paddingHorizontal: 16, paddingTop: 16 },
  liveCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 14 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  routeCard: { borderRadius: 18, borderWidth: 1, padding: 16, elevation: 2, shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  routeHeading: { fontSize: 20, fontWeight: '800' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stopDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginHorizontal: 1 },
  routeField: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  routeLine: { height: 14, marginLeft: 7, borderLeftWidth: 2, borderStyle: 'dashed' },
  note: { fontSize: 13.5, lineHeight: 19, marginTop: 14 },
  primary: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryText: { fontSize: 16, fontWeight: '800' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Three to a row at most; more vehicles wrap instead of squeezing the names.
  vehicle: { flexGrow: 1, flexBasis: '30%', minWidth: 96, alignItems: 'center', gap: 3, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1 },
  vehicleName: { fontSize: 13.5, fontWeight: '700' },
  steps: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 14 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderRadius: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  list: { gap: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12, elevation: 1, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderStyle: 'dashed' },
  actionBtn: { minHeight: 36, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 13.5, fontWeight: '700' },
  iconTile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  price: { fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.85 },
});
