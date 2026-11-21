import mongoose from "mongoose";

/** Who changed category / attribute configuration, what, and when (PDF §10: audit configuration changes). */
const { Schema, model } = mongoose;

const catalogConfigAuditSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  actorName: String,
  action: { type: String, required: true }, // attribute.create, attribute.update, attribute.archive, mapping.replace, category.create, …
  entityType: { type: String, enum: ["attribute", "category", "mapping"], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  summary: { type: String, maxlength: 500 },
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });

catalogConfigAuditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
catalogConfigAuditSchema.index({ createdAt: -1 });

export default model("CatalogConfigAudit", catalogConfigAuditSchema);
