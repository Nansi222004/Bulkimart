import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../utils/googleMaps';

/**
 * The live tracking map.
 *
 * Three states, and the middle one is the reason this component exists:
 *
 *   1. no rider yet  — shop and destination pinned, a dashed line between them,
 *                      and an "assigning a partner" banner. The customer can see
 *                      where their food is coming from while they wait.
 *   2. rider assigned — a third marker that moves as pings arrive.
 *   3. delivered      — the map settles on the destination.
 *
 * Showing nothing until somebody accepts is what most half-built trackers do,
 * and it reads like the order is lost.
 *
 * The Google Maps script is loaded once per page and shared. Loading it per
 * mount would re-inject the tag on every navigation, and Google warns about
 * exactly that in the console.
 */

/** A coloured dot with a glyph, drawn inline so there is nothing extra to fetch. */
const pin = (glyph, color) => ({
  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
       <path d="M20 47c0 0-16-18-16-28a16 16 0 1 1 32 0c0 10-16 28-16 28z" fill="${color}"/>
       <circle cx="20" cy="19" r="12" fill="#fff"/>
       <text x="20" y="24" font-size="14" text-anchor="middle">${glyph}</text>
     </svg>`
  ),
  scaledSize: new window.google.maps.Size(34, 41),
  anchor: new window.google.maps.Point(17, 41),
});

/**
 * What the customer is told at each point of the trip.
 *
 * Keyed on the delivery stage rather than the order status, because the order
 * says "out for delivery" for the whole journey and that sentence stops being
 * informative about ten seconds in.
 */
const STAGE_TEXT = {
  accepted: { title: 'Partner assigned', sub: 'On the way to the store' },
  arrived_at_store: { title: 'At the store', sub: 'Collecting your order' },
  picked_up: { title: 'Order collected', sub: 'On the way to you' },
  in_transit: { title: 'On the way to you', sub: null },
  arrived_at_customer: { title: 'Arrived at your address', sub: 'Please come to collect it' },
  delivered: { title: 'Delivered', sub: null },
};

export const DeliveryMap = ({
  pickup, drop, rider, status, stage, etaMin, height = 260,
  /**
   * Optional. Called with the real route figures each time a route is drawn
   * ({ distanceText, distanceMeters, durationText, durationMinutes,
   * instruction }), and with null when routing fails. The customer tracking page
   * does not pass it; the rider's screen uses it for its navigation strip.
   */
  onRoute,
  /**
   * The overlay naming the partner and offering a Call button. Right for the
   * customer, wrong for the rider — it would introduce them to themselves and
   * offer to ring their own phone.
   */
  showRiderCard = true,
}) => {
  const holder = useRef(null);
  const map = useRef(null);
  const markers = useRef({});
  const directionsRenderer = useRef(null);
  // Held in a ref so a caller passing an inline arrow does not have to be a
  // dependency of the draw effect — that would re-run it on every parent render.
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  // What the route was last drawn from — { leg, from } — so a redraw is only
  // requested when the leg changes or the rider has genuinely moved on.
  const lastRouteKey = useRef(null);
  // Which leg the viewport was framed for; stops the map re-zooming on every ping.
  const framedFor = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  // Directions could not answer. The markers and the map stay; only the road is
  // missing, and saying so beats drawing a line that is not a road.
  const [routeError, setRouteError] = useState('');
  // Geocoded coordinates for points that arrived without lat/lng (old orders,
  // sellers who never set GPS). Null until the Geocoder resolves the address.
  const [geoPickup, setGeoPickup] = useState(null);
  const [geoDrop, setGeoDrop] = useState(null);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // ---- create the map once -------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !holder.current) return;

        map.current = new maps.Map(holder.current, {
          center: pickup || drop || { lat: 22.7196, lng: 75.8577 },
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
          // Keep the eye on the markers rather than on every shop in the area.
          styles: [
            { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          ],
        });
        setReady(true);
      })
      .catch((err) => !cancelled && setError(err.message));

    return () => { cancelled = true; };
  }, [apiKey]);

  // ---- geocode points that are missing lat/lng -----------------------------
  useEffect(() => {
    if (!ready || !map.current) return;
    const geocoder = new window.google.maps.Geocoder();

    const geocodeIfNeeded = (point, setter) => {
      // Already has coords — nothing to do.
      if (point?.lat !== undefined && point?.lng !== undefined) return;
      // No address text to geocode with.
      if (!point?.address) return;

      geocoder.geocode({ address: point.address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          setter((prev) => {
            // Avoid a re-render if we already have these coords.
            if (prev?.lat === loc.lat() && prev?.lng === loc.lng()) return prev;
            return { ...point, lat: loc.lat(), lng: loc.lng() };
          });
        }
      });
    };

    geocodeIfNeeded(pickup, setGeoPickup);
    geocodeIfNeeded(drop, setGeoDrop);
  }, [ready, pickup, drop]);

  // ---- keep markers in step with the props --------------------------------
  useEffect(() => {
    if (!ready || !map.current) return;
    const maps = window.google.maps;

    const place = (key, position, glyph, color, title) => {
      if (!position || position.lat === undefined || position.lng === undefined) {
        markers.current[key]?.setMap(null);
        delete markers.current[key];
        return;
      }
      if (markers.current[key]) {
        // Move the existing marker rather than replacing it, so the rider
        // appears to travel instead of blinking from place to place.
        markers.current[key].setPosition(position);
      } else {
        markers.current[key] = new maps.Marker({
          map: map.current, position, title, icon: pin(glyph, color), zIndex: key === 'rider' ? 3 : 1,
        });
      }
    };

    // Prefer prop coords; fall back to geocoded coords for old/GPS-less records.
    const resolvedPickup = pickup?.lat !== undefined ? pickup : geoPickup;
    const resolvedDrop   = drop?.lat   !== undefined ? drop   : geoDrop;

    place('pickup', resolvedPickup, '🏪', '#1b7a37', resolvedPickup?.name || 'Store');
    place('drop',   resolvedDrop,   '🏠', '#dc2626', resolvedDrop?.name   || 'Your address');
    place('rider', rider?.location, '🛵', '#2563eb', rider?.name || 'Delivery partner');

    const here = rider?.location?.lat !== undefined ? rider.location : null;
    const shop = resolvedPickup?.lat !== undefined ? resolvedPickup : null;
    const home = resolvedDrop?.lat   !== undefined ? resolvedDrop   : null;

    /**
     * Road-based directions replace the old dashed straight line.
     *
     * Two legs, two colours:
     *   - Orange  (#f97316) — rider heading to the store (before pickup)
     *   - Green   (#1b7a37) — rider heading to the customer (after pickup)
     *
     * The route is only re-fetched when the leg changes or the rider has moved
     * more than ~100 m (3 decimal places ≈ 111 m). Calling Directions on every
     * location ping would burn quota and produce no visible improvement — the
     * road does not change because the rider moved 5 metres.
     */
    const fetchRoute = (origin, destination, color) => {
      // Clean up any previous renderer before drawing a new one.
      directionsRenderer.current?.setMap(null);
      directionsRenderer.current = null;

      const svc = new maps.DirectionsService();
      const renderer = new maps.DirectionsRenderer({
        map: map.current,
        suppressMarkers: true,   // our own pin() markers are already on the map
        polylineOptions: {
          strokeColor: color,
          strokeWeight: 5,
          strokeOpacity: 0.85,
        },
      });

      svc.route(
        {
          origin: new maps.LatLng(origin.lat, origin.lng),
          destination: new maps.LatLng(destination.lat, destination.lng),
          travelMode: maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK') {
            renderer.setDirections(result);
            setRouteError('');

            /**
             * Hand the real numbers back to whoever is rendering this.
             *
             * Distance and duration come from the route Google actually
             * returned, so they account for one-ways and traffic-free driving
             * time rather than the straight-line gap between two pins. The first
             * step's instruction is the "Head east for 800 m" line — real, and
             * only shown when Directions supplied one.
             */
            const leg = result.routes?.[0]?.legs?.[0];
            onRouteRef.current?.({
              distanceText: leg?.distance?.text,
              distanceMeters: leg?.distance?.value,
              durationText: leg?.duration?.text,
              durationMinutes: leg?.duration?.value != null
                ? Math.round(leg.duration.value / 60)
                : undefined,
              // instructions carry HTML (<b>, <div>) — strip it rather than
              // dangerously setting it into the DOM.
              instruction: leg?.steps?.[0]?.instructions
                ?.replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || undefined,
            });
          } else {
            /**
             * No invented road.
             *
             * This used to draw a straight line between the two pins when
             * Directions failed, which looks exactly like a route and is not
             * one — it would send a rider across a river. The markers stay, the
             * map stays, and the caller is told the route is unavailable.
             */
            renderer.setMap(null);
            // Allow a later cycle to try again rather than sitting on the failure.
            lastRouteKey.current = null;
            setRouteError(
              status === 'ZERO_RESULTS'
                ? 'No drivable route between these two points'
                : 'Route unavailable right now'
            );
            onRouteRef.current?.(null);
          }
        }
      );

      return renderer;
    };

    /**
     * Decide whether the road actually needs re-asking.
     *
     * Measured from where the route was last drawn, rather than snapping the
     * rider onto a grid of rounded coordinates. A grid boundary sits somewhere,
     * and a rider travelling along one flips across it repeatedly — firing a
     * fresh billed Directions request each time while barely moving.
     *
     * The leg changing always forces a redraw: shop and customer are different
     * destinations, and that is the one moment the line must visibly switch.
     */
    const movedFar = (a, b) => {
      if (!a || !b) return true;
      const R = 6371000, t = (x) => (x * Math.PI) / 180;
      const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h)) > 150;   // metres
    };

    const destination = rider?.leg === 'to_customer' ? home : shop;

    /**
     * Nothing to route to.
     *
     * Roughly a third of the orders on this platform were placed before the
     * checkout captured coordinates, so this is a real state, not a defensive
     * hypothetical. Saying which point is missing beats routing to a guess —
     * the address text is still on screen for the rider to read.
     */
    if (here && !destination) {
      directionsRenderer.current?.setMap(null);
      directionsRenderer.current = null;
      lastRouteKey.current = null;
      setRouteError(
        `No ${rider?.leg === 'to_customer' ? 'customer' : 'store'} coordinates on this order`
      );
      onRouteRef.current?.(null);
    }

    const legChanged = lastRouteKey.current?.leg !== rider?.leg;
    const needsRoute = here && destination
      && (legChanged || movedFar(lastRouteKey.current?.from, here));

    if (needsRoute) {
      lastRouteKey.current = { leg: rider?.leg, from: here };

      // Orange to the shop, green to the customer — the colour is the fastest
      // way to read which half of the trip is in progress.
      directionsRenderer.current = rider?.leg === 'to_customer'
        ? fetchRoute(here, home, '#1b7a37')
        : fetchRoute(here, shop, '#f97316');
    }

    /**
     * Frame the leg, but only when it changes.
     *
     * Re-fitting on every ping re-zooms the map every few seconds, so the
     * ground slides under the customer while they are trying to read it — and
     * it overrides any panning or zooming they did themselves. The view is set
     * when the journey changes shape; after that the rider simply moves across
     * a map that is holding still.
     */
    const framePath = [here, destination].filter(Boolean);
    if (framedFor.current !== rider?.leg && framePath.length) {
      framedFor.current = rider?.leg;

      if (framePath.length === 1) {
        map.current.setCenter(framePath[0]);
      } else {
        const bounds = new maps.LatLngBounds();
        framePath.forEach((p) => bounds.extend(p));
        map.current.fitBounds(bounds, { top: 60, bottom: 90, left: 40, right: 40 });
      }
    }
    /**
     * No cleanup here, deliberately.
     *
     * This effect re-runs on every location ping, because `rider` is a fresh
     * object each time. Tearing the route down in cleanup removed it on every
     * ping — and the throttle above then refused to redraw it until the rider
     * had moved 150 m, so the line vanished seconds after appearing and stayed
     * gone. The route outlives the render; it is replaced when it is genuinely
     * stale, and disposed on unmount below.
     */
  }, [ready, pickup, drop, rider, geoPickup, geoDrop]);

  // Dispose the overlays once, when the map itself goes away.
  useEffect(() => () => {
    directionsRenderer.current?.setMap(null);
    Object.values(markers.current).forEach((m) => m.setMap(null));
  }, []);

  // ---- the map cannot be shown --------------------------------------------
  if (error) {
    return (
      <div style={{
        height, borderRadius: 12, background: '#f8fafc', border: '1.5px dashed #cbd5e1',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 6, padding: 20, textAlign: 'center',
      }}>
        <span style={{ fontSize: 24 }}>🗺️</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Map unavailable</span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{error}</span>
      </div>
    );
  }

  const assigning = !rider && ['confirmed', 'preparing', 'dispatched'].includes(status);

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e2e8f0' }}>
      <div ref={holder} style={{ height, width: '100%', background: '#e5e7eb' }} />

      {!ready && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f1f5f9', fontSize: 12, fontWeight: 700, color: '#64748b',
        }}>
          Loading map…
        </div>
      )}

      {/* The pins are still right; only the road between them is missing. */}
      {ready && routeError && (
        <div style={{
          position: 'absolute', top: 10, left: 12, right: 12,
          background: 'rgba(180,83,9,0.94)', color: '#fff', borderRadius: 8,
          padding: '7px 11px', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <span>⚠️</span>
          <span>{routeError}</span>
        </div>
      )}

      {/* The waiting state, which is most of the customer's experience. */}
      {ready && assigning && (
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 12,
          background: 'rgba(15,23,42,0.92)', color: '#fff', borderRadius: 10,
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: '#facc15', flexShrink: 0,
            animation: 'nhPulse 1.2s ease-in-out infinite',
          }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800 }}>Assigning a delivery partner</div>
            <div style={{ fontSize: 10, opacity: 0.75 }}>
              {status === 'dispatched'
                ? 'Your order is packed and waiting for pickup'
                : 'The store is preparing your order'}
            </div>
          </div>
        </div>
      )}

      {ready && rider && showRiderCard && (
        <div style={{
          position: 'absolute', left: 12, right: 12, bottom: 12,
          background: 'rgba(15,23,42,0.92)', color: '#fff', borderRadius: 10,
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🛵</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>
              {STAGE_TEXT[stage]?.title
                || (rider.leg === 'to_customer' ? 'On the way to you' : 'Heading to the store')}
              {/* An ETA is only meaningful once the parcel is actually moving
                  towards the customer; before pickup it would be counting down
                  to the wrong place. */}
              {etaMin && rider.leg === 'to_customer' && (
                <span style={{ opacity: 0.75, fontWeight: 700 }}> · ~{etaMin} min</span>
              )}
            </div>
            <div style={{ fontSize: 10, opacity: 0.75 }}>
              {rider.name || 'Your delivery partner'}
              {rider.vehicleNo ? ` · ${rider.vehicleNo}` : ''}
              {STAGE_TEXT[stage]?.sub ? ` · ${STAGE_TEXT[stage].sub}` : ''}
            </div>
          </div>
          {rider.phone && (
            <a
              href={`tel:${rider.phone}`}
              style={{
                background: '#1b7a37', color: '#fff', borderRadius: 8, padding: '6px 10px',
                fontSize: 11, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              📞 Call
            </a>
          )}
        </div>
      )}

      <style>{`@keyframes nhPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  );
};

export default DeliveryMap;
