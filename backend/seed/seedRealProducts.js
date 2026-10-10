import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { uploadToCloudinary, verifyCloudinary } from '../services/cloudinary.service.js';
import { CHANNEL, APPROVAL } from '../constants/enums.js';

/**
 * npm run seed:real-products -- --phone 7999810344 [--dry-run]
 *
 * Creates a small, believable catalogue for one real seller so the cart and
 * checkout work can be built against actual data.
 *
 * Unlike the old demo seed, these are ordinary products: they belong to a real
 * seller, sit in real leaf categories from the live tree, and each one gets its
 * OWN generated image uploaded to Cloudinary — no shared placeholder.
 *
 * Safe to re-run: products are matched by (sellerId + name) and skipped if they
 * already exist, so images are never uploaded twice.
 */

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to run against production.');
  process.exit(1);
}

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PHONE = argOf('--phone', '7999810344');
const DRY = process.argv.includes('--dry-run');

/* ==========================================================================
   UNIQUE IMAGE PER PRODUCT
   A deterministic hash of the product name picks the hue, the angle and the
   ornament, so no two products share artwork and re-running produces the same
   image for the same product.
   ========================================================================== */

const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
};

const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Returns an SVG buffer that is unique to this product name. */
const makeImage = (name, categoryPath) => {
  const h = hash(name);
  const hue = h % 360;
  const hue2 = (hue + 28 + (h % 40)) % 360;
  const angle = 25 + (h % 110);
  const ornament = h % 3;          // three different backdrop treatments
  const dark = `hsl(${hue}, 58%, 26%)`;
  const mid = `hsl(${hue2}, 62%, 44%)`;
  const light = `hsl(${hue}, 70%, 92%)`;

  const backdrop = [
    // concentric arcs
    `<g opacity="0.16" fill="none" stroke="${light}" stroke-width="26">
       <circle cx="640" cy="120" r="190"/><circle cx="640" cy="120" r="290"/><circle cx="640" cy="120" r="390"/>
     </g>`,
    // diagonal ribbons
    `<g opacity="0.14" fill="${light}">
       <rect x="-200" y="420" width="1400" height="70" transform="rotate(-18 500 450)"/>
       <rect x="-200" y="560" width="1400" height="40" transform="rotate(-18 500 450)"/>
       <rect x="-200" y="660" width="1400" height="90" transform="rotate(-18 500 450)"/>
     </g>`,
    // scattered dots
    `<g opacity="0.18" fill="${light}">
       ${Array.from({ length: 26 }, (_, i) => {
         const x = ((h >> (i % 12)) * (i + 7)) % 1180 + 40;
         const y = ((h >> (i % 9)) * (i + 3)) % 700 + 40;
         const r = 6 + ((h >> i) % 16);
         return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
       }).join('')}
     </g>`,
  ][ornament];

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle})">
      <stop offset="0%" stop-color="${dark}"/>
      <stop offset="100%" stop-color="${mid}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#g)"/>
  ${backdrop}
  <text x="80" y="330" font-family="Helvetica, Arial, sans-serif" font-size="220" font-weight="700"
        fill="${light}" opacity="0.9">${esc(initials(name))}</text>
  <text x="82" y="440" font-family="Helvetica, Arial, sans-serif" font-size="58" font-weight="600"
        fill="#ffffff">${esc(name.length > 30 ? name.slice(0, 29) + '…' : name)}</text>
  <text x="84" y="500" font-family="Helvetica, Arial, sans-serif" font-size="27"
        fill="${light}" opacity="0.85">${esc(categoryPath)}</text>
  <rect x="80" y="640" width="150" height="7" rx="3" fill="${light}" opacity="0.75"/>
