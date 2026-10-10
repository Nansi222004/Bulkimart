import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import { categoryTree, countTree } from './data/categoryTree.js';

/**
 * npm run seed:categories            — upsert the 3-level tree
 * npm run seed:categories -- --prune — also deactivate categories not in the tree
 *
 * Level 1 (header) → Level 2 (main) → Level 3 (sub), linked through Category.parent.
 *
 * Slugs are built from the FULL PATH, not just the leaf name: "Mango Pickle"
 * legitimately exists under both Grocery › Pickles and SHG › Homemade Pickles,
 * and Category.slug is a unique index.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to run against production.');
  process.exit(1);
}

const PRUNE = process.argv.includes('--prune');

const slugify = (s) =>
  s.toLowerCase().trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n🌳 Seeding category tree into ${mongoose.connection.name}\n`);

  const seenSlugs = new Set();
  let created = 0, updated = 0;

  /** Upsert one node and return its _id so children can point at it. */
  const upsert = async ({ name, slug, type, parent, sortOrder, level }) => {
    seenSlugs.add(slug);
    const existing = await Category.findOne({ slug }, '_id');
    const doc = await Category.findOneAndUpdate(
      { slug },
      { $set: { name, slug, type, parent: parent || null, sortOrder, isActive: true } },
      { upsert: true, returnDocument: 'after' }
    );
    if (existing) updated += 1; else created += 1;
    return doc._id;
  };

  for (const [i, l1] of categoryTree.entries()) {
    // Level-1 slugs carry the channel, so the same name can exist in both the
    // Shop All and Quick sections without one overwriting the other.
    const l1Slug = `${l1.channel}--${slugify(l1.name)}`;
    const l1Id = await upsert({
      name: l1.name, slug: l1Slug, type: l1.channel, parent: null, sortOrder: i + 1, level: 1,
    });
    process.stdout.write(`  ${l1.channel.padEnd(9)} ${l1.name}\n`);

    for (const [j, l2] of (l1.children || []).entries()) {
      const l2Slug = `${l1Slug}--${slugify(l2.name)}`;
      const l2Id = await upsert({
        name: l2.name, slug: l2Slug, type: l1.channel, parent: l1Id, sortOrder: j + 1, level: 2,
      });

      for (const [k, l3] of (l2.children || []).entries()) {
        await upsert({
          name: l3.name,
          slug: `${l2Slug}--${slugify(l3.name)}`,
          type: l1.channel,
          parent: l2Id,
          sortOrder: k + 1,
          level: 3,
        });
      }
    }
  }

  const { l1, l2, l3, total } = countTree();
  console.log(`\n  Level 1 (header): ${l1}\n  Level 2 (main)  : ${l2}\n  Level 3 (sub)   : ${l3}\n  ─────────────────────\n  Total           : ${total}   (${created} new, ${updated} updated)`);

  if (PRUNE) {
    // Never hard-delete: products reference categories. Deactivate instead, and
    // report anything still in use so it can be re-mapped by hand.
    const stale = await Category.find({ slug: { $nin: [...seenSlugs] } }, 'name slug');
    let deactivated = 0, inUse = 0;
    for (const c of stale) {
      const used = await Product.countDocuments({ $or: [{ category: c._id }, { subCategory: c._id }] });
      if (used > 0) { console.log(`  ⚠ kept "${c.name}" — ${used} product(s) still use it`); inUse += 1; continue; }
      await Category.updateOne({ _id: c._id }, { $set: { isActive: false } });
      deactivated += 1;
    }
    console.log(`\n  Pruned: ${deactivated} deactivated, ${inUse} kept (in use)`);
  } else {
    const extra = await Category.countDocuments({ slug: { $nin: [...seenSlugs] }, isActive: true });
    if (extra) console.log(`\n  Note: ${extra} other active categor(ies) exist. Re-run with --prune to deactivate them.`);
  }

  console.log('');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Category seed failed:', err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
