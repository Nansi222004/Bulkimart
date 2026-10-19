import mongoose from "mongoose";
import { CHANNELS, SAME_DAY_MAX_PROCESSING_MINUTES } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Whether this listing may be fulfilled Same-Day, and how long packing takes.
 *
 * Deliberately NOT a price. Same-Day is a way of delivering this product, not a
 * second version of it — `price` stays the one seller-controlled figure, and a
 * ₹150 item is displayed and charged at ₹150 whichever way it travels. The extra
 * amounts a Same-Day customer pays live on the order, not here.
 *
 * A referenced schema rather than an inline object, and that matters: Mongoose
 * only creates a nested schema once something is assigned to it, so the 14
 * products already in the database keep no `sameDay` field at all. Absent reads
 * as disabled, which is the required default — see geoPoint.schema.js for the
 * time this distinction was learned the hard way.
 */
const productSameDaySchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    /** Shop-floor time from accepting the order to handing it to a rider. */
    processingMinutes: { type: Number, min: 0, max: SAME_DAY_MAX_PROCESSING_MINUTES },
  },
  { _id: false }
);

/**
 * An EXTRA storefront this product also appears on, beyond its primary `type`.
 *
 * sellingChannels, when present, restricts storefront visibility independently
 * of this category taxonomy (a Wholesale-only product has no retail permission).
 * A product's primary `type`/`category` never move — that stays the channel it
 * was created in (an SHG product stays `shg`, a seller's stays whichever they
 * picked). This array is how it additionally shows up in Quick (`grocery`)
 * and/or Shop All (`ecommerce`) sections, each with its own category, since
 * categories are channel-scoped and a grocery leaf means nothing to the
 * ecommerce tree.
 *
 * `_id: false` — these are matched and rewritten wholesale from the toggle UI,
 * never addressed by their own id.
 */
