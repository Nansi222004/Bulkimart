/**
 * Starter attribute library for the 7 launch categories (client brief + Developer Guide §3), mapped to the
 * matching top-level categories by name; subcategories inherit and Admin refines everything afterwards in
 * Admin → Catalog. Safe to re-run: attributes are matched by code, mappings only added when missing.
 *
 *   node seed/seedCatalogAttributes.js           # dry run: prints what would be created and mapped
 *   node seed/seedCatalogAttributes.js --apply   # writes
 *
 * Legal fields (FSSAI, hallmark, expiry …) are a starting point and must be reviewed before launch.
 */
import 'dotenv/config';
import { setServers } from 'dns';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import CatalogAttribute from '../models/CatalogAttribute.js';
import CategoryAttribute from '../models/CategoryAttribute.js';

if (process.env.NODE_ENV === 'development') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
const APPLY = process.argv.includes('--apply');

const opts = (...labels) => labels.map((label, i) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label, sortOrder: i }));

// code → definition
const A = {
  brand: { label: 'Brand', fieldType: 'select', options: opts('Generic / Unbranded'), helpText: 'Brand not in the list? Choose Generic / Unbranded and ask Bulkimart support to add your brand.' },
  size: { label: 'Size', fieldType: 'select', options: opts('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free Size') },
  colour: { label: 'Colour', fieldType: 'select', options: opts('Black', 'White', 'Grey', 'Blue', 'Navy', 'Red', 'Maroon', 'Pink', 'Green', 'Yellow', 'Orange', 'Purple', 'Brown', 'Beige', 'Gold', 'Silver', 'Multicolour') },
  fabric: { label: 'Fabric', fieldType: 'select', options: opts('Cotton', 'Polyester', 'Cotton Blend', 'Linen', 'Silk', 'Rayon', 'Wool', 'Denim', 'Georgette', 'Chiffon', 'Khadi', 'Other') },
  pattern: { label: 'Pattern', fieldType: 'select', options: opts('Solid', 'Printed', 'Striped', 'Checked', 'Embroidered', 'Self Design', 'Graphic Print') },
  sleeve_type: { label: 'Sleeve type', fieldType: 'select', options: opts('Half Sleeve', 'Full Sleeve', 'Sleeveless', '3/4 Sleeve') },
  fit_type: { label: 'Fit', fieldType: 'select', options: opts('Regular', 'Slim', 'Relaxed', 'Oversized') },
  neck_type: { label: 'Neck type', fieldType: 'select', options: opts('Round Neck', 'V-Neck', 'Collar', 'Mandarin', 'Hooded') },
  ideal_for: { label: 'Ideal for', fieldType: 'select', options: opts('Men', 'Women', 'Unisex', 'Boys', 'Girls', 'Babies') },
  size_chart: { label: 'Size chart', fieldType: 'image', helpText: 'Upload the size chart image.' },
  wash_care: { label: 'Wash care', fieldType: 'longtext' },
  model_number: { label: 'Model number', fieldType: 'text' },
  ram: { label: 'RAM', fieldType: 'select', unit: 'GB', options: opts('2', '3', '4', '6', '8', '12', '16', '32') },
  storage: { label: 'Storage', fieldType: 'select', options: opts('32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB', '2 TB') },
  processor: { label: 'Processor', fieldType: 'text' },
  operating_system: { label: 'Operating system', fieldType: 'select', options: opts('Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Other') },
  connectivity: { label: 'Connectivity', fieldType: 'multiselect', options: opts('4G', '5G', 'Wi-Fi', 'Bluetooth', 'NFC', 'USB-C') },
  warranty_months: { label: 'Warranty', fieldType: 'number', unit: 'months', validation: { min: 0, max: 120 } },
  net_weight: { label: 'Net weight', fieldType: 'decimal', unit: 'g', validation: { min: 0 } },
  net_quantity: { label: 'Net quantity', fieldType: 'text', placeholder: 'e.g. 100 ml, 50 g' },
  ingredients: { label: 'Ingredients', fieldType: 'longtext' },
  nutrition_info: { label: 'Nutrition information', fieldType: 'longtext' },
  manufacturing_date: { label: 'Manufacturing date', fieldType: 'date' },
  expiry_date: { label: 'Expiry / best before', fieldType: 'date' },
  shelf_life_days: { label: 'Shelf life', fieldType: 'number', unit: 'days', validation: { min: 1 } },
  storage_instructions: { label: 'Storage instructions', fieldType: 'longtext' },
  veg_nonveg: { label: 'Veg / Non-veg', fieldType: 'select', options: opts('Veg', 'Non-Veg', 'Egg') },
  allergens: { label: 'Allergens', fieldType: 'multiselect', options: opts('Milk', 'Nuts', 'Peanuts', 'Gluten', 'Soy', 'Egg', 'Fish', 'Shellfish', 'None') },
  fssai_license: { label: 'FSSAI licence number', fieldType: 'text', validation: { pattern: '^\\d{14}$', patternMessage: 'FSSAI licence number must be 14 digits' } },
  material: { label: 'Material', fieldType: 'select', options: opts('Gold', 'Silver', 'Platinum', 'Rose Gold', 'Brass', 'Alloy', 'Other') },
  purity: { label: 'Purity', fieldType: 'select', options: opts('24K', '22K', '18K', '14K', '925 Sterling', 'Not applicable') },
  gross_weight: { label: 'Gross weight', fieldType: 'decimal', unit: 'g', validation: { min: 0 } },
  metal_weight: { label: 'Net metal weight', fieldType: 'decimal', unit: 'g', validation: { min: 0 } },
  stone_type: { label: 'Stone type', fieldType: 'select', options: opts('None', 'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Pearl', 'Cubic Zirconia', 'Other') },
  stone_details: { label: 'Stone details', fieldType: 'longtext' },
  hallmark: { label: 'BIS hallmark', fieldType: 'boolean', helpText: 'Gold jewellery sold in India generally needs BIS hallmarking.' },
  hallmark_certificate: { label: 'Hallmark / certificate', fieldType: 'file' },
  ring_size: { label: 'Ring size', fieldType: 'select', options: opts('6', '8', '10', '12', '14', '16', '18', '20', '22', '24') },
  skin_type: { label: 'Skin type', fieldType: 'multiselect', options: opts('All', 'Normal', 'Dry', 'Oily', 'Combination', 'Sensitive') },
  shade: { label: 'Shade', fieldType: 'text' },
  usage_instructions: { label: 'How to use', fieldType: 'longtext' },
  warnings: { label: 'Warnings', fieldType: 'longtext' },
  publisher: { label: 'Publisher', fieldType: 'text' },
  page_count: { label: 'Pages', fieldType: 'number', validation: { min: 1 } },
  isbn: { label: 'ISBN', fieldType: 'text', validation: { pattern: '^(97[89])?\\d{9}[\\dX]$', patternMessage: 'ISBN must be 10 or 13 characters' } },
  edition: { label: 'Edition', fieldType: 'text' },
};

