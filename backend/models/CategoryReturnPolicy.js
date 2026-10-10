import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-configured return window for one HEADER Category (a Category with
 * `parent: null` — see services/returnPolicy.service.js::resolveHeaderCategory
 * for how a product's actual header is found, since the tree can run deeper
 * than one level and a product's own `category`/`subCategory` are never the
 * header themselves).
 *
 * One document per header category (`categoryId` unique), mutated in place —
 * unlike DeliveryChargeSetting/CoinConfig this is NOT an append-only history
 * table, because nothing here needs to reconstruct "what the policy looked
 * like on any given day": that job belongs entirely to the SNAPSHOT frozen
 * onto each order item at purchase time (Phase 3), which this document must
 * never retroactively affect.
 *
 * `returnWindowDays: 0` means the category is explicitly non-returnable —
 * a deliberate value, not an unconfigured one. A header with NO document
 * here at all is a separate case (unconfigured) and is also non-returnable
 * by policy (see resolveReturnPolicyForCategory) — "missing" and "zero"
 * reach the same outcome but are not the same thing, which is why this is
 * not modelled as returnWindowDays defaulting to 0.
 */
const categoryReturnPolicySchema = new Schema(
  {
    categoryId: { type: ObjectId, ref: 'Category', required: true, unique: true },

    returnWindowDays: { type: Number, required: true, min: 0 },

    isActive: { type: Boolean, default: true },

    createdBy: { type: ObjectId, ref: 'Admin' },
    updatedBy: { type: ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

const CategoryReturnPolicy = model('CategoryReturnPolicy', categoryReturnPolicySchema);
export default CategoryReturnPolicy;
