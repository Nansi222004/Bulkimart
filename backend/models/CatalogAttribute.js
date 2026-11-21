import mongoose from "mongoose";

/**
 * A reusable product field (Brand, Size, RAM, Purity, Expiry date, …) that Admin defines once and maps
 * to any number of categories (CategoryAttribute). Seller forms, product validation, product detail
 * pages and customer filters are all generated from these records, so a new category or field needs
 * no code change.
 *
 * Attributes already used by products are archived, never deleted (isActive=false), so old listings keep
 * their labels and values.
 */
export const ATTRIBUTE_FIELD_TYPES = ["text", "longtext", "number", "decimal", "select", "multiselect", "date", "boolean", "image", "file"];
// Types whose value is one of the configured options.
export const OPTION_FIELD_TYPES = ["select", "multiselect"];

const { Schema, model } = mongoose;

const optionSchema = new Schema({
  value: { type: String, required: true, trim: true, maxlength: 120 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { _id: false });

const catalogAttributeSchema = new Schema({
  // Stable machine name used in product data and filter URLs (e.g. "ram", "sleeve_type"). Never changes.
  code: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z][a-z0-9_]{1,49}$/, immutable: true },
  label: { type: String, required: true, trim: true, maxlength: 80 },
  fieldType: { type: String, enum: ATTRIBUTE_FIELD_TYPES, required: true },
  helpText: { type: String, trim: true, maxlength: 300 },
  placeholder: { type: String, trim: true, maxlength: 120 },
  unit: { type: String, trim: true, maxlength: 20 }, // shown after the value: "GB", "g", "ml", "carat"
  options: { type: [optionSchema], default: [] },
  validation: {
    type: new Schema({
      min: Number,
      max: Number,
      maxLength: { type: Number, min: 1, max: 5000 },
      pattern: { type: String, maxlength: 200 },
      patternMessage: { type: String, maxlength: 200 },
    }, { _id: false }),
    default: undefined,
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
}, { timestamps: true });

catalogAttributeSchema.index({ isActive: 1, label: 1 });

export default model("CatalogAttribute", catalogAttributeSchema);
