import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const commissionSchema = new Schema(
  {
    vendorType:    { type: String, enum: ["general", "shg"], required: true },
    categoryId:    { type: ObjectId, ref: "Category", default: null }, // null = applies to all categories
    percentage:    { type: Number, required: true },
    flatFee:       { type: Number, default: 0 },
    effectiveDate: Date,
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Commission = model("Commission", commissionSchema);
export default Commission;