// [code, { required, isVariant, isFilter, group }]
const m = (code, flags = {}) => [code, flags];
const SETS = [
  { name: 'Clothing & Fashion', match: /cloth|fashion|wear|apparel|handloom/i, fields: [
    m('brand', { required: true, isFilter: true }), m('size', { required: true, isVariant: true, isFilter: true, group: 'Variant' }), m('colour', { required: true, isVariant: true, isFilter: true, group: 'Variant' }),
    m('ideal_for', { required: true, isFilter: true }), m('fabric', { required: true, isFilter: true }), m('pattern', { isFilter: true }),
    m('sleeve_type', { isFilter: true }), m('fit_type', { isFilter: true }), m('neck_type'), m('size_chart'), m('wash_care')] },
  { name: 'Electronics', match: /electronic|mobile|laptop|computer|appliance|gadget/i, fields: [
    m('brand', { required: true, isFilter: true }), m('model_number', { required: true }), m('ram', { isVariant: true, isFilter: true, group: 'Variant' }), m('storage', { isVariant: true, isFilter: true, group: 'Variant' }),
    m('colour', { isVariant: true, isFilter: true, group: 'Variant' }), m('processor'), m('operating_system', { isFilter: true }), m('connectivity', { isFilter: true }),
    m('warranty_months', { required: true })] },
  { name: 'Grocery & Daily Needs', match: /grocer|daily|staple|atta|dal|rice|fruit|vegetable|snack|dairy|household|spice|oil/i, fields: [
    m('brand', { required: true, isFilter: true }), m('net_weight', { required: true, isVariant: true, isFilter: true, group: 'Variant' }), m('veg_nonveg', { isFilter: true }), m('ingredients'), m('nutrition_info'),
    m('manufacturing_date'), m('expiry_date'), m('storage_instructions'), m('fssai_license')] },
  { name: 'Jewellery', match: /jewel/i, fields: [
    m('brand', { required: true, isFilter: true }), m('material', { required: true, isFilter: true }), m('purity', { required: true, isFilter: true }), m('gross_weight', { required: true }), m('metal_weight'),
    m('stone_type', { isFilter: true }), m('stone_details'), m('ring_size', { isVariant: true, group: 'Variant' }), m('hallmark'), m('hallmark_certificate')] },
  { name: 'Cosmetics & Beauty', match: /cosmetic|beauty|makeup|skin|hair|fragrance|personal care/i, fields: [
    m('brand', { required: true, isFilter: true }), m('net_quantity', { required: true }), m('skin_type', { isFilter: true }), m('shade', { isVariant: true, group: 'Variant' }), m('ingredients', { required: true }),
    m('usage_instructions'), m('manufacturing_date'), m('expiry_date', { required: true }), m('warnings')] },
  { name: 'Food & Beverages', match: /food|beverage|bakery|sweet|drink|frozen|ready to eat/i, fields: [
    m('brand', { required: true, isFilter: true }), m('veg_nonveg', { required: true, isFilter: true }), m('net_quantity', { required: true }), m('ingredients', { required: true }), m('allergens'),
    m('shelf_life_days'), m('storage_instructions'), m('fssai_license', { required: true })] },
  { name: 'E-books & Digital', match: /e-?book|book|digital/i, fields: [m('publisher'), m('page_count'), m('isbn'), m('edition')] },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/nhcone');
  console.log(`\n${APPLY ? 'APPLYING to' : 'DRY RUN on'} ${mongoose.connection.name}\n`);

  const ids = {};
  for (const [code, def] of Object.entries(A)) {
    const existing = await CatalogAttribute.findOne({ code }).select('_id').lean();
    if (existing) { ids[code] = existing._id; continue; }
    console.log(`  + attribute ${code} (${def.fieldType})`);
    if (APPLY) ids[code] = (await CatalogAttribute.create({ code, ...def }))._id;
  }

  const tops = await Category.find({ parent: null, isActive: true }).select('_id name type').lean();
  for (const set of SETS) {
    const targets = tops.filter((c) => set.match.test(c.name));
    console.log(`\n${set.name}: ${targets.length ? targets.map((c) => `${c.name} [${c.type}]`).join(', ') : '— no matching top-level category (create it, then re-run or map in Admin)'}`);
    for (const category of targets) {
      for (const [i, [code, flags]] of set.fields.entries()) {
        if (APPLY && !ids[code]) continue;
        if (ids[code] && await CategoryAttribute.exists({ category: category._id, attribute: ids[code] })) continue;
        console.log(`    map ${code}${flags.required ? ' (required)' : ''}${flags.isVariant ? ' [variant]' : ''}${flags.isFilter ? ' [filter]' : ''}`);
        if (APPLY) await CategoryAttribute.create({ category: category._id, attribute: ids[code], sortOrder: i, group: flags.group || 'Product details', required: !!flags.required, isVariant: !!flags.isVariant, isFilter: !!flags.isFilter });
      }
    }
  }
  console.log(APPLY ? '\nDone.' : '\nNothing written. Re-run with --apply to save.');
  await mongoose.disconnect();
}

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => {}); process.exit(1); });
