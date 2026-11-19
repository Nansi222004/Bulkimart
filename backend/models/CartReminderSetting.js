import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * Abandoned-cart reminder settings (Admin Panel). Same immutable versioning as
 * TipSetting: a save supersedes the active row.
 *
 * Message placeholders: {name} customer's first name, {item} one product in the
 * cart, {more} " and N more items" (or nothing), {count} number of items.
 */
export const CART_REMINDER_DEFAULTS = Object.freeze({
  autoEnabled: false,
  autoAfterHours: 24,
  minGapHours: 24,
  title: "Your cart is waiting 🛒",
  message: "Hi {name}, {item}{more} is waiting in your cart. Complete your order before it sells out!",
});

const cartReminderSettingSchema = new Schema(
  {
    // Send reminders automatically to carts left this long.
    autoEnabled:    { type: Boolean, default: CART_REMINDER_DEFAULTS.autoEnabled },
    autoAfterHours: { type: Number, default: CART_REMINDER_DEFAULTS.autoAfterHours, min: 1, max: 720 },
    // Never remind the same customer more often than this (manual or automatic).
    minGapHours:    { type: Number, default: CART_REMINDER_DEFAULTS.minGapHours, min: 1, max: 720 },
    title:          { type: String, default: CART_REMINDER_DEFAULTS.title, maxlength: 80 },
    message:        { type: String, default: CART_REMINDER_DEFAULTS.message, maxlength: 300 },

    isActive:  { type: Boolean, default: true },
    updatedBy: { type: ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

cartReminderSettingSchema.index({ isActive: 1, createdAt: -1 });

const CartReminderSetting = model("CartReminderSetting", cartReminderSettingSchema);
export default CartReminderSetting;