const productChannelSchema = new Schema(
  {
    type: { type: String, enum: CHANNELS, required: true },
    category: { type: ObjectId, ref: "Category", required: true },
    subCategory: { type: ObjectId, ref: "Category" },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const ebookFileSchema = new Schema({
  fileId: { type: String, required: true, select: false },
  productId: { type: ObjectId, ref: "Product", required: true },
  ownerSellerId: { type: ObjectId, ref: "Seller", required: true },
  sizeBytes: { type: Number, min: 1, required: true },
  format: { type: String, enum: ["pdf"], required: true },
  sha256: { type: String, required: true },
  status: { type: String, enum: ["uploaded"], required: true },
  uploadedAt: { type: Date, required: true },
}, { _id: false });

const digitalProductSchema = new Schema({
  author: { type: String, trim: true, maxlength: 160 },
  language: { type: String, trim: true, maxlength: 80 },
  format: { type: String, enum: ["pdf"], default: "pdf" },
  licenseTerms: { type: String, trim: true, maxlength: 2000 },
  file: { type: ebookFileSchema, default: undefined },
}, { _id: false });

/**
 * One sellable variation of a product — same listing, different pack/price.
 *
 * Pricing, stock, unit and weight all live here now, not on the product
 * root — a "500g" and a "1kg" of the same item can be priced and stocked
 * independently. `sku` is per-variant too, auto-assigned from the product's
 * own SKU when not given (see the pre-validate hook below), but is no
 * longer required: it's an internal code the frontend doesn't even show
 * any more, not something a seller is blocked on typing.
 */
const productVariantSchema = new Schema({
  name: { type: String, required: true, default: "Default" },
  price: { type: Number, required: true },
  mrp: { type: Number, required: true },
  stock: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, default: "piece" },
  weight: { type: Number }, // in grams
  sku: { type: String },
  attributes: [{ name: { type: String, trim: true }, value: { type: String, trim: true } }],
  // Separate wholesale price book per variant. Hidden from ordinary product
  // queries until the wholesale storefront has its own buyer access rules.
  // Wholesale uses the same per-variant stock source as retail.
  wholesalePricing: {
    type: new Schema({
      enabled: { type: Boolean, required: true },
      minimumQuantity: { type: Number, min: 1 },
      quantityIncrement: { type: Number, min: 1, default: 1 },
      priceTiers: [{
        _id: false,
        minimumQuantity: { type: Number, min: 1, required: true },
        unitPrice: { type: Number, min: 0.01, required: true },
      }],
    }, { _id: false }),
    default: undefined,
    select: false,
  },
});

/**
 * One shopper's review of this product.
 *
 * Moderated: a review is invisible to the public and counts for nothing until
 * an admin approves it. `ratings.average`/`ratings.count` are therefore a
 * rollup of APPROVED reviews only — see services/productRatings.service.js,
 * which is the single place that recomputes them.
 *
 * `userName` is a snapshot taken at submission, the same discipline order
 * items already use for product names: the review is a record of what was
 * said and by whom at that moment, and it should not silently re-attribute
 * itself if the account is later renamed or removed.
 */
const reviewSchema = new Schema({
  userId: { type: ObjectId, ref: "User" },
  userName: String,
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  images: [String],
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  rejectionReason: String,
  createdAt: { type: Date, default: Date.now },
});

/**
 * A shopper's question about a listing, and the seller's official answer.
 *
 * `userName` is a snapshot, same discipline as `reviewSchema.userName` — the
 * question is a record of what was asked and by whom at that moment.
 * `answeredBy` is likewise a snapshot of the store name, not a live seller
 * reference, so it reads correctly even if the store is later renamed.
 */
const faqSchema = new Schema({
  userId: { type: ObjectId, ref: "User" },
  userName: { type: String, default: "Shopper" },
  question: { type: String, required: true },
  answer: { type: String, default: "" },
  answeredBy: { type: String, default: "" },
  status: { type: String, enum: ["unanswered", "answered"], default: "unanswered" },
  createdAt: { type: Date, default: Date.now },
  answeredAt: { type: Date },
});

const productSchema = new Schema(
  {
    type: { type: String, enum: ["ecommerce", "grocery", "shg"], required: true },
    // Optional restriction; absent legacy products keep type/channels visibility.
    // type remains the category/fulfilment taxonomy, not retail permission.
    sellingChannels: { type: [{ type: String, enum: ['ecommerce', 'grocery', 'wholesale'] }], default: undefined },
    // Fulfillment is additive; absent legacy records continue to mean physical.
    fulfillmentType: { type: String, enum: ["physical", "digital"], default: "physical" },
    digital: { type: digitalProductSchema, default: undefined },
    sellerId: { type: ObjectId, ref: "Seller" },
    shgStoreId: { type: ObjectId, ref: "SHGStore" },

    name: { type: String, required: true },
    slug: String,
    description: String,
    images: [String], // Cloudinary URLs (max 5)
    category: { type: ObjectId, ref: "Category", required: true },
    subCategory: { type: ObjectId, ref: "Category" },

    // Global product code — auto-assigned (see the pre-validate hook below)
    // when a seller doesn't type one.
    sku: { type: String },
    brandName: { type: String },
    // 0 is a legal rate (unrated / exempt goods), so this is never left
    // undefined the way an optional field would be.
    gstRate: { type: Number, default: 0 },
    // Absent = a single-SKU listing, same shape as every product created
    // before variants existed.
    variants: { type: [productVariantSchema], default: undefined },

    price: { type: Number, required: true },
    mrp: Number,
    discountPercent: { type: Number, default: 0 },
    stock: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ["kg", "g", "litre", "ml", "piece", "dozen", "pack"], default: "piece" },
    weight: Number,   // in grams — for Shiprocket, and for Same-Day
    dimensions: { length: Number, breadth: Number, height: Number },
    tags: [String],

    // Same-Day fulfilment capability. Absent = not offered.
    sameDay: { type: productSameDaySchema, default: undefined },

    /**
     * QUICK COMMERCE ONLY — whether this seller accepts returns on this
     * product. Ignored for `type: "ecommerce"`/`"shg"` listings; those are
     * governed purely by Admin's CategoryReturnPolicy, exactly as before
     * this field existed.
     *
     * This is an opt-OUT switch, never a window: the seller can turn
     * returns off for this product, but can never set or widen how many
     * days the window is — that number always comes from
     * services/returnPolicy.service.js's resolution of the product's
     * header category, both here (for display) and frozen onto the order
     * item at purchase time (services/fulfilmentOrders.service.js).
     */
    returnable: { type: Boolean, default: false },

    // Cross-listing into other storefronts. Absent = only the primary `type`
    // channel, same shape as every product created before this existed.
    channels: { type: [productChannelSchema], default: undefined },

    // Set by an SHG group on every listing they create — "made by our own
    // members", shown as a badge on the storefront card. Never true for a
    // regular Seller listing.
    isHandmade: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true }, // goes live immediately upon creation (no admin pre-verification)
    isDeleted: { type: Boolean, default: false }, // soft delete — kept separate from isActive
    isFeatured: { type: Boolean, default: false },
    isSponsored: { type: Boolean, default: false },
    sponsoredRank: { type: Number, default: 0 },
    isClientBrand: { type: Boolean, default: false },

    /**
     * A denormalized copy of `Seller.storeDetails.name`, kept in sync by
     * `createProduct` (set once, at creation) and `updateStoreProfile`
     * (re-synced across every one of that seller's products whenever they
     * rename their shop). MongoDB's `$text` index can only search within
     * one collection — this is what lets a single product-collection text
     * search also match on shop name, without a cross-collection join.
     * Absent for SHG-owned products (no `sellerId`).
     */
    sellerName: { type: String },

    /** Historical paid-ranking fields retained for record compatibility; ignored by search. */
    searchBoostRank: { type: Number },
    searchBoostUntil: { type: Date },

    // Admin Approval (Default approved — direct storefront listing)
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
    rejectionReason: String,

    // Ratings + Reviews
    ratings: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
      reviews: [reviewSchema],
    },

    // Buyer questions + seller answers. Absent/empty is the common case —
    // most listings never get asked anything.
    faqs: [faqSchema],
  },
  { timestamps: true, optimisticConcurrency: true }
);

