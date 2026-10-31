// Ports of ParcelMap, ParcelLocationPicker, ParcelBookingFlow and ParcelCustomerStatus (customer side).
// Native differences: the map is react-native-maps (pin by tap or drag); address search uses the backend's
// /api/geo/forward ("Find address") — the web's Google Places type-ahead needs the browser Maps SDK and is not
// available in the app; current location uses expo-location. All quotes, fares and eligibility come from the API.
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { ArrowDownUp, ArrowLeft, CheckCircle2, MapPin, Package } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { getCurrentPosition } from '../../lib/gps';
import { session } from '../../lib/storage';
import { mediaUrl } from '../../api/client';
import { decodePolyline } from '../DeliveryMap';
import { Text } from '../ui';
import SelectField from '../SelectField';
import { newIdempotencyKey } from '../services/ServicePayment';
import { initialParcelJourney, parcelAddressError, parcelCustomerStatus, parcelDraftKey, parcelDraftSnapshot, parcelJourneyInput, parcelLocationLookup, parcelMoney, parcelRequest, readParcelDraft, saveParcelPickup, savedParcelAddress, validParcelLocation } from './parcelLogic';

const BLUE = '#087c9f', DARK = '#096b8c', INK = '#172b46', MUTED = '#52647b';
const MAPS_CONFIGURED = Boolean(Constants.expoConfig?.extra?.mapsConfigured);

export function PBtn({ title, onPress, disabled, variant = 'primary', style, accessibilityLabel, children }) {
  const look = variant === 'primary' ? { backgroundColor: BLUE, borderColor: DARK } : variant === 'big' ? { backgroundColor: BLUE, borderColor: BLUE, minHeight: 50, width: '100%' }
    : variant === 'text' ? { backgroundColor: 'transparent', borderColor: 'transparent' } : variant === 'tab' ? { backgroundColor: '#fff', borderColor: '#cbd5e1' }
      : variant === 'tab-on' ? { backgroundColor: '#D91430', borderColor: '#D91430' } : { backgroundColor: '#fff', borderColor: '#cbd5e1' };
  const color = ['primary', 'big', 'tab-on'].includes(variant) ? '#fff' : variant === 'text' ? DARK : '#475569';
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
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} style={[styles.check, disabled && { opacity: 0.5 }]}>
    <View style={[styles.box, checked && { backgroundColor: BLUE, borderColor: BLUE }]}>{checked ? <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text> : null}</View>
    <View style={{ flex: 1 }}>{children}</View>
  </Pressable>;
}
function PRadio({ checked, onPress, disabled, children }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked, disabled }} style={[styles.check, disabled && { opacity: 0.5 }]}>
    <View style={[styles.radio, checked && { borderColor: BLUE, borderWidth: 6 }]} />
    <View style={{ flex: 1 }}>{children}</View>
  </Pressable>;
}
export const PCard = ({ children, style }) => <View style={[styles.card, style]}>{children}</View>;

