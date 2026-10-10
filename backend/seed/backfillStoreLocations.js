// Must be first: loads .env and works around Windows routers refusing the SRV
// lookup that mongodb+srv:// depends on. See config/bootstrap.js.
import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import { reverseGeocode, isGeocodingConfigured } from '../services/geocode.service.js';

/**
 * Give existing stores the coordinates Quick Commerce needs.
 *
 * Sellers who registered before the store-location step existed have an address
 * and a pincode but no lat/lng, which makes them invisible to both the "stores
 * near me" query a shopper runs and the "pickups near me" query a rider runs.
 *
 * Two things are deliberate:
 *
 *  - It geocodes *forward* (address to coordinates), which is the opposite of
 *    what the app does live. That is the only direction available here: all we
 *    have is text somebody typed.
 *
 *  - Anything it fills in is marked `locationSource: 'manual'`, never 'gps'.
 *    A geocoded pincode centroid can be a kilometre from the actual shop, and
 *    an admin reviewing a store deserves to know the difference between that and
 *    a reading taken at the door.
 *
 * Run:  node seed/backfillStoreLocations.js         (report only)
 *       node seed/backfillStoreLocations.js --apply (write)
 */

const APPLY = process.argv.includes('--apply');
const GOOGLE = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Address text to coordinates. Returns undefined rather than guessing. */
const forwardGeocode = async (parts) => {
  const query = parts.filter(Boolean).join(', ');
  if (!query) return undefined;

  const url = `${GOOGLE}?address=${encodeURIComponent(query)}`
    + `&key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY)}`
    + '&region=in&language=en';

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    if (body.status !== 'OK' || !body.results?.length) return undefined;

    const best = body.results[0];
    const { lat, lng } = best.geometry?.location || {};
    if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;

    /**
     * Reject a country-level match.
     *
     * Google does not fail on nonsense: ask it for pincode "999999" and it
     * returns status OK, formatted_address "India", and the coordinates of the
     * geographic centre of the country. Written to a store record that puts the
     * shop in a field in Madhya Pradesh and quietly breaks every radius query
     * it takes part in.
     *
     * A usable match names somewhere — a locality, a postal code, at least a
     * district. Country and nothing else is a miss dressed up as a hit.
     */
    const componentTypes = new Set((best.address_components || []).flatMap((c) => c.types));
    const namesAPlace = ['postal_code', 'locality', 'sublocality', 'administrative_area_level_2',
      'administrative_area_level_3', 'route', 'premise']
      .some((t) => componentTypes.has(t));
    if (!namesAPlace) return undefined;

    return {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      // How precise the match was. APPROXIMATE usually means it landed on a
      // locality or pincode centre, not the building.
      precision: best.geometry?.location_type || 'UNKNOWN',
      matched: best.formatted_address,
    };
  } catch {
    return undefined;
  }
};

const run = async () => {
  if (!isGeocodingConfigured()) {
    console.error('GOOGLE_MAPS_API_KEY is not set — nothing to geocode with.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (report only)'}\n`);

  const sellers = await Seller.find({}, 'businessName storeDetails status');

  let already = 0;
  let indexed = 0;
  let filled = 0;
  let failed = 0;
  const unresolved = [];

  for (const s of sellers) {
    const st = s.storeDetails || {};
    const label = (st.name || s.businessName || String(s._id)).slice(0, 26);

    if (st.lat !== undefined && st.lng !== undefined) {
      /**
       * Having coordinates is not the same as being findable.
       *
       * The 2dsphere index reads `storeDetails.point`, not the flat lat/lng, so
       * a store seeded before that field existed has a perfectly good position
       * and is still invisible to every "stores near me" query. Treating
       * "has lat/lng" as done left seven stores off the map.
       *
       * No geocoding needed here — the coordinates are already known, they just
       * need to be expressed in the shape the index can read.
       */
      const hasPoint = Array.isArray(st.point?.coordinates) && st.point.coordinates.length === 2;
      if (hasPoint) {
        already += 1;
        console.log(`  ok    ${label.padEnd(28)} already at ${st.lat}, ${st.lng}`);
        continue;
      }

      indexed += 1;
      console.log(`  index ${label.padEnd(28)} has ${st.lat}, ${st.lng} but no geo point — adding one`);
      if (APPLY) {
        await Seller.updateOne(
          { _id: s._id },
          {
            $set: {
              'storeDetails.point': { type: 'Point', coordinates: [st.lng, st.lat] },
              // Leave locationSource alone: we do not know how the original
              // coordinates were obtained, and guessing 'gps' would overstate it.
            },
          }
        );
      }
      continue;
    }

    // Most specific first: a full address beats a pincode centroid.
    const attempts = [
      [st.address, st.city, st.state, st.pincode, 'India'],
      [st.city, st.state, st.pincode, 'India'],
      [st.pincode, 'India'],
    ];

    let hit;
    for (const parts of attempts) {
      hit = await forwardGeocode(parts);
      if (hit) break;
    }

    if (!hit) {
      failed += 1;
      unresolved.push({ id: String(s._id), label, address: st.address, city: st.city, pincode: st.pincode });
      console.log(`  FAIL  ${label.padEnd(28)} could not geocode "${[st.address, st.city, st.pincode].filter(Boolean).join(', ') || '(no address at all)'}"`);
      continue;
    }

    filled += 1;
    const note = hit.precision === 'ROOFTOP' ? '' : `  (${hit.precision} — verify with the seller)`;
    console.log(`  fill  ${label.padEnd(28)} ${hit.lat}, ${hit.lng}${note}`);
    console.log(`        matched: ${hit.matched}`);

    if (APPLY) {
      await Seller.updateOne(
        { _id: s._id },
        {
          $set: {
            'storeDetails.lat': hit.lat,
            'storeDetails.lng': hit.lng,
            'storeDetails.point': { type: 'Point', coordinates: [hit.lng, hit.lat] },
            'storeDetails.locationSource': 'manual',
          },
        }
      );
    }
  }

  // Build the index now rather than waiting for the next boot, so the radius
  // queries work the moment this finishes.
  if (APPLY) await Seller.syncIndexes();

  console.log(
    `\n  ${already} already findable`
    + ` · ${indexed} ${APPLY ? 'indexed' : 'need a geo point'}`
    + ` · ${filled} ${APPLY ? 'geocoded' : 'resolvable'}`
    + ` · ${failed} unresolved`
  );

  if (!APPLY && (indexed || filled)) console.log('\n  Re-run with --apply to write these.');

  if (unresolved.length) {
    console.log('\n  These stores need a seller to pin them by hand — a geocoder cannot');
    console.log('  invent an address that was never entered:');
    unresolved.forEach((u) => console.log(`    · ${u.label}  (${u.city || 'no city'}, pin ${u.pincode || 'none'})`));
  }

  if (!APPLY && filled) console.log('\n  Re-run with --apply to write these.');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
