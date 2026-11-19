import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * What a customer did in their cart, for the admin "Abandoned carts" history.
 * Written after each successful cart change (services/cartRecovery.service.js),
 * never on the money path. Kept for 180 days.
 */
const cartActivitySchema = new Schema(
  {
    userId:    { type: ObjectId, ref: "User", required: true },
    channel:   { type: String },
    // add: put in the cart (qty = how many added) · qty: quantity changed (fromQty → qty)
    // remove: line taken out · clear: whole cart emptied (qty = lines removed)
    action:    { type: String, enum: ["add", "qty", "remove", "clear"], required: true },
    productId: { type: ObjectId, ref: "Product" },
    variantId: { type: ObjectId },
    name:      String,
    image:     String,
    price:     Number,
    qty:       Number,
    fromQty:   Number,
    at:        { type: Date, default: Date.now },
  },
  { versionKey: false }
);

cartActivitySchema.index({ userId: 1, at: -1 });
cartActivitySchema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

const CartActivity = model("CartActivity", cartActivitySchema);
export default CartActivity;