productSchema.index({ type: 1, category: 1 });
productSchema.index({ "channels.type": 1, "channels.category": 1 });
productSchema.index({ sellerId: 1, createdAt: -1 });
productSchema.index({ shgStoreId: 1, createdAt: -1 });
productSchema.index({ status: 1 });
// A collection can carry only ONE text index — this REPLACES the previous
// { name, description, tags } text index (which must be dropped once in the
// database; see config/db.js's one-time index-migration step) rather than
// existing alongside it. Adding `sellerName` here is what makes a shop-name
// search ("Fresh Fruits Store") match from the same query as a product-name
// search, without a second query or a cross-collection join.
productSchema.index(
  { name: "text", description: "text", tags: "text", sellerName: "text" },
  { name: "product_search_text_v2" }
);
productSchema.index({ searchBoostRank: 1 });

// Auto-generate slug, product SKU and variant SKUs; sync root price/mrp/
// unit/weight from the first variant and root stock from the sum of variant
// stock as a compatibility projection (never a second inventory pool), so every existing query that
// reads pricing straight off the product document (search, cart, checkout)
// keeps working unchanged even though a seller now enters pricing per
// variant, not on the product itself.
//
// NOTE: Mongoose 9 removed the `next` callback from middleware — hooks must be
// async/promise-based. A `function (next) { ... next(); }` hook throws
// "next is not a function" and every save() fails.
//
// `pre("validate")`, not `pre("save")`: the root `price`/`mrp`/`stock` fields
// are `required` on productSchema, and validation runs BEFORE `pre("save")`
// hooks — a hook registered there would copy the primary variant's values
// into them one step too late, after Mongoose had already rejected the
// document for missing required fields. Validating after this hook is what
// lets a seller fill in pricing on the variant alone and still save.
productSchema.pre("validate", async function () {
  if (this.fulfillmentType === "digital") {
    if (this.type !== "ecommerce") this.invalidate("type", "Digital products must use the E-Commerce catalogue");
    if (!this.digital?.author?.trim()) this.invalidate("digital.author", "Author is required for an e-book");
    if (!this.digital?.language?.trim()) this.invalidate("digital.language", "Language is required for an e-book");
    if (this.digital?.format !== "pdf") this.invalidate("digital.format", "Only PDF e-books are currently supported");
    if (Number(this.stock || 0) !== 0 || (this.variants || []).some((variant) => Number(variant.stock) !== 0)) {
      this.invalidate("stock", "E-books do not use physical inventory");
    }
    if (this.status === "approved" || this.isActive) {
      const file = this.digital?.file;
      if (file?.status !== "uploaded" || !file.fileId || !file.sizeBytes || !file.sha256
        || String(file.productId) !== String(this._id) || String(file.ownerSellerId) !== String(this.sellerId)) {
        this.invalidate("digital.file", "An e-book must have its associated private PDF before it can be active");
      }
    }
  } else if (this.digital) {
    this.invalidate("digital", "Digital metadata is only valid for digital products");
  }
  if (this.isModified("name") && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  // Auto-generate the product's own SKU if missing.
  if (!this.sku) {
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.sku = `QM-${randomStr}`;
  }

  // Nothing passed a variants array at all (e.g. the seed script, or any
  // other caller still writing root price/stock directly) — fall back to a
  // single default variant built from those root fields, so a document
  // saved the old way still ends up with the exact same shape as one saved
  // through the new per-variant form.
  if (!this.variants || this.variants.length === 0) {
    this.variants = [{
      name: "Default",
      price: this.price || 0,
      mrp: this.mrp || this.price || 0,
      stock: this.stock || 0,
      unit: this.unit || "piece",
      weight: this.weight,
    }];
  }

  // Every variant needs an SKU — pattern it off the product's own SKU rather
  // than leaving it blank — and its selling price can never exceed its MRP.
  this.variants.forEach((v, index) => {
    if (!v.sku) {
      v.sku = `${this.sku}-V${index + 1}`;
    }
    if (v.mrp != null && Number(v.price) > Number(v.mrp)) {
      this.invalidate(`variants.${index}.price`, `Variant "${v.name}" price cannot be higher than its MRP`);
    }
  });
  const variantIds = this.variants.map((variant) => String(variant._id));
  if (new Set(variantIds).size !== variantIds.length) {
    this.invalidate('variants', 'Variant identifiers must be unique within a product');
  }

  // The primary (first) variant is what every non-variant-aware query still
  // reads for price. Root stock is the aggregate compatibility projection.
  const primary = this.variants[0];
  this.price = primary.price;
  this.mrp = primary.mrp;
  this.stock = this.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0);
  this.unit = primary.unit;
  this.weight = primary.weight;
});

