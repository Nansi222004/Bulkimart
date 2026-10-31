import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Append-only record of every delivery of a sensitive (private-kyc) document.
 * Indexes are created explicitly (`migrate.mjs indexes --apply`), never on startup.
 */
const mediaAccessAuditSchema = new Schema(
  {
    mediaId:    { type: Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    category:   { type: String, required: true },
    viewerId:   { type: Schema.Types.ObjectId, required: true, index: true },
    viewerType: { type: String, enum: ['admin', 'user'], required: true },
    action:     { type: String, enum: ['view'], default: 'view' },
    requestId:  String,
    ip:         String,
    userAgent:  { type: String, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false }
);

export default model('MediaAccessAudit', mediaAccessAuditSchema);
