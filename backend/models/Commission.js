import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const commissionSchema = new Schema(
  {
    vendorType:    { type: String, enum: ["general", "shg"], required: true },
    categoryId:    { type: ObjectId, ref: "Category", default: null }, // null = applies to all categories
    percentage:    { type: Number, required: function () { return this.financeVersion !== 2; } },
    flatFee:       { type: Number, default: 0 },
    effectiveDate: Date,
    isActive:      { type: Boolean, default: true },
    // Version 2 rules are inserted, never edited. Legacy rules are not activated.
    financeVersion: { type: Number },
    productId: { type: ObjectId, ref: 'Product', default: null },
    channel: { type: String, enum: ['ecommerce', 'quick', 'wholesale'] },
    method: { type: String, enum: ['fixed', 'percentage'] },
    value: Number,
    minimum: Number,
    maximum: Number,
    base: { type: String, enum: ['eligible_item_subtotal'] },
    fixedScope: { type: String, enum: ['order_item'] },
    taxTreatment: { type: String, enum: ['exclusive', 'inclusive', 'exempt'] },
    taxRate: Number,
    version: String,
    supersedes: { type: ObjectId, ref: 'Commission' },
    createdBy: { type: ObjectId, ref: 'Admin' },
    reason: String,
  },
  { timestamps: true }
);

// No automatic index creation on deployment of new financial configuration.
commissionSchema.set('autoIndex', false);
commissionSchema.pre('save', function () {
  if (!this.isNew && this.financeVersion === 2) throw new Error('Commission versions are append-only');
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  commissionSchema.pre(operation, function () { throw new Error('Commission rules are append-only; insert a new version'); });
}
commissionSchema.pre('bulkWrite', function () { throw new Error('Commission rules are append-only'); });

const Commission = model("Commission", commissionSchema);
export default Commission;