export function ParcelMap({ pickup, dropoff, route, editable, onPinChange }) {
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

function PriceSummary({ pricing }) {
  const rows = [['Base fare', pricing.basePaise], ['Distance charge', pricing.distancePaise], ...(pricing.minimumAdjustmentPaise > 0 ? [['Minimum fare adjustment', pricing.minimumAdjustmentPaise]] : []), ['Tax (included)', pricing.taxPaise]];
  return <View style={{ gap: 10, marginVertical: 10 }}>
    {rows.map(([t, v]) => <View key={t} style={styles.row}><Text>{t}</Text><Text>{parcelMoney(v)}</Text></View>)}
    <View style={styles.row}><Text style={{ fontWeight: '700' }}>Total payable</Text><Text style={{ fontWeight: '700' }}>{parcelMoney(pricing.totalPaise)}</Text></View>
  </View>;
}
function RouteSummary({ quote }) {
  return <View style={{ marginVertical: 8 }}>
    <Text>{quote.route?.provider === 'mock' ? <Text style={{ fontWeight: '700' }}>Simulated test route · </Text> : null}{(quote.pricing.distanceMetres / 1000).toFixed(2)} km{quote.route?.durationSeconds > 0 ? ' · about ' + Math.ceil(quote.route.durationSeconds / 60) + ' min travel' : ' · travel time unavailable'}</Text>
    <Text style={styles.small}>Travel time is an estimate, not a confirmed pickup ETA.</Text>
    {quote.route?.provider === 'google_routes' ? <Text style={styles.small}>Google Maps</Text> : null}
  </View>;
}
function TermsDialog({ terms, policy, onClose }) {
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.dialog} accessibilityViewIsModal>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, fontSize: 18, fontWeight: '700' }}>Delivery, payment and cancellation terms</Text><Pressable onPress={onClose} accessibilityLabel="Close terms" hitSlop={10}><Text style={{ fontSize: 22 }}>×</Text></Pressable></View>
        <ScrollView style={{ marginVertical: 12 }}>
          {terms ? <Text style={{ marginBottom: 10 }}>{terms}</Text> : null}
          <Text style={styles.h3}>Delivery</Text>
          <Text>• Parcels up to {policy.maxWeightKg} kg, each side up to {policy.maxDimensionCm} cm.</Text>
          {policy.prohibitedItems?.length > 0 && <Text>• Not allowed: {policy.prohibitedItems.join(', ')}.</Text>}
          <Text>• The delivery partner confirms pickup and delivery with one-time codes shown in your tracking page.</Text>
          <Text style={styles.h3}>Payment</Text>
          <Text>• Pay online with Razorpay, or pay the delivery partner in cash where offered.</Text>
          <Text>• Only the delivery fee is charged — never the value of your parcel.</Text>
          <Text style={styles.h3}>Cancellation and refunds</Text>
          <Text>• You can request cancellation until the delivery partner picks up your parcel. After pickup it can no longer be cancelled.</Text>
          <Text>• Cancellation requests are reviewed by our team.</Text>
          <Text>• Once approved, the amount you paid is refunded to your Bulkimart wallet. Cash paid to the partner is refunded after it is deposited with us.</Text>
        </ScrollView>
        <PBtn variant="big" title="Close" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

