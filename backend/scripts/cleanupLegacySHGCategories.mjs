import '../config/bootstrap.js';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';

/**
 * Retire the leftover first-pass SHG category seed.
 *
 * The `shg` channel currently carries two generations of categories: an early,
 * thin seed (4 shallow headers, 3 of them orphaned — their `parent` points at
 * a category that no longer exists, so they're invisible in the admin tree
 * explorer yet still selectable) and the later, complete 3-level seed
 * (Homemade Foods / Handloom & Textiles / Handmade Crafts) that superseded it
 * without the old rows ever being deactivated. Both surface in the same
 * `/api/categories/selectable?type=shg` dropdown, so a seller sees near
 * duplicates like two differently-worded "Cotton Sarees".
 *
 * Soft-deletes (isActive = false) rather than removing rows, matching
 * deleteCategory's own behaviour — reversible, and safe even if a product
 * were already filed against one of these (none currently are; checked below).
 *
 * Run:  node scripts/cleanupLegacySHGCategories.mjs            (report only)
 *       node scripts/cleanupLegacySHGCategories.mjs --apply    (deactivate)
 */

const APPLY = process.argv.includes('--apply');

// The legacy seed's ids — every category from the first-pass shg seed,
// header and leaf alike. Identified by hand from a live dump of
// GET /api/categories/tree?type=shg and /selectable?type=shg: this whole
// family is missing from, or orphaned within, the newer tree.
const LEGACY_IDS = [
  '650000000000000000000019', // Homemade Pickles (header)
  '650000000000000000000301', // └ Mango Pickle
  '650000000000000000000302', // └ Lemon Pickle
  '650000000000000000000022', // Organic Honey and Jaggery (header)
  '650000000000000000000306', // └ Forest Honey
  '650000000000000000000023', // Handmade Soaps and Candles (standalone leaf)
  '650000000000000000000024', // Jute and Cane Products (standalone leaf)
  '650000000000000000000303', // Urad Papad (orphaned — parent no longer resolves)
  '650000000000000000000304', // Cotton Sarees (orphaned — parent no longer resolves)
  '650000000000000000000305', // Dupattas and Stoles (orphaned — parent no longer resolves)
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'} · retiring ${LEGACY_IDS.length} legacy SHG categories\n`);

  const cats = await Category.find({ _id: { $in: LEGACY_IDS }, type: 'shg' });

  for (const cat of cats) {
    const productsUsing = await Product.countDocuments({
      $or: [
        { category: cat._id },
        { subCategory: cat._id },
        { 'channels.category': cat._id },
        { 'channels.subCategory': cat._id },
      ],
    });
    console.log(`${cat.isActive ? 'active  ' : 'inactive'} · ${cat._id} · ${cat.name}${productsUsing ? `  ⚠ ${productsUsing} product(s) reference this` : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --apply to deactivate these.');
    return;
  }

  const result = await Category.updateMany(
    { _id: { $in: LEGACY_IDS }, type: 'shg' },
    { $set: { isActive: false } }
  );
  console.log(`\nDeactivated ${result.modifiedCount} categories.`);
};

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