</svg>`, 'utf8');
};

/* ==========================================================================
   CATALOGUE — leaf category paths must exist in the live tree.
   ========================================================================== */

const CATALOGUE = [
  // ---------------- Shop All (e-commerce) ----------------
  { ch: CHANNEL.ECOM, leaf: 'Shirts',              name: 'Cotton Formal Shirt — Sky Blue', price: 899,  mrp: 1499, stock: 40, unit: 'piece', weight: 280, desc: 'Full-sleeve cotton formal shirt with a soft collar. Machine washable, colour-fast.' },
  { ch: CHANNEL.ECOM, leaf: 'Cotton Sarees',       name: 'Handwoven Cotton Saree',         price: 1650, mrp: 2400, stock: 18, unit: 'piece', weight: 600, desc: 'Handloom cotton saree with a contrast border and matching blouse piece.' },
  { ch: CHANNEL.ECOM, leaf: 'Peeler',              name: 'Stainless Steel Peeler',         price: 149,  mrp: 249,  stock: 120, unit: 'piece', weight: 80,  desc: 'Sharp stainless blade with a non-slip grip handle. Dishwasher safe.' },
  { ch: CHANNEL.ECOM, leaf: 'USB Blenders',        name: 'Portable USB Blender 380ml',     price: 1299, mrp: 1999, stock: 25, unit: 'piece', weight: 520, desc: 'Rechargeable travel blender with six stainless blades and a USB-C port.' },
  { ch: CHANNEL.ECOM, leaf: 'LED Bulbs',           name: 'LED Bulb 9W — Pack of 4',        price: 449,  mrp: 720,  stock: 90, unit: 'pack',  weight: 300, desc: 'Cool daylight 9W LED bulbs, B22 base. Two-year replacement warranty.' },

  // ---------------- Quick (grocery) ----------------
  { ch: CHANNEL.GROCERY, leaf: 'Basmati Rice',        name: 'Basmati Rice 5kg',            price: 549, mrp: 699, stock: 60, unit: 'kg',    weight: 5000, desc: 'Aged long-grain basmati. Non-sticky, aromatic, ideal for biryani and pulao.' },
  { ch: CHANNEL.GROCERY, leaf: 'Toor & Arhar Dal',    name: 'Toor Dal 1kg',                price: 165, mrp: 199, stock: 110, unit: 'kg',   weight: 1000, desc: 'Unpolished toor dal, cleaned and sorted. No added colour.' },
  { ch: CHANNEL.GROCERY, leaf: 'Milk',               name: 'Full Cream Milk 1L',           price: 68,  mrp: 72,  stock: 200, unit: 'litre', weight: 1000, desc: 'Homogenised full cream milk, 6% fat. Delivered chilled.' },
  { ch: CHANNEL.GROCERY, leaf: 'Onion, Potato & Tomato', name: 'Onion 2kg',                price: 74,  mrp: 90,  stock: 150, unit: 'kg',   weight: 2000, desc: 'Fresh red onions, hand-sorted. Grade A, uniform size.' },
  { ch: CHANNEL.GROCERY, leaf: 'Cream Biscuits',      name: 'Chocolate Cream Biscuits 300g', price: 55, mrp: 70, stock: 180, unit: 'g',    weight: 300, desc: 'Crunchy biscuits with a cocoa cream filling. Pack of three sleeves.' },
];

/* ========================================================================== */

const run = async () => {
  const cl = await verifyCloudinary();
  if (!cl.ok && !DRY) {
    console.error(`\n✖ Cloudinary is not usable: ${cl.message}\n   Run: npm run check:cloudinary\n`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n📦 ${DRY ? 'DRY RUN' : 'CREATING'} products for +91 ${PHONE} · ${mongoose.connection.name}\n`);

  const user = await User.findOne({ phone: PHONE });
  if (!user) { console.error(`✖ No user with phone ${PHONE}`); process.exit(1); }

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) { console.error(`✖ ${PHONE} has no seller profile`); process.exit(1); }
  if (seller.status !== 'approved') {
    console.error(`✖ Seller "${seller.businessName}" is "${seller.status}" — approve them first`);
    process.exit(1);
  }
  console.log(`  Seller: ${seller.storeDetails?.name || seller.businessName}  [${seller.status}]\n`);

  // resolve each leaf name to a real category in the right channel
  const pathOf = async (cat) => {
    const parts = [cat.name];
    let cur = cat;
    for (let i = 0; i < 4 && cur.parent; i += 1) {
      cur = await Category.findById(cur.parent);
      if (!cur) break;
      parts.unshift(cur.name);
    }
    return parts.join(' › ');
  };

  let created = 0, skipped = 0, missing = 0;

  for (const item of CATALOGUE) {
    const cat = await Category.findOne({ name: item.leaf, type: item.ch, isActive: true });
    if (!cat) {
      console.log(`  ✖ ${item.name.padEnd(34)} category "${item.leaf}" not found in ${item.ch}`);
      missing += 1;
      continue;
    }

    const existing = await Product.findOne({ sellerId: seller._id, name: item.name, isDeleted: false });
    if (existing) {
      console.log(`  – ${item.name.padEnd(34)} already exists, skipped`);
      skipped += 1;
      continue;
    }

    const path = await pathOf(cat);

    if (DRY) {
      console.log(`  + ${item.name.padEnd(34)} ₹${String(item.price).padEnd(5)} ${path}`);
      created += 1;
      continue;
    }

    // One generated image per product — unique artwork, uploaded individually.
    // Rasterised to PNG on upload: an SVG buffer has no binary image signature,
    // so Cloudinary would file it under /raw/ and serve it as octet-stream,
    // which browsers refuse to render in an <img> tag.
    const svg = makeImage(item.name, path);
    const url = await uploadToCloudinary(svg, `products/${seller._id}`, {
      resource_type: 'image',
      format: 'png',
    });

    await Product.create({
      type: item.ch,
      sellerId: seller._id,
      name: item.name,
      description: item.desc,
      images: [url],
      category: cat._id,
      subCategory: cat.parent || undefined,
      price: item.price,
      mrp: item.mrp,
      discountPercent: Math.round(((item.mrp - item.price) / item.mrp) * 100),
      stock: item.stock,
      unit: item.unit,
      weight: item.weight,
      status: APPROVAL.APPROVED,   // listings go live directly
      isActive: true,
      isDeleted: false,
    });

    console.log(`  + ${item.name.padEnd(34)} ₹${String(item.price).padEnd(5)} ${path}`);
    created += 1;
  }

  console.log(`\n  ${DRY ? 'Would create' : 'Created'}: ${created}   skipped: ${skipped}   missing category: ${missing}`);
  if (!DRY) {
    const shop = await Product.countDocuments({ sellerId: seller._id, type: CHANNEL.ECOM, isDeleted: false });
    const quick = await Product.countDocuments({ sellerId: seller._id, type: CHANNEL.GROCERY, isDeleted: false });
    console.log(`  Store now has — Shop All: ${shop} · Quick: ${quick}\n`);
  } else {
    console.log('  Nothing written. Re-run without --dry-run to apply.\n');
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\n✖ Failed:', err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