export function ParcelBookingFlow({ policy, flags, addresses = [], profile, onBooked }) {
  const router = useRouter();
  const storageKey = parcelDraftKey(profile?._id);
  const [state, setState] = useState(() => readParcelDraft(storageKey, initialParcelJourney(profile, policy)));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [now, setNow] = useState(Date.now()), [termsOpen, setTermsOpen] = useState(false);
  const generation = useRef(0), lock = useRef(false), mounted = useRef(true), controller = useRef(null), latest = useRef(state);
  latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => { if (storageKey) session.setItem(storageKey, JSON.stringify({ version: 1, at: Date.now(), state: parcelDraftSnapshot(state) })); }, [state, storageKey]);
  useEffect(() => { if (!state.quote) return undefined; const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, [state.quote?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = patch => { generation.current++; controller.current?.abort(); setState(s => ({ ...s, ...patch, quote: null, terms: false })); setError(''); setNotice(''); };
  const updateAddress = (kind, value) => change({ [kind]: value, ...(validParcelLocation(value) ? { editing: null } : {}) });
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
  const calculate = () => run(async () => { const quote = await requestQuote(); if (quote) setState(s => ({ ...s, quote, step: 2, terms: false })); });
  const expired = state.quote && new Date(state.quote.expiresAt).getTime() <= now;
  const cashPoints = state.quote?.cashCollectionPoints || (policy.cashCollectionPoint === 'customer_choice' ? ['pickup', 'delivery'] : [policy.cashCollectionPoint === 'pickup' ? 'pickup' : 'delivery']);
  const cashPoint = state.pending?.payload.paymentMethod === 'pay_driver' ? state.pending.payload.cashCollectionPoint || 'delivery' : cashPoints.includes(state.cashCollectionPoint) ? state.cashCollectionPoint : cashPoints.includes('delivery') ? 'delivery' : cashPoints[0];
  const confirmBooking = () => run(async () => {
    let attempt = state.pending;
    if (!attempt) {
      if (!state.terms || !state.paymentMethod) throw new Error('Choose a payment method and accept the delivery terms.');
      const quote = state.quote;
      if (!quote) throw new Error('Calculate your delivery quote again.');
      if (new Date(quote.expiresAt).getTime() - Date.now() < 30000) {
        const fresh = await requestQuote();
        if (!fresh) return;
        setState(s => ({ ...s, quote: fresh, terms: false }));
        setNotice('Your quote has been refreshed. Review the current fare and accept the terms before booking.');
        return;
      }
      attempt = { key: newIdempotencyKey(), payload: { quoteId: quote._id, policyVersion: quote.pricing.policyVersion, paymentMethod: state.paymentMethod, ...(state.paymentMethod === 'pay_driver' ? { cashCollectionPoint: cashPoint } : {}), acceptTerms: true } };
      const snapshot = { ...latest.current, pending: attempt };
      // Saved before sending: a timeout must retry the same quote and key.
      if (storageKey) session.setItem(storageKey, JSON.stringify({ version: 1, at: Date.now(), state: parcelDraftSnapshot(snapshot) }));
      setState(snapshot);
    }
    let body;
    try { body = await parcelRequest('/bookings', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) }); }
    catch (e) {
      if (e.status === 409 && /Quotation expired|Policy changed/i.test(e.message)) setState(s => ({ ...s, pending: null, quote: null, step: 1, terms: false }));
      if (e.status && e.status < 500 && e.status !== 409) setState(s => ({ ...s, pending: null }));
      throw new Error(e.message + ' If confirmation was interrupted, retry safely or check Delivery history.');
    }
    if (!body.data?._id || !body.data.reference) throw new Error('Booking confirmation was interrupted. Retry safely or check Delivery history.');
    if (storageKey) session.removeItem(storageKey);
    if (mounted.current) onBooked(body.data);
  });
  const back = () => { if (state.pending) return; setError(''); setState(s => ({ ...s, step: Math.max(0, s.step - 1) })); };
  const saved = kind => addresses.length > 0 && <SelectField label={`Saved ${kind === 'pickup' ? 'pickup' : 'drop'} address`} value="" placeholder="Choose a saved address" style={{ marginTop: 8 }}
    options={addresses.map(a => ({ value: a._id, label: `${a.label || a.name}: ${a.line1}` }))} onChange={idValue => { const a = addresses.find(x => x._id === idValue); if (a) updateAddress(kind, savedParcelAddress(a)); }} />;
  const toggleEditing = kind => setState(s => ({ ...s, editing: s.editing === kind && validParcelLocation(s[kind]) ? null : kind }));
  const locationCard = kind => <View style={styles.locCard}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <MapPin size={20} color={DARK} /><Text style={{ fontSize: 17, fontWeight: '700', flex: 1, color: DARK }}>{kind === 'pickup' ? 'Pickup' : 'Drop'}</Text>
      <PBtn variant="text" disabled={busy} onPress={() => toggleEditing(kind)} title={state.editing === kind && validParcelLocation(state[kind]) ? 'Done' : validParcelLocation(state[kind]) ? 'Edit' : 'Choose location'} style={{ margin: 0 }} />
    </View>
    <Text style={{ marginVertical: 8, lineHeight: 22 }}>{state[kind].address || (kind === 'pickup' ? 'Where should we collect your parcel?' : 'Where is your parcel going?')}</Text>
    {state[kind].pincode ? <Text style={styles.small}>Pincode: {state[kind].pincode}</Text> : null}
    {state[kind].approximate ? <Text style={styles.small}>Approximate address — confirm the building details.</Text> : null}
    {saved(kind)}
    {state.editing === kind && <View style={{ marginTop: 12 }}>
      <Text style={styles.h3}>{kind === 'pickup' ? 'Choose pickup location' : 'Choose drop location'}</Text>
      <Text>Use your current location to find a nearby address, or search and confirm a pin.</Text>
      <ParcelLocationPicker key={kind} showMap pinKind={kind} label={kind === 'pickup' ? 'Search pickup address' : 'Search drop address'} value={state[kind]} initialQuery={state[kind].address} onChange={v => updateAddress(kind, v)} />
    </View>}
  </View>;
  const detailFields = kind => <View style={styles.fieldset}>
    <Text style={{ fontSize: 18, fontWeight: '700' }}>{kind === 'pickup' ? 'Pickup details' : 'Drop details'}</Text>
    {[['building', 'House / flat / building (optional)', 100], ['address', 'Street, locality and city', 400], ['landmark', 'Landmark (optional)', 100], ['pincode', 'Pincode', 6], ['name', 'Contact name', 100], ['phone', 'Contact phone', 16]].map(([key, title, max]) =>
      <PField key={key} label={title} value={state[kind][key] || ''} maxLength={max} keyboardType={key === 'phone' ? 'phone-pad' : key === 'pincode' ? 'number-pad' : 'default'} onChangeText={t => change({ [kind]: { ...state[kind], [key]: t } })} />)}
    <SelectField label="Address label" value={state[kind].label} onChange={v => change({ [kind]: { ...state[kind], label: v } })} options={['Home', 'Work', 'Other'].map(l => ({ value: l, label: l }))} />
  </View>;
  const addressSummary = <View style={[styles.card, { gap: 12 }]}>{['pickup', 'dropoff'].map(kind => <View key={kind}>
    <Text style={{ fontWeight: '700' }}>{kind === 'pickup' ? 'Pickup' : 'Drop'}</Text>
    <Text>{[state[kind].building, state[kind].address, state[kind].landmark].filter(Boolean).join(', ')}</Text>
    <Text style={styles.small}>{state[kind].name} · {state[kind].phone}</Text>
  </View>)}</View>;
  const quote = state.quote;
  const allowCash = flags.pay_driver && policy.payDriverEnabled && policy.payDriverCategories?.includes(state.parcel.category);
  return <View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 24 }}>
      {state.step > 0 ? <PBtn variant="outline" accessibilityLabel="Back to previous step" disabled={busy || !!state.pending} onPress={back} style={{ padding: 10 }}><ArrowLeft size={20} color={DARK} /></PBtn>
        : <Pressable onPress={() => router.navigate('/')} accessibilityLabel="Back to home" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><ArrowLeft size={22} color={DARK} /></Pressable>}
      <View style={{ flex: 1 }}><Text style={{ fontSize: 24, fontWeight: '700' }}>Send a Parcel</Text><Text style={{ color: MUTED, marginTop: 5 }}>Doorstep pickup and delivery</Text></View>
      <Package size={36} color={DARK} />
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, gap: 6 }} accessibilityLabel="Booking progress">
      {['Locations', 'Details', 'Delivery', 'Review'].map((title, i) => <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={[styles.stepDot, state.step >= i && { backgroundColor: BLUE }]}><Text style={{ fontSize: 12, color: state.step >= i ? '#fff' : MUTED }}>{i + 1}</Text></View>
        <Text style={{ fontSize: 12, color: state.step === i ? DARK : MUTED, fontWeight: state.step === i ? '700' : '400' }}>{title}</Text>
      </View>)}
    </View>
    {state.step <= 1 && <Text style={{ fontSize: 13, color: '#146447', marginBottom: 8 }}>Set your parcel pickup and drop here. Changing the shopping delivery location does not change these addresses. Both pins and pincodes must be in an approved parcel service area.</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {state.step === 0 && <View>
      <View style={{ gap: 12 }}>
        {locationCard('pickup')}
        <PBtn variant="outline" accessibilityLabel="Switch pickup and drop locations" disabled={busy} onPress={() => change({ pickup: state.dropoff, dropoff: state.pickup, editing: null })} style={{ alignSelf: 'flex-end', backgroundColor: '#fff5e8', borderColor: '#e2b778' }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ArrowDownUp size={20} color="#794508" /><Text style={{ color: '#794508' }}>Switch</Text></View>
        </PBtn>
        {locationCard('dropoff')}
      </View>
      <View style={styles.sticky}>
        <PBtn variant="big" title="Confirm locations" disabled={busy || !validParcelLocation(state.pickup) || !validParcelLocation(state.dropoff)} onPress={() => { if (validParcelLocation(state.pickup) && validParcelLocation(state.dropoff)) setState(s => ({ ...s, step: 1 })); }} />
        <Text style={[styles.small, { textAlign: 'center' }]}>Delivery availability is checked with your parcel details.</Text>
      </View>
    </View>}
    {state.step === 1 && <View>
      {detailFields('pickup')}{detailFields('dropoff')}
      <PBtn title="Save pickup to my addresses" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => run(async () => {
        const message = parcelAddressError(state.pickup); if (message) throw new Error(message);
        await saveParcelPickup(state.pickup);
        setNotice('Pickup location saved to your addresses using your profile contact. Recipient contact details stay on this booking.');
      })} />
      <PCard>
        <Text style={styles.h2}>What are you sending?</Text>
        <Text>Up to {policy.maxWeightKg} kg · Each side up to {policy.maxDimensionCm} cm</Text>
        <SelectField label="Parcel category" value={state.parcel.category} style={{ marginTop: 12 }} onChange={v => change({ parcel: { ...state.parcel, category: v } })} options={policy.categories.map(c => ({ value: c, label: c }))} />
        <PField label="Parcel description" multiline maxLength={500} value={state.parcel.description} onChangeText={t => change({ parcel: { ...state.parcel, description: t } })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {[['weightKg', 'Weight (kg)'], ['length', 'Length (cm)'], ['width', 'Width (cm)'], ['height', 'Height (cm)']].map(([key, title]) =>
            <PField key={key} label={title} keyboardType="decimal-pad" value={String(state.parcel[key])} style={{ flexBasis: '45%', flexGrow: 1 }} onChangeText={t => change({ parcel: { ...state.parcel, [key]: t } })} />)}
        </View>
        <PField label="Pickup instructions (optional)" multiline maxLength={500} value={state.parcel.instructions} onChangeText={t => change({ parcel: { ...state.parcel, instructions: t } })} />
        <Text style={{ marginVertical: 8 }}>Prohibited items: {policy.prohibitedItems.join(', ')}.</Text>
        <PCheck checked={state.parcel.acceptRestrictions} onPress={() => change({ parcel: { ...state.parcel, acceptRestrictions: !state.parcel.acceptRestrictions } })}><Text>My parcel meets these restrictions and limits.</Text></PCheck>
      </PCard>
      <View style={styles.sticky}><PBtn variant="big" disabled={busy} title={busy ? 'Checking route and delivery fee…' : 'Confirm drop details'} onPress={calculate} /></View>
    </View>}
    {state.step >= 2 && quote && <View>
      {state.step === 2 && <ParcelMap pickup={state.pickup} dropoff={state.dropoff} route={quote.route} />}
      <RouteSummary quote={quote} />
      {addressSummary}
      {state.step === 2 ? <>
        <PCard>
          <Text style={styles.h2}>Delivery service</Text>
          <View style={styles.service} accessibilityState={{ selected: true }}>
            <Package size={38} color={DARK} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700' }}>{quote.service?.name || 'Doorstep delivery'}</Text>
              <Text style={styles.small}>Up to {quote.service?.maxWeightKg || policy.maxWeightKg} kg · {quote.service?.maxDimensionCm || policy.maxDimensionCm} cm per side</Text>
              <Text style={styles.small}>Partner and pickup time confirmed after booking.</Text>
            </View>
            <Text style={{ fontWeight: '700' }}>{parcelMoney(quote.pricing.totalPaise)}</Text>
            <CheckCircle2 size={20} color={BLUE} />
          </View>
        </PCard>
        <View style={styles.sticky}><PBtn variant="big" disabled={busy || expired} title={`Review fare · ${parcelMoney(quote.pricing.totalPaise)}`} onPress={() => setState(s => ({ ...s, step: 3 }))} /></View>
      </> : <>
        <PCard>
          <Text style={styles.h2}>Review your booking</Text>
          <Text>{quote.service?.name || 'Doorstep delivery'} · {state.parcel.category} · {state.parcel.weightKg} kg · {state.parcel.length} × {state.parcel.width} × {state.parcel.height} cm</Text>
          <Text style={{ marginTop: 6 }}>{state.parcel.description}</Text>
          <PriceSummary pricing={quote.pricing} />
          {quote.terms ? <Text style={{ fontSize: 13, color: MUTED }}>{quote.terms}</Text> : null}
          <View style={styles.fieldset}>
            <Text style={{ fontWeight: '700' }}>Payment method</Text>
            {flags.online_payment && <PRadio checked={state.paymentMethod === 'online'} disabled={busy || !!state.pending} onPress={() => setState(s => ({ ...s, paymentMethod: 'online', terms: false }))}><Text>Pay online with Razorpay</Text></PRadio>}
            {allowCash && <PRadio checked={state.paymentMethod === 'pay_driver'} disabled={busy || !!state.pending} onPress={() => setState(s => ({ ...s, paymentMethod: 'pay_driver', terms: false }))}><Text>Cash to delivery partner</Text></PRadio>}
          </View>
          {state.paymentMethod === 'pay_driver' && <>
            <View style={styles.fieldset}>
              <Text style={{ fontWeight: '700' }}>Pay at</Text>
              {[['pickup', 'Pickup · sender pays'], ['delivery', 'Drop · recipient pays']].map(([point, title]) => <PRadio key={point} checked={cashPoint === point} disabled={busy || !!state.pending || !cashPoints.includes(point)} onPress={() => setState(s => ({ ...s, cashCollectionPoint: point, terms: false }))}>
                <Text>{title}</Text>{!cashPoints.includes(point) ? <Text style={styles.small}>Unavailable under the current delivery policy</Text> : null}
              </PRadio>)}
            </View>
            <Text>Keep {parcelMoney(quote.pricing.totalPaise)} ready at {cashPoint === 'pickup' ? 'pickup. The sender pays before handover' : 'drop-off. The recipient pays before delivery'}. Only the delivery fee is collected, not the parcel value.</Text>
          </>}
          <PCheck checked={state.terms} disabled={busy || !!state.pending} onPress={() => setState(s => ({ ...s, terms: !s.terms }))}>
            <Text>I accept the <Text onPress={() => setTermsOpen(true)} style={{ color: DARK, textDecorationLine: 'underline' }}>delivery, payment and cancellation terms</Text>.</Text>
          </PCheck>
        </PCard>
        <View style={styles.sticky}>
          <PBtn variant="big" disabled={busy || (!state.pending && (!state.terms || !state.paymentMethod))} onPress={confirmBooking}
            title={busy ? 'Confirming your booking…' : state.pending ? 'Retry booking safely' : (state.paymentMethod === 'online' ? 'Book & Pay · ' : 'Book Parcel · ') + parcelMoney(quote.pricing.totalPaise)} />
          <Text style={[styles.small, { textAlign: 'center' }]}>Booking is created only when you confirm here.</Text>
        </View>
      </>}
      {!state.pending && <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 }}>
        <Text>{expired ? 'Your quote has expired. ' : 'Fare valid until ' + new Date(quote.expiresAt).toLocaleTimeString() + '. '}</Text>
        <PBtn title={busy ? 'Refreshing…' : 'Refresh quote'} disabled={busy} onPress={calculate} />
      </View>}
      {state.pending && <Text style={{ marginTop: 12 }}>A confirmation attempt is in progress. Retry uses the same booking identity; check Delivery history if the connection was interrupted.</Text>}
      {termsOpen && <TermsDialog terms={quote.terms} policy={policy} onClose={() => setTermsOpen(false)} />}
    </View>}
  </View>;
}

const VEHICLE = { bicycle: 'Bicycle', bike: 'Bike', auto: 'Auto', car: 'Car' };
function PartnerCard({ partner: p, active }) {
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

export function ParcelCustomerStatus({ booking: b, justBooked, onWallet }) {
  const [details, setDetails] = useState(false);
  const unpaid = b.paymentMethod === 'online' && ['payment_pending', 'payment_failed'].includes(b.status);
  return <>
    <PCard>
      <Text style={{ fontSize: 30, color: DARK }} importantForAccessibility="no">{unpaid ? '₹' : b.status === 'delivered' ? '✓' : '▣'}</Text>
      <Text style={styles.h2}>{parcelCustomerStatus(b.status)}</Text>
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
    <PCard style={{ gap: 12 }}>
      <View><Text style={styles.small}>Pickup</Text><Text>{b.details.pickup.address}</Text></View>
      <View><Text style={styles.small}>Deliver to</Text><Text>{b.details.dropoff.address}</Text></View>
    </PCard>
  </>;
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
  service: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 2, borderColor: BLUE, borderRadius: 14, backgroundColor: '#f1fafc' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e3f2f7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'center', padding: 16 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, padding: 18, maxHeight: '85%' },
});
