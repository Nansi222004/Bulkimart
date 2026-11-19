import GoToSetting from '../models/GoToSetting.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { distanceKm } from '../utils/geo.js';
import { getRoute } from './maps.service.js';
import { httpError } from '../utils/response.js';

/**
 * Rider "Go To" (destination) mode.
 *
 * A rider sets a destination; the route to it is fetched once and stored on the
 * rider. While the mode is on, an order is offered to them only when:
 *   - its pickup and drop both lie within `corridorKm` of the route,
 *   - the drop is further along the route than the pickup (same direction),
 *   - the pickup is not behind the rider's current position,
 *   - the pickup is within `maxPickupKm` of the rider, and
 *   - it adds at most `maxDetourKm` to the rider's trip to the destination.
 * Normal nearby orders going elsewhere are not offered while the mode is on.
 */

// ---------------------------------------------------------------- admin settings (cached)
const TTL_MS = 60_000;
const DEFAULTS = () => ({ isEnabled: true, corridorKm: 2, maxDetourKm: 4, maxPickupKm: 10, dailyLimit: 2, maxDurationMinutes: 120 });
let cache = null, cachedAt = 0, loading = null;
const pick = (row) => ({ isEnabled: row.isEnabled !== false, corridorKm: row.corridorKm, maxDetourKm: row.maxDetourKm, maxPickupKm: row.maxPickupKm, dailyLimit: row.dailyLimit, maxDurationMinutes: row.maxDurationMinutes });

