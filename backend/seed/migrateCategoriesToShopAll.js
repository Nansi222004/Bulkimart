import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { CHANNEL } from '../constants/enums.js';

/**
 * npm run migrate:shopall -- --dry-run   (inspect first)
 * npm run migrate:shopall               (apply)
 *
 * Moves every existing category into the "Shop All" section and leaves "Quick"
 * empty, ready to be defined from scratch.
 *
 *   grocery  -> ecommerce   (Shop All)
 *   ecommerce-> ecommerce   (unchanged)
 *   shg      -> shg         (UNTOUCHED — SHG has its own admin section and its
 *                            own marketplace; moving it would break both)
 *
 * It also rebuilds every slug to include the channel:
 *     ecommerce--kitchen--kitchen-tools--peeler
 * Level-1 slugs previously came from the name alone, so the day a Quick category
 * reused a Shop All name the upsert would overwrite it and flip its channel.
 * Deriving the slug from (channel + full name path) makes that impossible.
 *
 * Products whose type was `grocery` are flipped to `ecommerce` too, otherwise
 * product.type and category.type disagree and edits get rejected.
 *
 * Safe to re-run: slugs are computed from names, not from existing slugs.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to run against production.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry-run');

const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n🔀 ${DRY ? 'DRY RUN — nothing will be written' : 'APPLYING'} · ${mongoose.connection.name}\n`);

  const all = await Category.find({}).lean();
  const byId = new Map(all.map((c) => [String(c._id), c]));

  // ---- report the starting state -----------------------------------------
  const before = {};
  all.forEach((c) => { before[c.type] = (before[c.type] || 0) + 1; });
  console.log('  BEFORE');
  Object.entries(before).forEach(([t, n]) => console.log(`    ${t.padEnd(10)} ${n}`));

  const moving = all.filter((c) => c.type === CHANNEL.GROCERY);
  const movingL1 = moving.filter((c) => !c.parent);
  console.log(`\n  Moving to Shop All: ${moving.length} categories (${movingL1.length} header-level)`);
  movingL1.forEach((c) => console.log(`    • ${c.name}`));

  // ---- compute the new type + slug for every category ---------------------
  const targetType = (c) => (c.type === CHANNEL.SHG ? CHANNEL.SHG : CHANNEL.ECOM);

  /** channel + full ancestor name path, e.g. ecommerce--kitchen--kitchen-tools */
  const buildSlug = (cat) => {
    const names = [cat.name];
    let cur = cat;
    for (let i = 0; i < 5 && cur.parent; i += 1) {
      cur = byId.get(String(cur.parent));
      if (!cur) break;
      names.unshift(cur.name);
    }
    return [targetType(cat), ...names.map(slugify)].join('--');
  };

  const taken = new Set();
  const plan = [];

  // shallowest first, so parents settle before children
  const depth = (c) => {
    let d = 0, cur = c;
    while (cur.parent && d < 5) { cur = byId.get(String(cur.parent)); if (!cur) break; d += 1; }
    return d;
  };
  const ordered = [...all].sort((a, b) => depth(a) - depth(b));

  for (const cat of ordered) {
    let slug = buildSlug(cat);
    if (taken.has(slug)) {
      let n = 2;
      while (taken.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    taken.add(slug);

    const newType = targetType(cat);
    if (cat.slug !== slug || cat.type !== newType) {
      plan.push({ _id: cat._id, name: cat.name, oldSlug: cat.slug, slug, oldType: cat.type, type: newType });
    }
  }

  console.log(`\n  Categories to update: ${plan.length}`);
  plan.slice(0, 6).forEach((p) =>
    console.log(`    ${p.name.padEnd(26)} ${p.oldType} → ${p.type}   ${p.oldSlug} → ${p.slug}`));
  if (plan.length > 6) console.log(`    … and ${plan.length - 6} more`);

  // ---- products whose channel must follow their category ------------------
  const productsToFlip = await Product.countDocuments({ type: CHANNEL.GROCERY });
  console.log(`\n  Products to flip grocery → ecommerce: ${productsToFlip}`);

  if (DRY) {
    console.log('\n  AFTER (projected)');
    console.log(`    Shop All (ecommerce): ${all.filter((c) => targetType(c) === CHANNEL.ECOM).length}`);
    console.log(`    Quick    (grocery)  : 0   ← ready to define`);
    console.log(`    SHG                 : ${all.filter((c) => c.type === CHANNEL.SHG).length}   (untouched)`);
    console.log('\n  Nothing written. Re-run without --dry-run to apply.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ---- apply --------------------------------------------------------------
  // Two passes: park every slug on a temporary value first, so renames cannot
  // collide with a slug another row still holds under the unique index.
  if (plan.length) {
    await Category.bulkWrite(plan.map((p, i) => ({
      updateOne: { filter: { _id: p._id }, update: { $set: { slug: `__migrating_${i}__` } } },
    })), { ordered: false });

    await Category.bulkWrite(plan.map((p) => ({
      updateOne: { filter: { _id: p._id }, update: { $set: { slug: p.slug, type: p.type } } },
    })), { ordered: false });
  }

  const prodRes = await Product.updateMany({ type: CHANNEL.GROCERY }, { $set: { type: CHANNEL.ECOM } });

  const after = await Category.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]);
  console.log('\n  AFTER');
  after.forEach((r) => console.log(`    ${String(r._id).padEnd(10)} ${r.n}`));
  console.log(`\n  ✅ ${plan.length} categories updated · ${prodRes.modifiedCount} products flipped`);
  console.log('     Quick section is now empty and ready to configure.\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Migration failed:', err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
