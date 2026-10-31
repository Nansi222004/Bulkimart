// Port of components/DeliveryMap.jsx with react-native-maps (Google provider): store, home and rider pins, the
// route, leg framing (only when the leg changes) and the "Assigning a delivery partner" / rider cards.
// The web asks Google Directions (JS) for the road; the app draws the route the backend stored for the trip
// (`track.route.polyline`). Addresses without coordinates are located through the backend's /api/geo/forward.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { request } from '../api/client';
import { Text } from './ui';

const MAPS_CONFIGURED = Boolean(Constants.expoConfig?.extra?.mapsConfigured);

const STAGE_TEXT = {
  accepted: { title: 'Partner assigned', sub: 'On the way to the store' },
  arrived_at_store: { title: 'At the store', sub: 'Collecting your order' },
  picked_up: { title: 'Order collected', sub: 'On the way to you' },
  in_transit: { title: 'On the way to you', sub: null },
  arrived_at_customer: { title: 'Arrived at your address', sub: 'Please come to collect it' },
  delivered: { title: 'Delivered', sub: null },
};

/** Google encoded polyline → [{ latitude, longitude }]. */
export function decodePolyline(encoded) {
  if (typeof encoded !== 'string' || !encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

const hasPoint = p => typeof p?.lat === 'number' && typeof p?.lng === 'number';
const toLatLng = p => ({ latitude: p.lat, longitude: p.lng });

function Pin({ glyph, color }) {
  return <View style={{ alignItems: 'center' }}>
    <View style={[styles.pin, { backgroundColor: color }]}><View style={styles.pinInner}><Text style={{ fontSize: 14 }}>{glyph}</Text></View></View>
    <View style={[styles.pinTail, { borderTopColor: color }]} />
  </View>;
}

function useGeocoded(point) {
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    if (hasPoint(point) || !point?.address) return undefined;
    let cancelled = false;
    request(`/api/geo/forward?q=${encodeURIComponent(point.address)}`).then(({ ok, body }) => {
      if (!cancelled && ok && hasPoint(body.data)) setGeo({ ...point, lat: body.data.lat, lng: body.data.lng });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [point?.address, point?.lat, point?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return hasPoint(point) ? point : geo;
}

function Pulse() {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(value, { toValue: 0.25, duration: 600, useNativeDriver: true }), Animated.timing(value, { toValue: 1, duration: 600, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#facc15', opacity: value }} />;
}

export default function DeliveryMap({ pickup, drop, rider, status, stage, etaMin, routePolyline, height = 260 }) {
  const map = useRef(null);
  const framedFor = useRef(undefined);
  const [ready, setReady] = useState(false);
  const shop = useGeocoded(pickup);
  const home = useGeocoded(drop);
  const here = hasPoint(rider?.location) ? rider.location : null;
  const destination = rider?.leg === 'to_customer' ? home : shop;
  const route = decodePolyline(routePolyline);
  const routeError = here && !destination ? `No ${rider?.leg === 'to_customer' ? 'customer' : 'store'} coordinates on this order` : '';

  useEffect(() => {
    if (!ready || !map.current) return;
    const framePath = [here, destination].filter(Boolean);
    if (framedFor.current === rider?.leg || !framePath.length) return;
    framedFor.current = rider?.leg;
    if (framePath.length === 1) map.current.animateCamera({ center: toLatLng(framePath[0]), zoom: 14 }, { duration: 300 });
    else map.current.fitToCoordinates(framePath.map(toLatLng), { edgePadding: { top: 60, bottom: 90, left: 40, right: 40 }, animated: true });
  }, [ready, here?.lat, here?.lng, destination?.lat, destination?.lng, rider?.leg]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!MAPS_CONFIGURED) {
    return <View style={[styles.unavailable, { height }]}>
      <Text style={{ fontSize: 24 }}>🗺️</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Map unavailable</Text>
      <Text style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>The map is unavailable. Search or enter the address instead.</Text>
    </View>;
  }
  const center = shop || home || { lat: 22.7196, lng: 75.8577 };
  const assigning = !rider && ['confirmed', 'preparing', 'dispatched'].includes(status);
  return <View style={styles.wrap}>
    <MapView ref={map} provider={PROVIDER_GOOGLE} style={{ height, width: '100%' }} onMapReady={() => setReady(true)}
      initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
      showsPointsOfInterest={false} toolbarEnabled={false} zoomControlEnabled rotateEnabled={false}>
      {shop && <Marker coordinate={toLatLng(shop)} title={shop.name || 'Store'} tracksViewChanges={false}><Pin glyph="🏪" color="#1b7a37" /></Marker>}
      {home && <Marker coordinate={toLatLng(home)} title={home.name || 'Your address'} tracksViewChanges={false}><Pin glyph="🏠" color="#dc2626" /></Marker>}
      {here && <Marker coordinate={toLatLng(here)} title={rider?.name || 'Delivery partner'} zIndex={3} tracksViewChanges={false}><Pin glyph="🛵" color="#2563eb" /></Marker>}
      {route.length > 1 && <Polyline coordinates={route} strokeColor={rider?.leg === 'to_customer' ? '#1b7a37' : '#f97316'} strokeWidth={5} />}
    </MapView>
    {!ready && <View style={[StyleSheet.absoluteFill, styles.loading]}><Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b' }}>Loading map…</Text></View>}
    {ready && routeError ? <View style={styles.routeError}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>⚠️ {routeError}</Text></View> : null}
    {ready && assigning && <View style={styles.card}>
      <Pulse />
      <View><Text style={styles.cardTitle}>Assigning a delivery partner</Text><Text style={styles.cardSub}>{status === 'dispatched' ? 'Your order is packed and waiting for pickup' : 'The store is preparing your order'}</Text></View>
    </View>}
    {ready && rider && <View style={styles.card}>
      <Text style={{ fontSize: 18 }}>🛵</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{STAGE_TEXT[stage]?.title || (rider.leg === 'to_customer' ? 'On the way to you' : 'Heading to the store')}{etaMin && rider.leg === 'to_customer' ? <Text style={{ opacity: 0.75, color: '#fff' }}> · ~{etaMin} min</Text> : null}</Text>
        <Text style={styles.cardSub}>{rider.name || 'Your delivery partner'}{rider.vehicleNo ? ` · ${rider.vehicleNo}` : ''}{STAGE_TEXT[stage]?.sub ? ` · ${STAGE_TEXT[stage].sub}` : ''}</Text>
      </View>
      {rider.phone ? <Pressable onPress={() => Linking.openURL(`tel:${rider.phone}`).catch(() => {})} style={styles.call}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>📞 Call</Text></Pressable> : null}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: '#e2e8f0' },
  unavailable: { borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20 },
  loading: { backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  routeError: { position: 'absolute', top: 10, left: 12, right: 12, backgroundColor: 'rgba(180,83,9,0.94)', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 11 },
  card: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: 'rgba(15,23,42,0.92)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '800' },
  cardSub: { color: '#fff', fontSize: 10, opacity: 0.75 },
  call: { backgroundColor: '#1b7a37', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  pin: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pinInner: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pinTail: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -2 },
});
