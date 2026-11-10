import { parcelFare, validateParcelPolicy } from '../../services/parcelPolicy.service.js';

// Admin-set slab pricing from the business spec (Part 2): base ₹40 covers 3 km,
// 3–10 km at ₹10/km (driver ₹8), beyond 10 km at ₹8/km (driver ₹6), driver base ₹30.
const spec = { basePaise: 4000, perKmPaise: 800, minimumPaise: 4000, maximumPaise: 10000000, driverBasePaise: 3000, driverPerKmPaise: 600,
  taxRateBps: 0, maxRouteKm: 100, maxWeightKg: 20, includedKm: 3, distanceSlabs: [{ upToKm: 10, perKmPaise: 1000, driverPerKmPaise: 800 }] };
const fare = (km, config, details) => parcelFare(km, { version: 1, config }, details);

describe('parcel fare from admin settings', () => {
  test.each([[2, 4000, 3000], [3, 4000, 3000], [10, 11000, 8600], [16, 15800, 12200]])('%d km → customer %d, driver %d paise (spec table)', (km, customer, driver) => {
    const f = fare(km, spec);
    expect(f).toMatchObject({ totalPaise: customer, driverPaise: driver, platformPaise: customer - driver });
  });
  test('older policies without slabs, included km, tiers or fee price exactly as before', () => {
    const old = { basePaise: 1000, perKmPaise: 200, minimumPaise: 500, maximumPaise: 1000000, driverBasePaise: 500, driverPerKmPaise: 100, taxRateBps: 0, maxRouteKm: 100, maxWeightKg: 20 };
    expect(fare(5.2, old)).toMatchObject({ totalPaise: 2040, driverPaise: 1020, weightSurchargePaise: 0, handlingFeePaise: 0 });
  });
  test('the highest weight tier the parcel exceeds applies, with its driver share; handling fee goes to the platform', () => {
    const config = { ...spec, handlingFeePaise: 800, weightTiers: [{ aboveKg: 4, surchargePaise: 2000, driverPaise: 1000 }, { aboveKg: 10, surchargePaise: 5000, driverPaise: 2500 }] };
    expect(fare(16, config, { weightKg: 3 })).toMatchObject({ totalPaise: 15800 + 800, driverPaise: 12200, weightSurchargePaise: 0 });
    expect(fare(16, config, { weightKg: 5 })).toMatchObject({ totalPaise: 15800 + 2000 + 800, driverPaise: 12200 + 1000, weightSurchargePaise: 2000 });
    expect(fare(16, config, { weightKg: 12 })).toMatchObject({ totalPaise: 15800 + 5000 + 800, driverPaise: 12200 + 2500 });
  });
  test('GST stays included in the fare; customer total = tax + driver + platform', () => {
    const f = fare(16, { ...spec, taxRateBps: 1800 });
    expect(f.totalPaise).toBe(15800);
    expect(f.taxPaise + f.driverPaise + f.platformPaise).toBe(f.totalPaise);
  });
});

const policyInput = extra => ({ approvalReference: 'Pricing test', terms: 'Synthetic terms', effectiveAt: '2026-01-01T00:00:00Z', categories: ['Documents'], prohibitedItems: ['Explosives'],
  areas: [{ name: 'Indore', pincodes: ['452001'], lat: 22.7, lng: 75.8, radiusKm: 10 }],
  basePaise: 4000, perKmPaise: 800, minimumPaise: 4000, maximumPaise: 1000000, driverBasePaise: 3000, driverPerKmPaise: 600, quoteSeconds: 300, acceptanceSeconds: 15, maxAttempts: 3,
  maxActiveTasks: 1, locationMaxAgeSeconds: 300, maxWeightKg: 20, maxDimensionCm: 100, assignmentRadiusKm: 5, maxRouteKm: 50,
  taxTreatment: 'inclusive', cancellationMode: 'admin_review', failureMode: 'admin_review', cashCollectionPoint: 'delivery', partialCash: false, payDriverEnabled: false,
  taxRateBps: 0, payDriverCategories: ['Documents'], ...extra });

describe('parcel pricing settings validation', () => {
  test('accepts slabs, tiers and a handling fee, and marks the policy as weight-surcharged', () => {
    const c = validateParcelPolicy(policyInput({ includedKm: 3, distanceSlabs: [{ upToKm: 10, perKmPaise: 1000, driverPerKmPaise: 800 }], weightTiers: [{ aboveKg: 5, surchargePaise: 2000, driverPaise: 1000 }], handlingFeePaise: 800 }));
    expect(c).toMatchObject({ includedKm: 3, handlingFeePaise: 800, surcharges: 'weight' });
    expect(c.distanceSlabs).toHaveLength(1);
  });
  test('older policy inputs without the new fields still validate', () => {
    expect(validateParcelPolicy(policyInput({ surcharges: 'none' }))).toMatchObject({ includedKm: 0, handlingFeePaise: 0, distanceSlabs: [], weightTiers: [], surcharges: 'none' });
  });
  test.each([
    ['a slab ending before the included km', { includedKm: 5, distanceSlabs: [{ upToKm: 4, perKmPaise: 1000, driverPerKmPaise: 800 }] }],
    ['slabs out of order', { distanceSlabs: [{ upToKm: 10, perKmPaise: 1, driverPerKmPaise: 1 }, { upToKm: 8, perKmPaise: 1, driverPerKmPaise: 1 }] }],
    ['a weight tier at or above the weight limit', { weightTiers: [{ aboveKg: 20, surchargePaise: 100 }] }],
    ['a driver share larger than the surcharge', { weightTiers: [{ aboveKg: 5, surchargePaise: 100, driverPaise: 200 }] }],
    ['a negative handling fee', { handlingFeePaise: -1 }],
  ])('rejects %s', (_label, extra) => { expect(() => validateParcelPolicy(policyInput(extra))).toThrow(); });
});
