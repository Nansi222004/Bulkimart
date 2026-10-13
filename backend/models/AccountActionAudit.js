import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const accountActionAuditSchema = new Schema({
  actorAdminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
  source: { type: String, enum: ['admin', 'cleanup'], required: true },
  category: { type: String, enum: ['customer', 'seller', 'delivery'], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ['delete', 'deactivate', 'skip', 'fail'], required: true },
  outcome: { type: String, enum: ['deleted', 'deactivated', 'skipped', 'failed'], required: true },
  reasonCodes: { type: [String], default: [] },
  dependencyCounts: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: 'account_action_audits' });

accountActionAuditSchema.index({ category: 1, targetId: 1, createdAt: -1 });
accountActionAuditSchema.index({ actorAdminId: 1, createdAt: -1 });

export default model('AccountActionAudit', accountActionAuditSchema);
