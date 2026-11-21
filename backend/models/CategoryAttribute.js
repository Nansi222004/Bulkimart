import mongoose from "mongoose";

/**
 * Which attributes a category (or subcategory) asks for, and how. A subcategory inherits its parent's
 * mappings; a mapping on the subcategory for the same attribute overrides the parent's (for example
 * "Size" optional on Clothing but required on Clothing → Men → T-Shirts). `isActive: false` on a child
 * mapping hides an inherited field for that subcategory.
 */
const { Schema, model } = mongoose;

const categoryAttributeSchema = new Schema({
  category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  attribute: { type: Schema.Types.ObjectId, ref: "CatalogAttribute", required: true },
  required: { type: Boolean, default: false },
  // Variant-defining (Size, Colour, Storage): the seller sets it per variant; each combination is its own SKU.
  isVariant: { type: Boolean, default: false },
  // Offered as a customer filter on this category's listing and search pages.
  isFilter: { type: Boolean, default: false },
  // Shown in the product page's specification table.
  showOnDetail: { type: Boolean, default: true },
  group: { type: String, trim: true, maxlength: 60, default: "Product details" },
  sortOrder: { type: Number, default: 0 },
  // Optional: only these option values are offered for this category (e.g. kids' sizes only).
  allowedOptions: { type: [String], default: undefined },
  defaultValue: { type: Schema.Types.Mixed },
  isActive: { type: Boolean, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
}, { timestamps: true });

categoryAttributeSchema.index({ category: 1, attribute: 1 }, { unique: true });
categoryAttributeSchema.index({ attribute: 1 });

export default model("CategoryAttribute", categoryAttributeSchema);