export const loadGoToSetting = async () => {
  const row = await GoToSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row ? { ...DEFAULTS(), ...pick(row) } : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

/** Synchronous read for hot dispatch paths; refreshes itself in the background. */
export const getGoToSetting = () => {
  if ((!cache || Date.now() - cachedAt > TTL_MS) && !loading) {
    loading = loadGoToSetting().catch(() => {}).finally(() => { loading = null; });
  }
  return cache || DEFAULTS();
};

export const validateGoToSetting = (input = {}) => {
  const num = (key, min, max, label) => {
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label} must be between ${min} and ${max}`);
    return Math.round(n * 100) / 100;
  };
  return {
    isEnabled: input.isEnabled !== false,
    corridorKm: num('corridorKm', 0.2, 20, 'Distance from route'),
    maxDetourKm: num('maxDetourKm', 0, 50, 'Maximum extra distance'),
    maxPickupKm: num('maxPickupKm', 0.5, 100, 'Maximum distance to pickup'),
    dailyLimit: Math.round(num('dailyLimit', 1, 20, 'Uses per day')),
    maxDurationMinutes: Math.round(num('maxDurationMinutes', 10, 720, 'Auto-off time')),
  };
};

// ---------------------------------------------------------------- geometry
const valid = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const toPoint = (p) => (p?.point?.coordinates?.length === 2 ? { lat: p.point.coordinates[1], lng: p.point.coordinates[0] } : p ? { lat: Number(p.lat), lng: Number(p.lng) } : p);

/** Google's encoded polyline format to [[lat, lng], ...]. */
export function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Keeps a point every ~`stepKm` (and always the ends), at most `max` points. */
export function simplifyPath(points, stepKm = 0.1, max = 600) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (distanceKm({ lat: last[0], lng: last[1] }, { lat: points[i][0], lng: points[i][1] }) >= stepKm) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  if (out.length <= max) return out;
  const every = Math.ceil(out.length / max);
  return out.filter((_, i) => i % every === 0 || i === out.length - 1);
}

/**
 * Where `point` sits relative to the route: how far off it (km) and how far
 * along it (km from the start) its closest point is. Flat-earth maths per
 * segment, which is accurate to metres at city scale.
 */
export function projectOnPath(path, point) {
  if (!Array.isArray(path) || path.length < 2 || !valid(point)) return null;
  const kx = 111.32 * Math.cos(point.lat * Math.PI / 180), ky = 110.574;
  let best = null, along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [aLat, aLng] = path[i], [bLat, bLng] = path[i + 1];
    const ax = (aLng - point.lng) * kx, ay = (aLat - point.lat) * ky;
    const bx = (bLng - point.lng) * kx, by = (bLat - point.lat) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy, off = Math.sqrt(cx * cx + cy * cy);
    if (!best || off < best.offKm) best = { offKm: off, alongKm: along + t * len };
    along += len;
  }
  return best;
}

export const pathBbox = (path) => ({
  minLat: Math.min(...path.map((p) => p[0])), maxLat: Math.max(...path.map((p) => p[0])),
  minLng: Math.min(...path.map((p) => p[1])), maxLng: Math.max(...path.map((p) => p[1])),
});

// ---------------------------------------------------------------- rider state
/** The rider's Go To, when switched on and not yet expired (null otherwise). */
export const activeGoTo = (rider, now = new Date()) => {
  const g = rider?.goTo;
  return g?.expiresAt && new Date(g.expiresAt) > now && valid(g.destination) && Array.isArray(g.path) && g.path.length >= 2 ? g : null;
};

/** Today's date in India, the day the daily limit counts. */
export const goToDay = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const goToUsedToday = (rider, now = new Date()) => (rider?.goToUsage?.day === goToDay(now) ? rider.goToUsage.count || 0 : 0);

/**
 * Why an order is not "on the way" for a Go To rider, or null when it is.
 * `rider` needs currentLocation/baseLocation and goTo.
 */
export function goToIneligibility(rider, pickup, drop, settings = getGoToSetting()) {
  const g = activeGoTo(rider);
  if (!g) return null;
  pickup = toPoint(pickup); drop = toPoint(drop);
  if (!valid(pickup) || !valid(drop)) return 'off_route';
  const here = [rider.currentLocation, rider.baseLocation].map(toPoint).find(valid);
  if (!here) return 'off_route';
  const p = projectOnPath(g.path, pickup), d = projectOnPath(g.path, drop), r = projectOnPath(g.path, here);
  if (!p || !d || !r) return 'off_route';
  if (p.offKm > settings.corridorKm || d.offKm > settings.corridorKm) return 'off_route';
  // Same direction: drop further along than pickup, and the pickup not behind the rider.
  if (d.alongKm <= p.alongKm || p.alongKm < r.alongKm - settings.corridorKm) return 'wrong_direction';
  if ((distanceKm(here, pickup) ?? Infinity) > settings.maxPickupKm) return 'pickup_too_far';
  const dest = g.destination;
  const extra = distanceKm(here, pickup) + distanceKm(pickup, drop) + distanceKm(drop, dest) - distanceKm(here, dest);
  if (!Number.isFinite(extra) || extra > settings.maxDetourKm) return 'detour_too_long';
  return null;
}

/** Mongo filter for Go To riders whose route box (padded by the corridor) contains `point`. */
export function goToRouteFilter(point, settings = getGoToSetting(), now = new Date()) {
  const pad = settings.corridorKm / 111;
  const padLng = pad / Math.max(0.1, Math.cos(point.lat * Math.PI / 180));
  return {
    'goTo.expiresAt': { $gt: now },
    'goTo.bbox.minLat': { $lte: point.lat + pad }, 'goTo.bbox.maxLat': { $gte: point.lat - pad },
    'goTo.bbox.minLng': { $lte: point.lng + padLng }, 'goTo.bbox.maxLng': { $gte: point.lng - padLng },
  };
}

/** What the rider app shows. */
export function goToView(rider, settings = getGoToSetting()) {
  const g = activeGoTo(rider), used = goToUsedToday(rider);
  return {
    enabled: settings.isEnabled,
    dailyLimit: settings.dailyLimit, usedToday: used, remainingToday: Math.max(0, settings.dailyLimit - used),
    corridorKm: settings.corridorKm, maxDurationMinutes: settings.maxDurationMinutes,
    active: g ? { destination: g.destination, routeKm: g.routeKm, startedAt: g.startedAt, expiresAt: g.expiresAt } : null,
  };
}

// ---------------------------------------------------------------- start / stop / arrive
export async function startGoTo(partnerId, { origin, destination, address }) {
  const settings = await loadGoToSetting();
  if (!settings.isEnabled) throw httpError(403, 'Go To mode is turned off right now.');
  origin = toPoint(origin); destination = toPoint(destination);
  if (!valid(origin)) throw httpError(400, 'Your current location is needed to plan the route. Turn on GPS and retry.');
  if (!valid(destination)) throw httpError(400, 'Choose where you are going.');
  const straight = distanceKm(origin, destination);
  if (straight < 1) throw httpError(400, 'You are already at this destination. Choose a place at least 1 km away.');
  if (straight > 150) throw httpError(400, 'Choose a destination within 150 km.');

  const rider = await DeliveryPartner.findById(partnerId).select('status goToUsage');
  if (!rider || rider.status !== 'approved') throw httpError(403, 'Approved rider required');
  const day = goToDay(), used = goToUsedToday(rider);
  if (used >= settings.dailyLimit) throw httpError(409, `You have used Go To ${settings.dailyLimit} time${settings.dailyLimit === 1 ? '' : 's'} today. Try again tomorrow.`);

  // The road route when available; a straight line otherwise (still a fair "direction of travel").
  let path = [[origin.lat, origin.lng], [destination.lat, destination.lng]], routeKm = Math.round(straight * 1.3 * 10) / 10;
  try {
    const route = await getRoute(origin, destination);
    const road = route?.polyline ? decodePolyline(route.polyline) : [];
    // Trust the line only when it really runs from the rider to the destination.
    const sane = road.length >= 2 && road.every(([lat, lng]) => valid({ lat, lng }))
      && distanceKm({ lat: road[0][0], lng: road[0][1] }, origin) <= 2
      && distanceKm({ lat: road.at(-1)[0], lng: road.at(-1)[1] }, destination) <= 2;
    if (sane) {
      path = simplifyPath(road);
      if (Number.isFinite(route.distanceKm) && route.distanceKm >= straight) routeKm = Math.round(route.distanceKm * 10) / 10;
    }
  } catch { /* straight line */ }

  const now = new Date();
  const goTo = {
    destination: { lat: destination.lat, lng: destination.lng, address: String(address || '').trim().slice(0, 300) },
    path, routeKm, bbox: pathBbox(path), startedAt: now,
    expiresAt: new Date(now.getTime() + settings.maxDurationMinutes * 60 * 1000),
  };
  // Counted atomically so two quick taps cannot both slip under the limit.
  const updated = await DeliveryPartner.findOneAndUpdate(
    { _id: partnerId, $or: [{ 'goToUsage.day': { $ne: day } }, { 'goToUsage.count': { $lt: settings.dailyLimit } }] },
    [{ $set: {
      goTo: { $literal: goTo },
      currentLocation: { lat: origin.lat, lng: origin.lng, updatedAt: now },
      goToUsage: { day, count: { $cond: [{ $eq: ['$goToUsage.day', day] }, { $add: [{ $ifNull: ['$goToUsage.count', 0] }, 1] }, 1] } },
    } }],
    { returnDocument: 'after', updatePipeline: true },
  ).select('goTo goToUsage currentLocation');
  if (!updated) throw httpError(409, `You have used Go To ${settings.dailyLimit} times today. Try again tomorrow.`);
  return goToView(updated, settings);
}

export async function stopGoTo(partnerId) {
  const rider = await DeliveryPartner.findByIdAndUpdate(partnerId, { $unset: { goTo: 1 } }, { returnDocument: 'after' }).select('goTo goToUsage');
  return goToView(rider);
}

/** Switches Go To off once the rider is within 500 m of the destination. Best effort. */
export async function goToArrivalCheck(rider, point) {
  const g = activeGoTo(rider);
  if (!g || !valid(toPoint(point)) || distanceKm(toPoint(point), g.destination) > 0.5) return false;
  await DeliveryPartner.updateOne({ _id: rider._id, 'goTo.startedAt': g.startedAt }, { $unset: { goTo: 1 } }).catch(() => {});
  return true;
}
