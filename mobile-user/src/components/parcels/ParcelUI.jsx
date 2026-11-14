// Ports of ParcelMap, ParcelLocationPicker, ParcelBookingFlow and ParcelCustomerStatus (customer side).
// Native differences: the map is react-native-maps (pin by tap or drag); address search uses the backend's
// /api/geo/forward ("Find address") — the web's Google Places type-ahead needs the browser Maps SDK and is not
// available in the app; current location uses expo-location. All quotes, fares and eligibility come from the API.
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { ArrowDownUp, ArrowLeft, ChevronDown, ChevronRight, Clock, Heart, Info, LocateFixed, Pencil, TriangleAlert, X } from 'lucide-react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { VEHICLE_ART_VIEWBOX, vehicleArt } from './vehicleArt';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { getCurrentPosition } from '../../lib/gps';
import { session } from '../../lib/storage';
import { mediaUrl } from '../../api/client';
import { decodePolyline } from '../DeliveryMap';
import { Text, TextInput } from '../ui';
import { useAppTheme } from '../../theme/ThemeContext';
import SelectField from '../SelectField';
import { newIdempotencyKey } from '../services/ServicePayment';
import { initPushNotifications } from '../../lib/push';
import { bookedParcelAddress, initialParcelJourney, parcelAddressError, parcelCustomerStatus, parcelDraftKey, parcelGoodsError, parcelJourneyInput, parcelLocationLookup, parcelMoney, parcelRequest, parcelVehicleMode, readParcelDraft, saveParcelPickup, savedParcelAddress, validParcelLocation, writeParcelDraft } from './parcelLogic';

const INK = '#172b46', MUTED = '#52647b', LINE = '#e3e8ef', SOFT = '#f3f6fb';
/** Parcel colours follow the admin storefront theme (button colour, its hover shade, button text). */
/** A light tint of a theme colour (mixed with white), for card backgrounds and selected states. */
export function parcelTint(color, amount = 0.12) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return '#eef3f7';
  const n = parseInt(m[1], 16), mix = c => Math.round(255 - (255 - c) * amount).toString(16).padStart(2, '0');
  return '#' + mix(n >> 16) + mix((n >> 8) & 255) + mix(n & 255);
}
function useParcelColors() {
  const theme = useAppTheme();
  return { BLUE: theme.action, DARK: theme.actionHover || theme.action, ON: theme.actionText || '#fff', TINT: parcelTint(theme.action, 0.12), SOFT: parcelTint(theme.action, 0.05) };
}
const MAPS_CONFIGURED = Boolean(Constants.expoConfig?.extra?.mapsConfigured);

export function PBtn({ title, onPress, disabled, variant = 'primary', style, accessibilityLabel, children }) {
  const { BLUE, DARK, ON } = useParcelColors();
  const look = variant === 'primary' ? { backgroundColor: BLUE, borderColor: DARK } : variant === 'big' ? { backgroundColor: BLUE, borderColor: BLUE, minHeight: 50, width: '100%' }
    : variant === 'text' ? { backgroundColor: 'transparent', borderColor: 'transparent' } : variant === 'tab' ? { backgroundColor: '#fff', borderColor: '#cbd5e1' }
      : variant === 'tab-on' ? { backgroundColor: BLUE, borderColor: BLUE } : { backgroundColor: '#fff', borderColor: '#cbd5e1' };
  const color = ['primary', 'big', 'tab-on'].includes(variant) ? ON : variant === 'text' ? DARK : '#475569';
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={[styles.btn, look, disabled && { opacity: 0.5 }, style]}>
    {children || <Text style={{ color, fontWeight: variant === 'big' || variant === 'tab-on' ? '700' : '600', textAlign: 'center', textDecorationLine: variant === 'text' ? 'underline' : 'none' }}>{title}</Text>}
  </Pressable>;
}
export function PField({ label, value, onChangeText, multiline, keyboardType, maxLength, style, editable = true }) {
  return <View style={[{ marginVertical: 10 }, style]}>
    <Text style={{ fontSize: 14, fontWeight: '600', color: INK }}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} multiline={multiline} keyboardType={keyboardType} maxLength={maxLength} editable={editable} accessibilityLabel={label}
      style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} />
  </View>;
}
export function PCheck({ checked, onPress, disabled, children }) {
  const { BLUE, ON } = useParcelColors();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} style={[styles.check, disabled && { opacity: 0.5 }]}>
    <View style={[styles.box, checked && { backgroundColor: BLUE, borderColor: BLUE }]}>{checked ? <Text style={{ color: ON, fontSize: 12 }}>✓</Text> : null}</View>
    <View style={{ flex: 1 }}>{children}</View>
  </Pressable>;
}
function PRadio({ checked, onPress, disabled, children }) {
  const { BLUE } = useParcelColors();
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked, disabled }} style={[styles.check, disabled && { opacity: 0.5 }]}>
    <View style={[styles.radio, checked && { borderColor: BLUE, borderWidth: 6 }]} />
    <View style={{ flex: 1 }}>{children}</View>
  </Pressable>;
}
export const PCard = ({ children, style }) => <View style={[styles.card, style]}>{children}</View>;

