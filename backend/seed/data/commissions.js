import { ID } from '../ids.js';

/**
 * Resolution order used by services/commission.service.js (Block 3a):
 *   1. (vendorType, categoryId)  → category-specific override
 *   2. (vendorType, categoryId: null) → global default
 *   3. Seller.commissionRate → last resort
 *
 * TODO(client): confirm real rates. 10% flat is an assumption.
 */
export const commissions = [
  {
    _id: ID.commission(1),
    vendorType: 'general',
    categoryId: null,
    percentage: 10,
    flatFee: 0,
    effectiveDate: new Date('2026-01-01'),
    isActive: true,
  },
  {
    // category-specific override, proves the fallback chain works
    _id: ID.commission(3),
    vendorType: 'general',
    categoryId: ID.cat(4), // Electronics
    percentage: 6,
    flatFee: 5,
    effectiveDate: new Date('2026-01-01'),
    isActive: true,
  },
];
