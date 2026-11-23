import 'dotenv/config';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Product from '../models/Product.js';

/**
 * Products filed under a system category (Smart Buy, Hot Deals) can never be browsed: those are storefront
 * tabs, not categories. This lists them and, with --apply, moves chosen products to a real category.
 *
 *   node scripts/moveProductsOffSystemCategories.mjs
 *       → lists every product filed under a system category (changes nothing)
 *
 *   node scripts/moveProductsOffSystemCategories.mjs --product=<productId> --to="Clothing & Fashion"
 *       → shows what would change (changes nothing)
 *
 *   node scripts/moveProductsOffSystemCategories.mjs --product=<productId> --to="Clothing & Fashion" --apply
 *       → moves it. --to takes a category name or id of the same storefront; it must be active, not a
 *         system category, and have no active sub-categories (same rule as the seller form).
 */

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
await mongoose.connect(process.env.MONGO_URI);

try {
  const systemCats = await Category.find({ isSystem: true }).select('_id name type').lean();
  const systemIds = systemCats.map((c) => c._id);
  const nameOf = new Map(systemCats.map((c) => [String(c._id), `${c.name} (${c.type})`]));

  if (!args.product) {
    const stuck = await Product.find({ isDeleted: { $ne: true }, $or: [{ category: { $in: systemIds } }, { subCategory: { $in: systemIds } }] })
      .select('_id name sellerName type category status isActive').lean();
    console.log(`${stuck.length} product(s) filed under a system category:`);
    for (const p of stuck) console.log(`- ${p._id}  ${p.name}  | seller: ${p.sellerName || '?'} | in: ${nameOf.get(String(p.category)) || p.category} | ${p.status}${p.isActive ? ', live' : ''}`);
    console.log('\nMove one with: --product=<id> --to="<category name or id>" [--apply]');
  } else {
    if (!args.to || args.to === true) throw new Error('Give the target category with --to="<name or id>"');
    const product = await Product.findById(String(args.product));
    if (!product) throw new Error(`Product ${args.product} not found`);
    const byId = mongoose.isValidObjectId(String(args.to)) ? await Category.findById(String(args.to)) : null;
    const matches = byId ? [byId] : await Category.find({ name: new RegExp(`^${String(args.to).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), type: product.type, isActive: true });
    if (matches.length !== 1) throw new Error(matches.length ? `"${args.to}" matches ${matches.length} categories — use the category id instead` : `No active ${product.type} category named "${args.to}"`);
    const target = matches[0];
    if (target.type !== product.type) throw new Error(`"${target.name}" belongs to ${target.type}, but the product is ${product.type}`);
    if (!target.isActive || target.isSystem) throw new Error(`"${target.name}" cannot hold products (inactive or a storefront tab)`);
    if (await Category.exists({ parent: target._id, isActive: true })) throw new Error(`"${target.name}" has sub-categories — choose one of them`);

    console.log(`Product: ${product.name} (${product._id})`);
    console.log(`  from: ${nameOf.get(String(product.category)) || product.category}`);
    console.log(`  to:   ${target.name} (${target._id})`);
    if (!args.apply) {
      console.log('\nDry run — nothing changed. Add --apply to move it.');
    } else {
      // Same fields the seller form sets (product.controller.js resolveListingCategory): leaf + its parent.
      await Product.updateOne({ _id: product._id }, { $set: { category: target._id, subCategory: target.parent || undefined }, $inc: { __v: 1 } });
      if (!target.parent) await Product.updateOne({ _id: product._id }, { $unset: { subCategory: 1 } });
      console.log('\nMoved.');
    }
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