export function ParcelMap({ pickup, dropoff, route, editable, onPinChange }) {
  const { BLUE } = useParcelColors();
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const points = [['pickup', pickup, 'P'], ['dropoff', dropoff, 'D']].filter(([, p]) => validParcelLocation(p)).map(([kind, p, label]) => ({ kind, label, coordinate: { latitude: Number(p.lat), longitude: Number(p.lng) } }));
  const line = decodePolyline(route?.polyline);
  const signature = points.map(p => `${p.coordinate.latitude},${p.coordinate.longitude}`).join('|');
  useEffect(() => {
    if (!ready || !map.current || !points.length) return;
    if (points.length > 1) map.current.fitToCoordinates(points.map(p => p.coordinate), { edgePadding: { top: 48, bottom: 48, left: 48, right: 48 }, animated: true });
    else map.current.animateCamera({ center: points[0].coordinate, zoom: 16 }, { duration: 300 });
  }, [ready, signature]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!MAPS_CONFIGURED) return <View style={styles.mapWrap}><Text style={styles.mapMessage}>Interactive map unavailable. You can still find an address using search.</Text></View>;
  const pin = e => onPinChange?.({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
  return <View style={styles.mapWrap}>
    <MapView ref={map} provider={PROVIDER_GOOGLE} style={{ height: 300, width: '100%' }} onMapReady={() => setReady(true)} onPress={editable ? pin : undefined}
      initialRegion={{ latitude: 22.5, longitude: 79, latitudeDelta: 20, longitudeDelta: 20 }} toolbarEnabled={false}
      accessibilityLabel={editable ? `Adjust the ${editable} pin on the map` : 'Pickup and delivery route map'}>
      {points.map(p => <Marker key={p.kind} coordinate={p.coordinate} title={p.kind === 'pickup' ? 'Pickup location' : 'Drop location'} description={p.label}
        draggable={editable === p.kind} onDragEnd={editable === p.kind ? pin : undefined} pinColor={p.kind === 'pickup' ? '#087c9f' : '#dc2626'} />)}
      {line.length > 1 && <Polyline coordinates={line} strokeColor={BLUE} strokeWidth={5} />}
    </MapView>
    {!ready ? <Text style={styles.mapMessage}>Loading map…</Text> : editable ? <Text style={styles.mapMessage}>Tap the map or drag the {editable === 'pickup' ? 'pickup' : 'drop'} pin, then confirm the location.</Text> : null}
  </View>;
}

export function ParcelLocationPicker({ value, onChange, label = 'Search address or landmark', initialQuery = '', showMap = false, pinKind = 'pickup' }) {
  const [query, setQuery] = useState(initialQuery), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef(0), controller = useRef(null), latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => () => { operation.current++; controller.current?.abort(); }, []);
  const start = () => {
    controller.current?.abort(); controller.current = new AbortController();
    latest.current.onChange({ ...latest.current.value, lat: '', lng: '' });
    const id = ++operation.current; setBusy(true); setError(''); setNotice(''); setCandidate(null);
    return { id, signal: controller.current.signal };
  };
  const select = (point, address = {}) => {
    const current = latest.current;
    current.onChange({ ...current.value, ...address, lat: point.lat, lng: point.lng });
    setCandidate(null); setNotice('Location selected. Check the address and pincode before continuing.');
  };
  const prepare = async (point, id, signal, accuracy) => {
    let patch = { ...point };
    try {
      const address = await parcelLocationLookup('reverse', { lat: point.lat, lng: point.lng, ...(accuracy ? { accuracy } : {}) }, signal);
      patch = { ...patch, address: point.address || address.formatted || [address.address, address.city, address.state].filter(Boolean).join(', '), pincode: point.pincode || address.pincode || '', approximate: point.approximate === true || accuracy > 50 };
    } catch {
      patch = { ...patch, approximate: true };
      if (id === operation.current) setNotice('Address lookup unavailable. Confirm this pin and enter the full address and pincode in the next step.');
    }
    if (id === operation.current) setCandidate(patch);
  };
  const movePin = async point => { const { id, signal } = start(); await prepare(point, id, signal); if (id === operation.current) setBusy(false); };
  const search = async () => {
    if (query.trim().length < 3) { setError('Enter a street, area or landmark with the city.'); return; }
    const { id, signal } = start();
    try {
      const point = await parcelLocationLookup('forward', { q: query.trim() }, signal);
      if (id !== operation.current) return;
      if (!validParcelLocation(point)) throw new Error('No usable location was found. Try a more specific address.');
      const match = { ...point, address: point.matched || query, approximate: point.precision !== 'ROOFTOP' };
      if (/^\d{6}$/.test(point.pincode || '')) setCandidate(match); else await prepare(match, id, signal);
    } catch (e) { if (id === operation.current && e.name !== 'AbortError') setError(e.message); } finally { if (id === operation.current) setBusy(false); }
  };
  const locate = async () => {
    const { id, signal } = start();
    try {
      const position = await getCurrentPosition({ timeout: 15000 });
      if (id !== operation.current) return;
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (!validParcelLocation(point)) { setError('Your location could not be read. Search for the address instead.'); return; }
      await prepare(point, id, signal, position.coords.accuracy);
    } catch (failure) {
      if (id === operation.current) setError(failure.code === 1 ? 'Location permission was denied. Search for the address instead.' : failure.code === 3 ? 'Location request timed out. Try again or search for the address.' : 'Your location could not be found. Try again or search for the address.');
    } finally { if (id === operation.current) setBusy(false); }
  };
  return <View>
    <Text style={{ fontSize: 14, fontWeight: '600', color: INK, marginTop: 8 }}>{label}</Text>
    <TextInput value={query} placeholder="Street, landmark or area, city" placeholderTextColor="#94a3b8" maxLength={500} returnKeyType="search" onSubmitEditing={search} accessibilityLabel={label}
      onChangeText={t => { operation.current++; controller.current?.abort(); setBusy(false); setCandidate(null); setError(''); setNotice(''); setQuery(t); onChange({ ...value, lat: '', lng: '' }); }}
      style={styles.input} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      <PBtn title="Find address" onPress={search} disabled={busy} />
      <PBtn title="Use current location" onPress={locate} disabled={busy} />
    </View>
    {busy && <Text style={{ marginTop: 6 }}>Finding location…</Text>}
    {showMap && <ParcelMap pickup={pinKind === 'pickup' ? candidate || value : null} dropoff={pinKind === 'dropoff' ? candidate || value : null} editable={pinKind} onPinChange={movePin} />}
    {candidate && <View style={styles.result}>
      <Text>{candidate.address || candidate.matched || query || 'Selected map pin'}</Text>
      <Text style={styles.small}>Pincode: {candidate.pincode || 'Not resolved — enter it in address details'}</Text>
      <Text style={styles.small}>{candidate.approximate ? 'Approximate address. Check and correct the pin before confirming.' : 'Check that this is the correct place.'}</Text>
      <PBtn title="Use this location" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => select(candidate, { address: candidate.address || candidate.matched || query || '', pincode: candidate.pincode || '', approximate: candidate.approximate === true })} />
    </View>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!busy && (notice || validParcelLocation(value)) ? <Text style={{ fontSize: 13, color: '#146447', marginTop: 8 }}>{notice || 'Location selected. You can search to change it.'}</Text> : null}
  </View>;
}

// Flat colour illustrations (vehicleArt.js), shape-for-shape the same as the website. `size` is the
// picture's height; it is 1.5× as wide.
const ART_SHAPES = { path: Path, rect: Rect, circle: Circle, ellipse: Ellipse };
export function ParcelVehicleIcon({ icon, size = 34 }) {
  return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    <Svg viewBox={VEHICLE_ART_VIEWBOX} width={Math.round(size * 1.5)} height={size}>
      {vehicleArt(icon).map(({ t, ...attrs }, i) => { const Shape = ART_SHAPES[t]; return <Shape key={i} {...attrs} />; })}
    </Svg>
  </View>;
}
/** Whole rupees when the fare has no paise (₹160), otherwise two decimals. */
export const parcelRupees = paise => Number.isFinite(paise) ? (paise % 100 ? parcelMoney(paise) : '₹' + paise / 100) : '';
function PriceSummary({ pricing }) {
  const rows = [[pricing.includedKm > 0 ? `Base fare (first ${pricing.includedKm} km)` : 'Base fare', pricing.basePaise], ['Distance charge', pricing.distancePaise], ...(pricing.weightSurchargePaise > 0 ? [['Weight surcharge', pricing.weightSurchargePaise]] : []), ...(pricing.handlingFeePaise > 0 ? [['Handling fee', pricing.handlingFeePaise]] : []), ...(pricing.minimumAdjustmentPaise > 0 ? [['Minimum fare adjustment', pricing.minimumAdjustmentPaise]] : []), ['Tax (included)', pricing.taxPaise]];
  return <View style={{ gap: 10, marginVertical: 10 }}>
    {rows.map(([t, v]) => <View key={t} style={styles.row}><Text>{t}</Text><Text>{parcelMoney(v)}</Text></View>)}
    <View style={styles.row}><Text style={{ fontWeight: '700' }}>Total payable</Text><Text style={{ fontWeight: '700' }}>{parcelMoney(pricing.totalPaise)}</Text></View>
  </View>;
}
function RouteSummary({ quote }) {
  return <Text style={{ marginVertical: 8, color: MUTED, fontSize: 13 }}>{quote.route?.provider === 'mock' ? 'Simulated test route · ' : ''}{(quote.pricing.distanceMetres / 1000).toFixed(2)} km{quote.route?.durationSeconds > 0 ? ' · about ' + Math.ceil(quote.route.durationSeconds / 60) + ' min travel' : ' · travel time unavailable'}{quote.route?.provider === 'google_routes' ? ' · Google Maps' : ''}</Text>;
}
/** Bottom sheet for vehicle details, goods, payment, fare breakup, lists and cancellation. */
export function PSheet({ title, label, onClose, children, footer }) {
  const insets = useSafeAreaInsets();
  return <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.sheetOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <Pressable onPress={onClose} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={INK} /></Pressable>
      <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]} accessibilityViewIsModal accessibilityLabel={label || title}>
        {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>{children}</ScrollView>
        {footer}
      </View>
    </View>
  </Modal>;
}
function TermsDialog({ terms, policy, onClose }) {
  const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.dialog} accessibilityViewIsModal>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, fontSize: 18, fontWeight: '700' }}>Delivery, payment and cancellation terms</Text><Pressable onPress={onClose} accessibilityLabel="Close terms" hitSlop={10}><Text style={{ fontSize: 22 }}>×</Text></Pressable></View>
        <ScrollView style={{ marginVertical: 12 }}>
          {terms ? <Text style={{ marginBottom: 10 }}>{terms}</Text> : null}
          <Text style={styles.h3}>Delivery</Text>
          <Text>• {parcelVehicleMode(policy) ? 'Your goods must fit the vehicle you choose (its weight and load space are shown on the Select vehicle screen).' : `Parcels up to ${policy.maxWeightKg} kg, each side up to ${policy.maxDimensionCm} cm.`}</Text>
          {policy.prohibitedItems?.length > 0 && <Text>• Not allowed: {policy.prohibitedItems.join(', ')}.</Text>}
          <Text>• The delivery partner confirms pickup and delivery with one-time codes shown in your tracking page.</Text>
          <Text style={styles.h3}>Payment</Text>
          <Text>• Pay online with Razorpay, or pay the delivery partner in cash where offered.</Text>
          <Text>• Only the delivery fee is charged — never the value of your parcel.</Text>
          <Text style={styles.h3}>Cancellation and refunds</Text>
          {instant ? <><Text>• Until a delivery partner accepts, you can cancel at once. Any amount you paid goes back to your Bulkimart wallet straight away.</Text><Text>• After a partner accepts and until pickup, cancellation requests are reviewed by our team.</Text></>
            : <><Text>• You can request cancellation until the delivery partner picks up your parcel.</Text><Text>• Cancellation requests are reviewed by our team.</Text></>}
          <Text>• After pickup the booking can no longer be cancelled.</Text>
          <Text>• Approved refunds go to your Bulkimart wallet. Cash paid to the partner is refunded after it is deposited with us.</Text>
        </ScrollView>
        <PBtn variant="big" title="Close" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}
