import mongoose from "mongoose";
import { CHANNELS } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const categorySchema = new Schema(
  {
    name:        { type: String, required: true },
    slug:        { type: String, unique: true, lowercase: true },
    image:       String,
    icon:        String,
    type:        { type: String, enum: CHANNELS, required: true },
    parent:      { type: ObjectId, ref: "Category", default: null },
    isActive:    { type: Boolean, default: true },
    sortOrder:   { type: Number, default: 0 },
    description: String,

    /**
     * How a HEADER category paints itself in the customer's app.
     *
     * The admin form has always collected these three, but never sent them, so
     * every shop's header fell back to the same hardcoded palette no matter what
     * was chosen. They live on the category rather than in the app's CSS because
     * the person choosing the colour is the person running the shop.
     *
     * No defaults on purpose. An absent value means "this category never chose
     * one", which the header answers with the styling it has always used — so
     * the 537 categories that predate this render exactly as they did before.
     * A default here would repaint all of them.
     *
     * Only meaningful on a header (parent: null); a subcategory carries no
     * chrome of its own.
     */
    backgroundColor: String,
    textColor:       String,
    activeTabColor:  String,

    /**
     * Does this category get its own tab in the customer's header?
     *
     * The alternative was reparenting the whole catalogue so that the nav could
     * read the top level directly — which would have pushed 143 grocery
     * subcategories to depth four, where the tree builder truncates, taking
     * every grocery product's category with them. A flag moves no documents.
     *
     * Only meaningful on a header (parent: null). Absent reads as false, so the
     * 537 categories that predate this stay out of the header until somebody
     * deliberately puts one there.
     */
    showInNav: { type: Boolean, default: false },
    isPopular:       { type: Boolean, default: false },
    showOnHome:      { type: Boolean, default: false },
    isSystem:        { type: Boolean, default: false },
  },
  { timestamps: true }
);

categorySchema.index({ type: 1, parent: 1 });

// Auto-generate slug from name before save.
// Mongoose 9 middleware is promise-based — see the note in models/Product.js.
categorySchema.pre("save", async function () {
  if (this.isModified("name") && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
});

const Category = model("Category", categorySchema);
export default Category;
