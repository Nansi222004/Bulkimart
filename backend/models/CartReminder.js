import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * A "your cart is waiting" reminder sent to a customer, by an admin or automatically.
 * Whether it worked ("recovered") is worked out from the customer's orders placed
 * within 7 days of `sentAt` (services/cartRecovery.service.js), never stored here,
 * so a checkout that rolls back can never be counted.
 */
const cartReminderSchema = new Schema(
  {
    userId:    { type: ObjectId, ref: "User", required: true },
    title:     { type: String, required: true },
    message:   { type: String, required: true },
    source:    { type: String, enum: ["admin", "auto"], required: true },
    sentBy:    { type: ObjectId, ref: "Admin" },
    itemCount: Number,
    cartValue: Number,
    // The cart's last change when the reminder went out: auto reminders send once per abandonment.
    cartUpdatedAt: Date,
    sentAt:    { type: Date, default: Date.now },
  },
  { versionKey: false }
);

cartReminderSchema.index({ userId: 1, sentAt: -1 });
cartReminderSchema.index({ sentAt: -1 });

const CartReminder = model("CartReminder", cartReminderSchema);
export default CartReminder;