const BACK = { pickup: 'start', pickupDetails: 'pickup', dropoff: 'pickupDetails', dropoffDetails: 'dropoff', vehicle: 'dropoffDetails', review: 'vehicle' };
const TITLES = { start: 'Send a Parcel', pickup: 'Pickup location', pickupDetails: 'Pickup details', dropoff: 'Drop location', dropoffDetails: 'Drop details', vehicle: 'Select Vehicle', review: 'Review Booking' };
const goodsText = (parcel, vehicle, categories) => [parcel.description?.trim() && categories.includes(parcel.category) ? parcel.category : '', parcel.weightKg !== '' && parcel.weightKg != null ? `${Number(parcel.weightKg)} kg` : vehicle ? `up to ${vehicle.maxWeightKg} kg` : '', `${Number(parcel.packages) || 1} ${Number(parcel.packages) > 1 ? 'packages' : 'package'}`].filter(Boolean).join(' · ');
const Dot = ({ kind }) => <View style={[styles.dot, kind === 'dropoff' && styles.dotDrop]} />;
export function ParcelStop({ kind, address: a, right }) {
  return <View style={styles.stop}>
    <Dot kind={kind} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontWeight: '700', fontSize: 13.5 }} numberOfLines={1}>{[a?.name, a?.phone].filter(Boolean).join(' · ') || (kind === 'pickup' ? 'Pickup' : 'Drop')}</Text>
      <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{[a?.building, a?.address].filter(Boolean).join(', ')}</Text>
    </View>
    {right}
  </View>;
}

