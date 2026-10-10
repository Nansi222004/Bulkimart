import mongoose from 'mongoose';

/**
 * Fixed ObjectIds so deep-links survive `npm run seed:reset` on every machine.
 * Frontend devs can hardcode /product/650000000000000000000101 and it always resolves.
 *
 * Layout of the 24-hex id:  65 <entity> 0000000000000000 <nn>
 */
const oid = (hex) => new mongoose.Types.ObjectId(hex.padEnd(24, '0'));

export const ID = {
  // ---- categories: 6500...
  cat: (n) => oid(`6500${String(n).padStart(20, '0')}`),
  // ---- users: 6501...
  user: (n) => oid(`6501${String(n).padStart(20, '0')}`),
  // ---- sellers: 6502...
  seller: (n) => oid(`6502${String(n).padStart(20, '0')}`),
  // ---- shg stores: 6503...
  shg: (n) => oid(`6503${String(n).padStart(20, '0')}`),
  // ---- products: 6504...
  product: (n) => oid(`6504${String(n).padStart(20, '0')}`),
  // ---- commissions: 6505...
  commission: (n) => oid(`6505${String(n).padStart(20, '0')}`),
  // ---- banners: 6506...
  banner: (n) => oid(`6506${String(n).padStart(20, '0')}`),
  // ---- delivery partners: 6507...   (Day 2)
  partner: (n) => oid(`6507${String(n).padStart(20, '0')}`),
  // ---- orders: 6508...              (Day 2)
  order: (n) => oid(`6508${String(n).padStart(20, '0')}`),
  // ---- ration packages: 6509...     (Day 2)
  ration: (n) => oid(`6509${String(n).padStart(20, '0')}`),
};

/** Placeholder images — never upload to Cloudinary during seeding. */
export const img = (text, w = 600, h = 400) =>
  `https://placehold.co/${w}x${h}?text=${encodeURIComponent(text)}`;
