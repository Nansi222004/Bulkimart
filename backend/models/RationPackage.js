import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const rationPackageSchema = new Schema(
  {
    name:        { type: String, required: true },
    description: String,
    image:       String,
    items: [{
      productId: { type: ObjectId, ref: "Product" },
      qty:       Number,
      unit:      String,
    }],
    price:    { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const RationPackage = model("RationPackage", rationPackageSchema);
export default RationPackage;