export function ParcelBookingFlow({ policy, flags, addresses = [], profile, onBooked, onOpenHistory, onOpenTrip }) {
  const { BLUE, TINT, SOFT } = useParcelColors();
  const storageKey = parcelDraftKey(profile?._id);
  const [state, setState] = useState(() => readParcelDraft(storageKey, initialParcelJourney(profile, policy)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now());
  const [sheet, setSheet] = useState(null), [termsOpen, setTermsOpen] = useState(false), [mapOpen, setMapOpen] = useState(false), [showAddresses, setShowAddresses] = useState(false), [goodsDraft, setGoodsDraft] = useState(null);
  const generation = useRef(0), lock = useRef(false), mounted = useRef(true), controller = useRef(null), latest = useRef(state);
  latest.current = state;
  const vehicleMode = parcelVehicleMode(policy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => { if (storageKey) writeParcelDraft(session, storageKey, state); }, [state, storageKey]);
  useEffect(() => { if (!state.quote) return undefined; const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, [state.quote?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMapOpen(false); setShowAddresses(false); }, [state.step]);
  // Home shows the customer's last few trips (with Book Again), like the parcel app's home.
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    if (state.step !== 'start' || !onOpenHistory) return undefined;
    const c = new AbortController();
    parcelRequest('/bookings?page=1', { signal: c.signal }).then(b => { if (!c.signal.aborted && Array.isArray(b.data)) setRecent(b.data.slice(0, 3)); }).catch(() => {});
    return () => c.abort();
  }, [state.step, Boolean(onOpenHistory)]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = step => { setError(''); setNotice(''); setState(s => ({ ...s, step })); };
  const change = patch => { generation.current++; controller.current?.abort(); setState(s => ({ ...s, ...patch, quote: null })); setError(''); setNotice(''); };
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (mounted.current && e.name !== 'AbortError') setError(e.message); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const requestQuote = async () => {
    const input = parcelJourneyInput(latest.current, policy), id = ++generation.current;
    controller.current?.abort(); controller.current = new AbortController();
    const body = await parcelRequest('/quotes', { method: 'POST', body: JSON.stringify(input), signal: controller.current.signal });
    if (!mounted.current || generation.current !== id) return null;
    const quote = body.data;
    if (!quote?._id || !Number.isSafeInteger(quote.pricing?.totalPaise) || quote.pricing.totalPaise <= 0 || !(new Date(quote.expiresAt).getTime() > Date.now())) throw new Error('A valid delivery quote could not be loaded. Please retry.');
    setNow(Date.now()); return quote;
  };
  const chooseVehicle = (quote, current) => {
    if (!quote.vehicleOptions) return '';
    const usable = quote.vehicleOptions.filter(o => o.available);
    return (usable.find(o => o.vehicle.id === current) || usable[0])?.vehicle.id || '';
  };
  const loadQuote = () => run(async () => {
    const quote = await requestQuote();
    if (!quote) return;
    setState(s => {
      const vehicleId = chooseVehicle(quote, s.vehicleId);
      const lost = s.step === 'review' && quote.vehicleOptions && vehicleId !== s.vehicleId;
      if (lost) setNotice('The vehicle you chose cannot carry these goods. Choose another vehicle.');
      return { ...s, quote, vehicleId, step: lost ? 'vehicle' : s.step };
    });
  });
  const goodsReady = !parcelGoodsError(state.parcel, policy) && (vehicleMode || state.parcel.acceptRestrictions);
  const wantsQuote = ['vehicle', 'review'].includes(state.step) && !state.quote && !state.pending && goodsReady && !error;
  useEffect(() => { if (wantsQuote && !busy && !lock.current) loadQuote(); }, [wantsQuote, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = state.quote;
  const option = quote?.vehicleOptions?.find(o => o.vehicle.id === state.vehicleId);
  const fare = option?.pricing || (quote && !quote.vehicleOptions ? quote.pricing : null);
  const vehicle = option?.vehicle || policy.vehicles?.find(v => v.id === state.vehicleId);
  const vehicleName = option?.vehicle.name || (vehicleMode ? vehicle?.name || 'vehicle' : quote?.service?.name || 'Doorstep delivery');
  const expired = quote && new Date(quote.expiresAt).getTime() <= now;
  const cashPoints = quote?.cashCollectionPoints || policy.cashCollectionPoints || (policy.cashCollectionPoint === 'customer_choice' ? ['pickup', 'delivery'] : [policy.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery']);
  const cashAllowed = Boolean(flags.pay_driver && policy.payDriverEnabled && policy.payDriverCategories?.includes(state.parcel.category));
  const methods = [...(cashAllowed ? ['pay_driver'] : []), ...(flags.online_payment ? ['online'] : [])];
  const paymentMethod = state.pending?.payload.paymentMethod || (methods.includes(state.paymentMethod) ? state.paymentMethod : methods[0] || '');
  const cashPoint = state.pending?.payload.paymentMethod === 'pay_driver' ? state.pending.payload.cashCollectionPoint || 'delivery' : cashPoints.includes(state.cashCollectionPoint) ? state.cashCollectionPoint : cashPoints.includes('delivery') ? 'delivery' : cashPoints[0];
  const paymentLabel = paymentMethod === 'online' ? 'Pay online' : paymentMethod === 'pay_driver' ? `Cash at ${cashPoint === 'pickup' ? 'pickup' : 'drop'}` : 'Not available';
  const confirmBooking = () => run(async () => {
    let attempt = state.pending;
    if (!attempt) {
      if (!paymentMethod) throw new Error('No payment method is available for this parcel.');
      if (!quote || !fare) throw new Error('Choose a vehicle to see your fare.');
      if (new Date(quote.expiresAt).getTime() - Date.now() < 30000) {
        const fresh = await requestQuote();
        if (!fresh) return;
        setState(s => ({ ...s, quote: fresh, vehicleId: chooseVehicle(fresh, s.vehicleId) }));
        setNotice('Your fare has been refreshed. Check it, then tap Book again.');
        return;
      }
      attempt = { key: newIdempotencyKey(), payload: { quoteId: quote._id, policyVersion: fare.policyVersion ?? quote.pricing.policyVersion, paymentMethod, ...(paymentMethod === 'pay_driver' ? { cashCollectionPoint: cashPoint } : {}), ...(quote.vehicleOptions ? { vehicleId: state.vehicleId } : {}), acceptTerms: true } };
      const snapshot = { ...latest.current, pending: attempt };
      // Saved before sending: a timeout must retry the same quote and key.
      if (storageKey) writeParcelDraft(session, storageKey, snapshot);
      setState(snapshot);
    }
    let body;
    try { body = await parcelRequest('/bookings', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) }); }
    catch (e) {
      if (e.status === 409 && /Quotation expired|Policy changed/i.test(e.message)) setState(s => ({ ...s, pending: null, quote: null, step: 'vehicle' }));
      if (e.status && e.status < 500 && e.status !== 409) setState(s => ({ ...s, pending: null }));
      throw new Error(e.message + ' If confirmation was interrupted, retry safely or check Delivery history.');
    }
    if (!body.data?._id || !body.data.reference) throw new Error('Booking confirmation was interrupted. Retry safely or check Delivery history.');
    // Booking is an explicit action, like placing an order: ask for notifications now so the customer
    // gets "partner assigned", pickup-code and delivery-code pushes (no prompt if already decided).
    void initPushNotifications({ requestPermission: true }).catch(() => {});
    if (storageKey) session.removeItem(storageKey);
    if (mounted.current) onBooked(body.data);
  });
  const back = () => { if (state.pending || busy) return; go(BACK[state.step] || 'start'); };
  const chooseLocation = (kind, value) => change({ [kind]: value, ...(validParcelLocation(value) ? { step: kind + 'Details' } : {}) });
  const confirmDetails = kind => run(async () => {
    const message = parcelAddressError(state[kind]);
    if (message) throw new Error(message);
    const label = state.saveAs?.[kind];
    if (label) {
      try { await saveParcelPickup({ ...state[kind], label }); setNotice('Address saved to your addresses.'); }
      catch { setNotice('This address could not be saved, but your booking can continue.'); }
    }
    setState(s => ({ ...s, step: kind === 'pickup' ? (validParcelLocation(s.dropoff) && s.dropoff.address ? 'dropoffDetails' : 'dropoff') : 'vehicle' }));
  });
  const linkText = (title, onPress, Icon, disabled) => <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={8} style={[styles.link, disabled && { opacity: 0.5 }]}>
    {Icon ? <Icon size={16} color={BLUE} /> : null}<Text style={{ color: BLUE, fontWeight: '700', fontSize: 13 }}>{title}</Text></Pressable>;
  const messages = <>
    {error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{['vehicle', 'review'].includes(state.step) && !state.quote ? linkText('Try again', () => setError('')) : null}</View> : null}
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
  </>;
  const header = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
    {state.step !== 'start' ? <Pressable onPress={back} disabled={busy || !!state.pending} accessibilityRole="button" accessibilityLabel="Back to previous step" hitSlop={10} style={{ padding: 4, opacity: busy || state.pending ? 0.4 : 1 }}><ArrowLeft size={22} color={INK} /></Pressable> : null}
    <Text accessibilityRole="header" style={{ flex: 1, fontSize: 18, fontWeight: '800', color: INK }}>{TITLES[state.step]}</Text>
  </View>;
  const tripCard = <View style={styles.tripCard}>
    <View style={{ flex: 1 }}>
      <View style={styles.stopBox}><ParcelStop kind="pickup" address={state.pickup} /></View>
      <View style={styles.stopBox}><ParcelStop kind="dropoff" address={state.dropoff} /></View>
      <View style={{ alignItems: 'center', borderTopWidth: 1, borderTopColor: LINE, marginTop: 6, paddingTop: 4 }}>{linkText('Edit Locations', () => go('pickupDetails'), Pencil, busy || !!state.pending)}</View>
    </View>
    <Pressable onPress={() => change({ pickup: state.dropoff, dropoff: state.pickup })} disabled={busy || !!state.pending} accessibilityRole="button" accessibilityLabel="Switch pickup and drop" style={styles.round}><ArrowDownUp size={18} color="#41526a" /></Pressable>
  </View>;

  // ---- Home (as in the parcel app): pickup bar, vehicles, recent trips and good-to-know cards
  if (state.step === 'start') {
    const tiles = vehicleMode ? policy.vehicles : [{ id: '', name: 'Doorstep delivery', icon: '', maxWeightKg: policy.maxWeightKg }];
    const next = validParcelLocation(state.pickup) ? (validParcelLocation(state.dropoff) ? 'vehicle' : 'dropoff') : 'pickup';
    const again = b => setState(s => ({ ...s, pickup: bookedParcelAddress(b.details.pickup), dropoff: bookedParcelAddress(b.details.dropoff), vehicleId: b.service?.id && b.service.id !== 'parcel' ? b.service.id : '', quote: null, pending: null, step: 'vehicle' }));
    const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
    const info = [[instant ? 'Free cancellation' : 'Easy cancellation', instant ? 'Cancel at once until a partner accepts. Paid fares go back to your wallet.' : 'Request cancellation any time before pickup.'], ['Cash or online', 'Pay the partner in cash or online with Razorpay.'], ['Safe handover', 'Pickup and delivery are confirmed with one-time codes.']];
    return <View>{messages}
      <Pressable onPress={() => go('pickup')} accessibilityRole="button" style={styles.pickupBar}>
        <Dot kind="pickup" />
        <View style={{ flex: 1 }}><Text style={{ fontSize: 12, color: MUTED }}>Pick up from</Text><Text style={{ fontWeight: '700' }} numberOfLines={1}>{state.pickup.address || 'Set your pickup location'}</Text></View>
        <ChevronRight size={20} color={MUTED} />
      </Pressable>
      <Text style={styles.homeTitle}>Choose a vehicle</Text>
      <View style={styles.tiles}>{tiles.map(v => <Pressable key={v.id || 'parcel'} accessibilityRole="button" accessibilityLabel={`${v.name}, up to ${v.maxWeightKg} kg`} onPress={() => setState(s => ({ ...s, vehicleId: v.id, step: next }))} style={[styles.tile, { padding: 0, overflow: 'hidden', minHeight: 164 }]}>
        <View style={{ height: 92, alignItems: 'center', justifyContent: 'center', backgroundColor: TINT, marginBottom: 8 }}><ParcelVehicleIcon icon={v.icon} size={58} /></View>
        <Text style={{ fontWeight: '700', paddingHorizontal: 14 }}>{v.name}</Text><Text style={{ fontSize: 12, color: MUTED, paddingHorizontal: 14 }}>Up to {v.maxWeightKg} kg</Text>
        <View style={{ position: 'absolute', right: 10, bottom: 12 }}><ChevronRight size={18} color={MUTED} /></View>
      </Pressable>)}</View>
      {recent.length > 0 ? <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={styles.homeTitle}>Your recent trips</Text>{onOpenHistory ? linkText('View all', onOpenHistory) : null}</View>
        {recent.map(b => <View key={b._id} style={styles.orderCard}>
          <Pressable onPress={() => onOpenTrip?.(b._id)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <ParcelVehicleIcon icon={b.service?.icon} size={28} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{b.service?.name || 'Parcel delivery'}</Text><Text style={{ fontSize: 12, color: MUTED }}>{b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</Text></View>
            <Text style={{ fontWeight: '800' }}>{parcelRupees(b.feePaise)} ›</Text>
          </Pressable>
          {b.details?.pickup ? <View style={styles.stopBox}><ParcelStop kind="pickup" address={b.details.pickup} /></View> : null}
          {b.details?.dropoff ? <View style={styles.stopBox}><ParcelStop kind="dropoff" address={b.details.dropoff} /></View> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            {['delivered', 'cancelled'].includes(b.status) ? <>
              <Text style={{ backgroundColor: b.status === 'delivered' ? '#e3f6ea' : '#fde8eb', color: b.status === 'delivered' ? '#14804a' : '#b0233c', fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>{b.status === 'delivered' ? 'COMPLETED' : 'CANCELLED'}</Text>
              {b.details?.pickup && b.details?.dropoff ? <PBtn title="Book Again" onPress={() => again(b)} style={{ minHeight: 38, paddingVertical: 8 }} /> : null}
            </> : <>
              <Text style={{ backgroundColor: TINT, color: BLUE, fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>IN PROGRESS</Text>
              {linkText('Track', () => onOpenTrip?.(b._id))}
            </>}
          </View>
        </View>)}
      </View> : null}
      <Text style={styles.homeTitle}>Good to know</Text>
      <View style={{ gap: 10 }}>{info.map(([title, body]) => <View key={title} style={styles.infoCard}><Text style={{ fontWeight: '700', fontSize: 13 }}>{title}</Text><Text style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{body}</Text></View>)}</View>
      {policy.areas?.length > 0 ? <Text style={{ fontSize: 12.5, color: MUTED, marginTop: 14 }}>We pick up and deliver within: {policy.areas.map(a => a.name).join(', ')}.</Text> : null}
      {onOpenHistory ? <PBtn variant="outline" title="Delivery history" onPress={onOpenHistory} style={{ alignSelf: 'center', marginTop: 16, borderColor: BLUE }} /> : null}
    </View>;
  }
  // ---- Pickup / drop search
  if (state.step === 'pickup' || state.step === 'dropoff') {
    const kind = state.step;
    return <View>{header}
      {kind === 'dropoff' ? <View style={[styles.tripCard, { paddingRight: 12 }]}><View style={[styles.stopBox, { flex: 1 }]}><ParcelStop kind="pickup" address={state.pickup} right={<Pressable onPress={() => go('pickupDetails')} accessibilityLabel="Edit pickup" hitSlop={8}><ChevronRight size={18} color={MUTED} /></Pressable>} /></View></View> : null}
      {messages}
      <View style={styles.searchBox}>
        <View style={{ paddingTop: 34 }}><Dot kind={kind} /></View>
        <View style={{ flex: 1 }}><ParcelLocationPicker key={kind + (mapOpen ? ':map' : '')} showMap={mapOpen} pinKind={kind} label={kind === 'pickup' ? 'Where is your pickup?' : 'Where is your drop?'} value={state[kind]} initialQuery="" onChange={v => chooseLocation(kind, v)} /></View>
      </View>
      <View style={styles.searchLinks}>{linkText(mapOpen ? 'Hide map' : 'Select on map', () => setMapOpen(o => !o), LocateFixed)}{linkText('Saved addresses', () => {}, Heart)}</View>
      <View style={styles.addressList} accessibilityLabel="Saved addresses">
        {addresses.length === 0 ? <Text style={{ padding: 16, color: MUTED, fontSize: 13 }}>No saved addresses yet. You can save one on the next screen.</Text>
          : addresses.map((a, i) => <Pressable key={a._id} accessibilityRole="button" onPress={() => chooseLocation(kind, { ...savedParcelAddress(a), ...(kind === 'pickup' && !a.name && !a.phone ? { name: state.pickup.name, phone: state.pickup.phone } : {}) })} style={[styles.addressRow, i > 0 && { borderTopWidth: 1, borderTopColor: LINE }]}>
            <Clock size={18} color={MUTED} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{a.label || 'Saved'}{a.name ? ' · ' + a.name : ''}</Text><Text style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{[a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ')}</Text></View>
          </Pressable>)}
      </View>
    </View>;
  }
  // ---- Pickup / drop details on the map
  if (state.step === 'pickupDetails' || state.step === 'dropoffDetails') {
    const kind = state.step === 'pickupDetails' ? 'pickup' : 'dropoff', a = state[kind], pickup = kind === 'pickup';
    const mine = Boolean(profile?.phone && a.phone === profile.phone && a.name === (profile.name || a.name));
    const edit = (key, value) => change({ [kind]: { ...a, [key]: value } });
    return <View>{header}
      <View>
        <ParcelMap pickup={pickup ? a : null} dropoff={pickup ? null : a} editable={kind} onPinChange={p => change({ [kind]: { ...a, lat: p.lat, lng: p.lng, approximate: true } })} />
        <View style={styles.pinTip} pointerEvents="none"><Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '600' }}>{pickup ? 'Your goods will be picked from here' : 'Your goods will be dropped here'}</Text></View>
      </View>
      <PCard style={{ marginTop: 0 }}>
        <View style={styles.detailsAddress}>
          <Dot kind={kind} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }} numberOfLines={1}>{a.address.split(',')[0] || 'Selected location'}</Text><Text style={{ fontSize: 12.5, color: MUTED }} numberOfLines={2}>{a.address}</Text>{a.approximate ? <Text style={styles.small}>Pin moved — check the address and pincode.</Text> : null}</View>
          <PBtn variant="outline" title="Change" onPress={() => go(kind)} style={{ minHeight: 34, paddingVertical: 6, borderColor: BLUE }} />
        </View>
        {messages}
        <PField label="House / Apartment / Shop (optional)" value={a.building || ''} maxLength={100} onChangeText={t => edit('building', t)} />
        {!/^\d{6}$/.test(a.pincode || '') ? <PField label="Pincode" value={a.pincode || ''} maxLength={6} keyboardType="number-pad" onChangeText={t => edit('pincode', t.replace(/\D/g, ''))} /> : null}
        <PField label={pickup ? 'Sender’s name' : 'Receiver’s name'} value={a.name || ''} maxLength={100} onChangeText={t => edit('name', t)} />
        <PField label={pickup ? 'Sender’s mobile number' : 'Receiver’s mobile number'} value={a.phone || ''} maxLength={16} keyboardType="phone-pad" onChangeText={t => edit('phone', t)} />
        {profile?.phone ? <PCheck checked={mine} onPress={() => change({ [kind]: { ...a, ...(mine ? { name: '', phone: '' } : { name: profile.name || a.name, phone: profile.phone }) } })}><Text>Use my mobile number: {profile.phone}</Text></PCheck> : null}
        <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 10 }}>Save as (optional)</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>{['Home', 'Work', 'Other'].map(label => { const on = state.saveAs?.[kind] === label; return <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setState(s => ({ ...s, saveAs: { ...s.saveAs, [kind]: on ? '' : label } }))} style={[styles.chip, on && { borderColor: BLUE, backgroundColor: TINT }]}><Text style={{ color: on ? BLUE : '#41526a', fontSize: 13, fontWeight: '600' }}>{label}</Text></Pressable>; })}</View>
      </PCard>
      <View style={styles.sticky}><PBtn variant="big" disabled={busy} title={busy ? 'Saving…' : 'Confirm and Proceed'} onPress={() => confirmDetails(kind)} /></View>
    </View>;
  }
  // ---- Select vehicle
  if (state.step === 'vehicle') {
    const options = quote?.vehicleOptions || (quote ? [{ vehicle: { id: '', name: quote.service?.name || 'Doorstep delivery', icon: '', maxWeightKg: quote.service?.maxWeightKg || policy.maxWeightKg, description: 'Partner and pickup time confirmed after booking.' }, available: true, pricing: quote.pricing, etaMinutes: null }] : []);
    const info = sheet?.type === 'vehicle' ? options.find(o => o.vehicle.id === sheet.id)?.vehicle : null;
    const selectedId = state.vehicleId || options[0]?.vehicle.id || '';
    return <View>{header}{tripCard}{messages}
      {!vehicleMode ? <PCard>
        <Text style={styles.h3}>What are you sending?</Text>
        <Text style={{ color: MUTED }}>Up to {policy.maxWeightKg} kg · Each side up to {policy.maxDimensionCm} cm</Text>
        <GoodsFields parcel={state.parcel} onChange={p => change({ parcel: p })} policy={policy} vehicle={null} />
        <Text style={{ marginVertical: 8 }}>Prohibited items: {policy.prohibitedItems.join(', ')}.</Text>
        <PCheck checked={state.parcel.acceptRestrictions} onPress={() => change({ parcel: { ...state.parcel, acceptRestrictions: !state.parcel.acceptRestrictions } })}><Text>My parcel meets these restrictions and limits.</Text></PCheck>
      </PCard> : null}
      {busy && !quote ? <Text style={{ color: '#41526a', marginVertical: 8 }}>Finding prices for your route…</Text> : null}
      {quote ? <RouteSummary quote={quote} /> : null}
      <View style={{ gap: 8 }} accessibilityLabel="Vehicles">{options.map(o => { const selected = (o.vehicle.id || '') === selectedId; return <View key={o.vehicle.id || 'parcel'}>
        <Pressable accessibilityRole="radio" accessibilityState={{ selected, disabled: !o.available || busy }} disabled={!o.available || busy} onPress={() => setState(s => ({ ...s, vehicleId: o.vehicle.id }))}
          style={[styles.vehicle, selected && { borderColor: BLUE, borderWidth: 2, backgroundColor: SOFT, paddingVertical: 18 }, !o.available && { opacity: 0.5 }]}>
          <ParcelVehicleIcon icon={o.vehicle.icon} size={selected ? 52 : 36} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{o.vehicle.name}</Text>
            <Text style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{o.vehicle.maxWeightKg} kg{o.etaMinutes ? ` · ${o.etaMinutes} mins` : ''}</Text>
            {selected && o.vehicle.dimensionsCm ? <Text style={{ fontSize: 12, color: MUTED }}>Load space {o.vehicle.dimensionsCm.join(' × ')} cm</Text> : null}
            {!o.available ? <Text style={{ fontSize: 12, color: '#9c243a' }}>{o.reason === 'too_large' ? 'Can’t carry these goods' : 'Not available on this route'}</Text> : null}
          </View>
          <Text style={{ fontWeight: '800', fontSize: selected ? 18 : 16 }}>{o.pricing ? parcelRupees(o.pricing.totalPaise) : '—'}</Text>
        </Pressable>
        {o.vehicle.dimensionsCm ? <Pressable onPress={() => setSheet({ type: 'vehicle', id: o.vehicle.id })} accessibilityRole="button" accessibilityLabel={'About ' + o.vehicle.name} hitSlop={10} style={styles.infoBtn}><Info size={16} color="#41526a" /></Pressable> : null}
      </View>; })}</View>
      {quote && !expired ? <Text style={{ fontSize: 12.5, color: MUTED, marginTop: 10 }}>Fare valid until {new Date(quote.expiresAt).toLocaleTimeString()}.</Text> : null}
      {expired ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}><Text>These prices have expired.</Text>{linkText('Refresh prices', () => change({}), null, busy)}</View> : null}
      <View style={styles.sticky}><PBtn variant="big" disabled={busy || !fare || expired} title={fare ? `Proceed with ${vehicleName}` : busy ? 'Loading prices…' : 'Choose a vehicle'} onPress={() => go('review')} /></View>
      {info ? <PSheet label={info.name} onClose={() => setSheet(null)} footer={<PBtn variant="big" title="Done" onPress={() => setSheet(null)} style={{ marginTop: 12 }} />}>
        <View style={{ alignItems: 'center', backgroundColor: TINT, borderRadius: 12, padding: 20, marginBottom: 12 }}><ParcelVehicleIcon icon={info.icon} size={96} /></View>
        <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{info.name}</Text>
        <Text style={{ textAlign: 'center', fontWeight: '600', marginTop: 4 }}>{info.maxWeightKg} kg · {info.dimensionsCm.join(' cm × ')} cm</Text>
        {info.description ? <Text style={{ textAlign: 'center', color: MUTED, fontSize: 13, marginTop: 6 }}>{info.description}</Text> : null}
      </PSheet> : null}
    </View>;
  }
  // ---- Review booking
  const instant = (policy.customerCancel || 'instant_before_assignment') === 'instant_before_assignment';
  const eta = option?.etaMinutes || (quote?.route?.durationSeconds ? Math.ceil(quote.route.durationSeconds / 60) : null);
  return <View>{header}{messages}
    {!quote ? <Text style={{ color: '#41526a', marginVertical: 8 }}>{busy ? 'Updating your fare…' : 'Your fare needs refreshing.'}</Text> : <>
      <PCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ParcelVehicleIcon icon={option?.vehicle.icon} size={44} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{vehicleName}</Text>{linkText('View Address Details', () => setShowAddresses(v => !v), null)}</View>
          {eta ? <View style={styles.etaBox}><Text style={{ fontWeight: '800' }}>{eta}</Text><Text style={{ fontSize: 11, color: MUTED }}>mins</Text></View> : null}
        </View>
        {showAddresses ? <View style={{ borderTopWidth: 1, borderTopColor: LINE, marginTop: 10, paddingTop: 6 }}><ParcelStop kind="pickup" address={state.pickup} /><ParcelStop kind="dropoff" address={state.dropoff} /></View> : null}
      </PCard>
      <RouteSummary quote={quote} />
      <PCard>
        <Text style={styles.h3}>Goods Description</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{state.parcel.description?.trim() || state.parcel.category}</Text><Text style={{ fontSize: 12.5, color: MUTED }}>{goodsText(state.parcel, vehicle, policy.categories)}</Text></View>
          {linkText('Change', () => { setGoodsDraft({ ...state.parcel }); setSheet({ type: 'goods' }); }, null, busy || !!state.pending)}
        </View>
        {policy.prohibitedItems?.length > 0 ? <View style={styles.restricted}><TriangleAlert size={18} color="#7a5200" /><Text style={{ flex: 1, color: '#7a5200', fontSize: 13 }}>Do not send restricted items</Text>{linkText('View List', () => setSheet({ type: 'restricted' }))}</View> : null}
      </PCard>
      {fare ? <PCard>
        <Text style={styles.h3}>Fare Summary</Text>
        <View style={styles.row}><Text>Trip fare (incl. tax)</Text><Text>{parcelMoney(fare.totalPaise)}</Text></View>
        {fare.taxPaise > 0 ? <View style={[styles.row, { marginTop: 8 }]}><Text>Tax included</Text><Text>{parcelMoney(fare.taxPaise)}</Text></View> : null}
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: LINE, marginTop: 10, paddingTop: 10 }]}><Text style={{ fontWeight: '700' }}>Amount payable</Text><Text style={{ fontWeight: '700' }}>{parcelMoney(fare.totalPaise)}</Text></View>
      </PCard> : null}
      <PCard>
        <Text style={styles.h3}>Read before Booking</Text>
        {['The fare is fixed for this route and vehicle. It changes only if you choose to add to it while we find a partner.', 'Only the delivery fee is charged, never the value of your goods.', ...(vehicle ? [`Your goods must fit the ${vehicleName}: up to ${vehicle.maxWeightKg} kg${vehicle.dimensionsCm ? `, ${vehicle.dimensionsCm.join(' × ')} cm` : ''}.`] : []), instant ? 'You can cancel free of charge until a delivery partner accepts.' : 'Cancellation requests are reviewed by our team.', 'Pickup and delivery are confirmed with one-time codes shown on your tracking page.'].map(line => <Text key={line} style={{ fontSize: 13, color: '#41526a', lineHeight: 20 }}>• {line}</Text>)}
        {linkText('Delivery, payment and cancellation terms', () => setTermsOpen(true))}
      </PCard>
      {!state.pending && expired ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text>Your fare has expired.</Text>{linkText('Refresh fare', () => change({}), null, busy)}</View> : null}
      {state.pending ? <Text style={styles.notice}>A confirmation attempt is in progress. Retry uses the same booking identity; check Delivery history if the connection was interrupted.</Text> : null}
      <View style={[styles.sticky, { gap: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Pressable onPress={() => setSheet({ type: 'payment' })} disabled={busy || !!state.pending || methods.length === 0} accessibilityRole="button" accessibilityLabel={`Choose payment method, ${paymentLabel}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: busy || state.pending ? 0.6 : 1 }}>
            <View style={styles.payIcon}><Text style={{ color: '#14804a', fontWeight: '800' }}>₹</Text></View>
            <View><Text style={{ fontSize: 11.5, color: MUTED }}>Choose payment method</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={{ fontWeight: '700' }}>{paymentLabel}</Text><ChevronDown size={14} color={INK} /></View></View>
          </Pressable>
          {fare ? <View style={{ alignItems: 'flex-end' }}><Text style={{ fontWeight: '800', fontSize: 18 }}>{parcelRupees(fare.totalPaise)}</Text>{linkText('View Breakup', () => setSheet({ type: 'breakup' }))}</View> : null}
        </View>
        <PBtn variant="big" disabled={busy || !fare || (!state.pending && (expired || !paymentMethod))} onPress={confirmBooking} title={busy ? 'Confirming your booking…' : state.pending ? 'Retry booking safely' : `Book ${vehicleName}`} />
        <Text style={[styles.small, { textAlign: 'center', marginTop: 0 }]}>By booking you accept the delivery, payment and cancellation terms.</Text>
      </View>
    </>}
    {sheet?.type === 'payment' ? <PSheet title="Select Payment Method" onClose={() => setSheet(null)} footer={<PBtn variant="big" title={fare ? `Pay ${parcelRupees(fare.totalPaise)} ${paymentMethod === 'online' ? 'online' : 'using cash'}` : 'Confirm'} onPress={() => setSheet(null)} style={{ marginTop: 12 }} />}>
      {methods.includes('online') ? <Pressable onPress={() => setState(s => ({ ...s, paymentMethod: 'online' }))} accessibilityRole="radio" accessibilityState={{ selected: paymentMethod === 'online' }} style={[styles.payOption, paymentMethod === 'online' && { borderColor: BLUE, backgroundColor: SOFT }]}>
        <View style={[styles.radio, paymentMethod === 'online' && { borderColor: BLUE, borderWidth: 6 }]} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>Pay online</Text><Text style={{ fontSize: 12.5, color: MUTED }}>UPI, cards and net banking with Razorpay</Text></View></Pressable> : null}
      {methods.includes('pay_driver') ? <Pressable onPress={() => setState(s => ({ ...s, paymentMethod: 'pay_driver' }))} accessibilityRole="radio" accessibilityState={{ selected: paymentMethod === 'pay_driver' }} style={[styles.payOption, paymentMethod === 'pay_driver' && { borderColor: BLUE, backgroundColor: SOFT }]}>
        <View style={[styles.radio, paymentMethod === 'pay_driver' && { borderColor: BLUE, borderWidth: 6 }]} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>Cash</Text><Text style={{ fontSize: 12.5, color: MUTED }}>Pay the delivery partner in cash</Text></View></Pressable> : null}
      {paymentMethod === 'pay_driver' ? <View style={{ marginTop: 8 }}><Text style={{ fontWeight: '700' }}>Pay at</Text>
        {[['pickup', 'Pickup · sender pays'], ['delivery', 'Drop · receiver pays']].map(([point, title]) => <PRadio key={point} checked={cashPoint === point} disabled={!cashPoints.includes(point)} onPress={() => setState(s => ({ ...s, cashCollectionPoint: point }))}>
          <Text>{title}</Text>{!cashPoints.includes(point) ? <Text style={styles.small}>Not available under the current delivery policy</Text> : null}</PRadio>)}
      </View> : null}
    </PSheet> : null}
    {sheet?.type === 'breakup' && fare ? <PSheet title="Fare breakup" onClose={() => setSheet(null)}><PriceSummary pricing={fare} /></PSheet> : null}
    {sheet?.type === 'restricted' ? <PSheet title="Items we do not deliver" onClose={() => setSheet(null)}>{policy.prohibitedItems.map(item => <Text key={item} style={{ lineHeight: 26 }}>• {item}</Text>)}</PSheet> : null}
    {sheet?.type === 'goods' && goodsDraft ? <PSheet title="Goods description" onClose={() => setSheet(null)} footer={<PBtn variant="big" title="Save" style={{ marginTop: 12 }} onPress={() => {
      const message = parcelGoodsError(goodsDraft, policy);
      if (message) { setError(message); return; }
      setSheet(null); change({ parcel: goodsDraft });
    }} />}>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<GoodsFields parcel={goodsDraft} onChange={setGoodsDraft} policy={policy} vehicle={vehicle} /></PSheet> : null}
    {termsOpen ? <TermsDialog terms={quote?.terms || policy.terms} policy={policy} onClose={() => setTermsOpen(false)} /> : null}
  </View>;
}
/** Goods inputs: category, description, weight and packages (plus all three sides without vehicles). */
function GoodsFields({ parcel, onChange, policy, vehicle }) {
  const vehicleMode = parcelVehicleMode(policy);
  const set = (key, value) => onChange({ ...parcel, [key]: value });
  return <View>
    <SelectField label="What are you sending?" value={parcel.category} style={{ marginTop: 12 }} onChange={v => set('category', v)} options={policy.categories.map(c => ({ value: c, label: c }))} />
    <PField label={vehicleMode ? 'Description (optional)' : 'Description'} maxLength={500} value={parcel.description} onChangeText={t => set('description', t)} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      <PField label={vehicleMode ? 'Weight in kg (optional)' : 'Weight (kg)'} keyboardType="decimal-pad" value={String(parcel.weightKg ?? '')} style={{ flexBasis: '45%', flexGrow: 1 }} onChangeText={t => set('weightKg', t)} />
      {vehicleMode ? <PField label="Packages" keyboardType="number-pad" value={String(parcel.packages ?? '')} style={{ flexBasis: '45%', flexGrow: 1 }} onChangeText={t => set('packages', t)} />
        : [['length', 'Length (cm)'], ['width', 'Width (cm)'], ['height', 'Height (cm)']].map(([key, title]) => <PField key={key} label={title} keyboardType="decimal-pad" value={String(parcel[key])} style={{ flexBasis: '45%', flexGrow: 1 }} onChangeText={t => set(key, t)} />)}
    </View>
    {vehicle && Number(parcel.weightKg) > vehicle.maxWeightKg ? <Text style={styles.notice}>This is more than a {vehicle.name} carries ({vehicle.maxWeightKg} kg). You’ll be asked to choose a bigger vehicle.</Text> : null}
    <PField label="Pickup instructions (optional)" maxLength={500} value={parcel.instructions} onChangeText={t => set('instructions', t)} />
  </View>;
}

const VEHICLE = { bicycle: 'Bicycle', bike: 'Bike', auto: 'Auto', car: 'Car' };
function PartnerCard({ partner: p, active }) {
  const { DARK } = useParcelColors();
  const vehicle = [VEHICLE[p.vehicleType], p.vehicleNo].filter(Boolean).join(' · ');
  return <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} accessibilityLabel="Your delivery partner">
    <View style={styles.avatar}>{p.avatar ? <Image source={{ uri: mediaUrl(p.avatar) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Text style={{ fontWeight: '700', color: DARK }}>{(p.name || 'D').trim().charAt(0).toUpperCase()}</Text>}</View>
    <View style={{ flex: 1 }}>
      <Text style={styles.small}>{active ? 'Your delivery partner' : 'Delivered by'}</Text>
      <Text style={{ fontWeight: '700' }}>{p.name}</Text>
      {(vehicle || p.rating > 0) ? <Text style={{ color: MUTED }}>{vehicle}{vehicle && p.rating > 0 ? ' · ' : ''}{p.rating > 0 ? `★ ${Number(p.rating).toFixed(1)}` : ''}</Text> : null}
    </View>
    {p.phone ? <PBtn title="Call" accessibilityLabel={`Call ${p.name}`} onPress={() => Linking.openURL(`tel:${p.phone}`).catch(() => {})} /> : null}
  </View>;
}
/** Animated three-part bar shown while we look for a delivery partner. */
function SearchingBar() {
  const { BLUE } = useParcelColors();
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep(s => (s + 1) % 3), 1000); return () => clearInterval(t); }, []);
  return <View style={{ flexDirection: 'row', gap: 6, marginVertical: 10 }} accessibilityRole="progressbar" accessibilityLabel="Finding a delivery partner">
    {[0, 1, 2].map(i => <View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: i <= step ? BLUE : LINE }} />)}
  </View>;
}

export function ParcelCustomerStatus({ booking: b, justBooked, onWallet }) {
  const { DARK } = useParcelColors();
  const [details, setDetails] = useState(false);
  const unpaid = b.paymentMethod === 'online' && ['payment_pending', 'payment_failed'].includes(b.status);
  const searching = !unpaid && ['searching_for_driver', 'needs_admin_assignment'].includes(b.status);
  return <>
    <PCard style={searching ? { alignItems: 'stretch' } : null}>
      <Text style={{ fontSize: 30, color: DARK, textAlign: searching ? 'center' : 'left' }} importantForAccessibility="no">{unpaid ? '₹' : b.status === 'delivered' ? '✓' : searching ? '⌕' : '▣'}</Text>
      <Text style={[styles.h2, searching && { textAlign: 'center', fontSize: 18 }]}>{searching ? 'Searching for drivers nearby…' : parcelCustomerStatus(b.status)}</Text>
      {searching ? <SearchingBar /> : null}
      <Text style={{ lineHeight: 22 }}>{unpaid ? 'Finish payment securely with Razorpay to confirm your booking.' : b.status === 'cancellation_review' ? 'Your cancellation request is awaiting admin approval. Any eligible payment refund is processed after approval.' : b.status === 'searching_for_driver' ? 'Your request is with nearby delivery partners. We’ll update you when someone accepts.' : b.status === 'needs_admin_assignment' ? 'Our team is helping find an available delivery partner. You don’t need to book again.' : b.status === 'delivered' ? 'Your parcel has reached its destination.' : 'Follow your pickup and delivery updates here.'}</Text>
      {justBooked && !unpaid ? <Text style={styles.notice}>Booking received. {b.paymentMethod === 'online' ? 'Payment successful.' : 'Your pickup request is confirmed.'}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
        <Text style={{ fontSize: 20, fontWeight: '700' }}>{parcelMoney(b.feePaise)}</Text>
        <Text style={{ color: MUTED }}>{b.paymentStatus === 'paid' ? 'Paid online' : b.paymentMethod === 'pay_driver' ? `Cash at ${b.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery'}` : 'Online payment'}</Text>
      </View>
      {b.pickupCode ? <Text style={styles.notice}>Pickup code: <Text style={{ fontWeight: '700' }} selectable>{b.pickupCode}</Text>. Share only when your partner arrives.</Text> : null}
      {b.deliveryCode ? <Text style={styles.notice}>Delivery code: <Text style={{ fontWeight: '700' }} selectable>{b.deliveryCode}</Text>. Share only when your parcel arrives.</Text> : null}
      {b.refund?.toWallet ? <Text style={styles.notice}><Text style={{ fontWeight: '700' }}>{parcelMoney(b.refund.refundedPaise)}</Text> refunded to your Bulkimart wallet. <Text onPress={onWallet} style={{ color: DARK, textDecorationLine: 'underline' }}>View Bulkimart Wallet</Text></Text>
        : b.refund?.status === 'confirmed' ? <Text style={styles.notice}>{parcelMoney(b.refund.refundedPaise)} refunded to your original payment method.</Text>
          : b.refund?.status && b.refund.status !== 'none' ? <Text style={{ marginTop: 8 }}>Your refund is being processed.</Text>
            : b.status === 'cancelled' && b.paymentMethod === 'pay_driver' && b.cash?.status === 'collected_unreconciled' ? <Text style={{ marginTop: 8 }}>The cash you paid is awaiting deposit confirmation and refund review.</Text>
              : b.status === 'cancelled' && b.paymentStatus === 'paid' ? <Text style={{ marginTop: 8 }}>Your payment refund is awaiting review. Its status will appear here once processed.</Text> : null}
      <Pressable onPress={() => setDetails(v => !v)} accessibilityState={{ expanded: details }} style={{ marginTop: 12 }}><Text style={{ fontWeight: '600' }}>{details ? '▾' : '▸'} Booking details</Text></Pressable>
      {details && <View style={{ marginTop: 6 }}><Text selectable>{b.reference}</Text><Text>{b.service?.name || 'Doorstep delivery'}{b.route?.distanceMetres > 0 ? ` · ${(b.route.distanceMetres / 1000).toFixed(2)} km` : ''}</Text></View>}
    </PCard>
    {b.partner && <PartnerCard partner={b.partner} active={!!b.partner.phone} />}
    <PCard>
      <ParcelStop kind="pickup" address={b.details.pickup} /><ParcelStop kind="dropoff" address={b.details.dropoff} />
      {b.service?.name ? <Text style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{[b.service.name, b.details.category, b.details.weightKg ? `${b.details.weightKg} kg` : '', b.details.packages > 1 ? `${b.details.packages} packages` : ''].filter(Boolean).join(' · ')}</Text> : null}
    </PCard>
    <PCard style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={styles.payIcon}><Text style={{ color: '#14804a', fontWeight: '800' }}>₹</Text></View>
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{b.paymentMethod === 'pay_driver' ? 'Cash' : 'Online'}</Text><Text style={{ fontSize: 12, color: MUTED }}>Payment method</Text></View>
      <Text style={{ fontWeight: '700' }}>{parcelMoney(b.feePaise)}</Text>
    </PCard>
  </>;
}
const statusChip = s => s === 'delivered' ? ['#e3f6ea', '#14804a', 'COMPLETED'] : s === 'cancelled' ? ['#fde8eb', '#b0233c', 'CANCELLED'] : s === 'cancellation_review' ? ['#fff3d6', '#7a5200', 'CANCELLATION REQUESTED'] : ['theme', 'theme', parcelCustomerStatus(s).toUpperCase()];
/** One booking in Orders: vehicle, time, fare, both stops, status and Book Again. */
export function ParcelOrderCard({ booking: b, onOpen, onBookAgain }) {
  const { BLUE, TINT } = useParcelColors();
  const chip = statusChip(b.status), [bg, fg, label] = chip[0] === 'theme' ? [TINT, BLUE, chip[2]] : chip;
  return <View style={styles.orderCard}>
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${b.reference}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
      <ParcelVehicleIcon icon={b.service?.icon} size={30} />
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{b.service?.name || 'Parcel delivery'}</Text><Text style={{ fontSize: 12, color: MUTED }}>{b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</Text></View>
      <Text style={{ fontWeight: '800' }}>{parcelRupees(b.feePaise)} ›</Text>
    </Pressable>
    {b.details?.pickup ? <View style={styles.stopBox}><ParcelStop kind="pickup" address={b.details.pickup} /></View> : null}
    {b.details?.dropoff ? <View style={styles.stopBox}><ParcelStop kind="dropoff" address={b.details.dropoff} /></View> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
      <Text style={{ backgroundColor: bg, color: fg, fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>{label}</Text>
      {onBookAgain && b.details?.pickup && b.details?.dropoff ? <PBtn title="Book Again" onPress={onBookAgain} style={{ minHeight: 38, paddingVertical: 8 }} /> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  btn: { minHeight: 44, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  input: { padding: 11, marginTop: 7, borderWidth: 1, borderColor: '#bdcddd', borderRadius: 8, backgroundColor: '#fff', color: INK, fontSize: 16 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 44, paddingVertical: 6 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#64748b', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#64748b', marginTop: 2 },
  card: { padding: 16, marginVertical: 12, borderWidth: 1, borderColor: '#dae4ed', borderRadius: 18, backgroundColor: '#fff' },
  locCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5e5eb', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18 },
  fieldset: { borderWidth: 1, borderColor: '#dae4ed', borderRadius: 12, padding: 16, marginVertical: 8, backgroundColor: '#fff' },
  mapWrap: { overflow: 'hidden', borderWidth: 1, borderColor: '#d5e5eb', borderRadius: 18, backgroundColor: '#eef6f8', marginVertical: 16 },
  mapMessage: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#f3fafc', fontSize: 13, lineHeight: 19.5 },
  result: { padding: 12, borderWidth: 1, borderColor: '#bcdce5', backgroundColor: '#f1fafc', borderRadius: 10, marginTop: 10 },
  small: { color: MUTED, marginTop: 6, fontSize: 12.5 },
  error: { color: '#9c243a', backgroundColor: '#fff0f1', padding: 14, borderRadius: 8, marginVertical: 8, overflow: 'hidden' },
  notice: { marginTop: 8, padding: 12, borderRadius: 8, backgroundColor: '#ecfdf5', color: '#146447', overflow: 'hidden' },
  h2: { fontSize: 21, fontWeight: '700', marginVertical: 8, color: INK },
  h3: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 4, color: INK },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sticky: { padding: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dae4ed', borderRadius: 16, marginTop: 20 },
  stepDot: { width: 25, height: 25, borderRadius: 13, backgroundColor: '#e3eaf0', alignItems: 'center', justifyContent: 'center' },
  service: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 2, borderRadius: 14, backgroundColor: '#f1fafc' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e3f2f7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 16 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, padding: 18, maxHeight: '85%' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 5, borderColor: '#1fa463', backgroundColor: '#fff', marginTop: 1 },
  dotDrop: { borderColor: '#e5334b' },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  stopBox: { backgroundColor: SOFT, borderRadius: 10, paddingHorizontal: 10, marginVertical: 4 },
  tripCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 10, marginBottom: 12 },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: LINE, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginTop: 26 },
  pickupBar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 14, marginBottom: 14 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '47%', flexGrow: 1, minHeight: 128, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 14 },
  searchBox: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, paddingHorizontal: 12, paddingBottom: 10 },
  searchLinks: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 12, marginVertical: 12, paddingVertical: 4 },
  addressList: { backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14 },
  addressRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14 },
  pinTip: { position: 'absolute', top: 28, alignSelf: 'center', backgroundColor: '#1d2533', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  detailsAddress: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: LINE },
  chip: { borderWidth: 1, borderColor: LINE, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#fff' },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  infoBtn: { position: 'absolute', right: 84, top: 10, width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: LINE, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  etaBox: { alignItems: 'center', borderWidth: 1, borderColor: LINE, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  restricted: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff7e0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, marginTop: 12 },
  payIcon: { width: 36, height: 28, borderRadius: 6, backgroundColor: '#dff5e7', alignItems: 'center', justifyContent: 'center' },
  payOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, marginVertical: 6 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(11,20,36,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 22, paddingHorizontal: 18 },
  sheetClose: { alignSelf: 'flex-end', marginRight: 12, marginBottom: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 12 },
  homeTitle: { fontSize: 15, fontWeight: '800', color: INK, marginTop: 18, marginBottom: 10 },
  infoCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 12 },
  orderCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 12, marginBottom: 12 },
});
