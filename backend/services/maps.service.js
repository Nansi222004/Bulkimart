// Google Maps API Service. Mock results require an authorized mock runtime.
import { isMockIntegrationEnabled } from '../config/runtime.js';

export const geocodeAddress = async (address) => {
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    // Return hardcoded standard lat/lng
    return { lat: 20.5937, lng: 78.9629, formattedAddress: address };
  }
  
  throw new Error('Real Google Maps geocoding is not implemented');
};

export const getRoute = async (origin, destination) => {
  for (const point of [origin, destination]) {
    if (typeof point?.lat !== 'number' || typeof point?.lng !== 'number' || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) throw new Error('Valid route coordinates required');
  }
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    return {
      distanceKm: 5.2,
      durationMin: 18,
      polyline: null,
      provider: 'mock'
    };
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('Google Routes is not configured');
  let response;
  try {
    response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } }, destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', computeAlternativeRoutes: false }),
    });
    if (!response.ok) throw new Error();
    const route = (await response.json()).routes?.[0];
    const duration = /^\d+(?:\.\d+)?s$/.test(route?.duration || '') ? Number(route.duration.slice(0, -1)) : NaN;
    if (!Number.isFinite(route?.distanceMeters) || route.distanceMeters <= 0 || !Number.isFinite(duration) || duration <= 0 || typeof route.polyline?.encodedPolyline !== 'string' || !route.polyline.encodedPolyline || route.polyline.encodedPolyline.length > 100000) throw new Error();
    return { distanceKm: route.distanceMeters / 1000, durationMin: duration / 60, polyline: route.polyline.encodedPolyline, provider: 'google_routes' };
  } catch {
    // Never propagate provider bodies or request URLs containing credentials.
    throw new Error('Google Routes is unavailable; retry your route');
  }
};

export const getDistanceMatrix = async (origins, destinations) => {
  if (isMockIntegrationEnabled('MAPS_MODE')) {
    return [{ distanceKm: 5.2, durationMin: 18 }];
  }

  throw new Error('Real Google Maps distance matrix is not implemented');
};