productSchema.pre('save', function () { this.$locals.imageSearchDirty = this.isNew || this.isModified('images') || this.isModified('isDeleted'); });
productSchema.post('save', async function (doc) {
  if (process.env.IMAGE_SEARCH_ENABLED !== 'true' || !this.$locals.imageSearchDirty) return;
  try { const { enqueueImageSearchIndex } = await import('../services/imageSearchIndexer.service.js'); await enqueueImageSearchIndex(doc._id); }
  catch { console.warn('[IMAGE SEARCH] Index enqueue failed; run catalogue reconciliation.'); }
});
for (const operation of ['updateOne', 'findOneAndUpdate']) {
  productSchema.post(operation, async function (result) {
    if (process.env.IMAGE_SEARCH_ENABLED !== 'true') return;
    const update = this.getUpdate() || {}, fields = { ...update, ...update.$set, ...update.$unset };
    if (!Object.hasOwn(fields, 'images') && !Object.hasOwn(fields, 'isDeleted')) return;
    const productId = result?._id || this.getFilter()._id;
    if (!mongoose.isObjectIdOrHexString(productId)) return;
    try { const { enqueueImageSearchIndex } = await import('../services/imageSearchIndexer.service.js'); await enqueueImageSearchIndex(productId); }
    catch { console.warn('[IMAGE SEARCH] Index enqueue failed; run catalogue reconciliation.'); }
  });
}
const Product = model("Product", productSchema);
export default Product;
