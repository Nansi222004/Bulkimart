import { jest } from '@jest/globals';

jest.unstable_mockModule('../../models/DeliveryRate.js', () => ({ default: {} }));
const { riderPayout, rateSnapshotFor } = await import('../../services/riderPay.service.js');

describe('rider delivery settlement math', () => {
  const rates = { mode: 'quick', base: 20, perKm: 10, minPayout: 35, maxPayout: 50, _id: 'fixture-rate' };

  test('uses the frozen rate snapshot, rounds distance pay, and adds customer tip outside the cap', () => {
    expect(riderPayout(1.25, { mode: 'quick', tip: 3.6, rates })).toMatchObject({
      mode: 'quick', base: 20, perKm: 10, distanceKm: 1.25, distancePay: 13,
      tip: 4, total: 39, rateId: 'fixture-rate',
    });
    expect(riderPayout(9, { mode: 'quick', tip: 2, rates })).toMatchObject({
      distancePay: 90, total: 52,
    });
  });

  test('floors short trips at one kilometre, clamps negative tips, and snapshots the active rate shape', () => {
    expect(riderPayout(0.2, { mode: 'quick', tip: -4, rates })).toMatchObject({
      distanceKm: 0.2, distancePay: 10, tip: 0, total: 35,
    });
    expect(rateSnapshotFor('quick')).toMatchObject({ mode: 'quick' });
  });
});
