import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Metadata for one stored file. Bytes live on disk under MEDIA_ROOT; this
 * record holds only the opaque storage key and descriptive metadata. The key
 * is select:false and never serialised to clients.
 *
 * Existing business records keep storing plain strings: a public media URL,
 * or the opaque reference `media:<_id>` for private media, which API responses
 * resolve to a short-lived signed URL (services/mediaUrl.service.js).
 */
const mediaSchema = new Schema(
  {
    storageKey:      { type: String, required: true, select: false },
    storageProvider: { type: String, enum: ['server'], default: 'server' },
    category:        { type: String, required: true, index: true },
    visibility:      { type: String, enum: ['public', 'private', 'private-kyc'], required: true },
    mimeType:        { type: String, required: true },
    extension:       { type: String, required: true },
    sizeBytes:       { type: Number, required: true },
    sha256:          { type: String, required: true },
    width:           Number,
    height:          Number,
    durationSec:     Number,
    originalName:    { type: String, maxlength: 150 },
    ownerId:         { type: Schema.Types.ObjectId, default: null },
    ownerRole:       { type: String, enum: ['customer', 'seller', 'delivery', 'admin', 'system', null], default: null },
    uploadStatus:    { type: String, enum: ['stored', 'deleted'], default: 'stored', index: true },
    deletedAt:       Date,
    // Present only for assets copied from Cloudinary.
    legacy: {
      url:          String,
      publicId:     String,
      resourceType: String,
      sizeBytes:    Number,
    },
    migrationStatus: { type: String, enum: ['not_applicable', 'verified', 'quarantined'], default: 'not_applicable' },
  },
  { timestamps: true }
);

mediaSchema.index({ storageKey: 1 }, { unique: true });
mediaSchema.index({ 'legacy.url': 1 }, { unique: true, partialFilterExpression: { 'legacy.url': { $type: 'string' } } });
mediaSchema.index({ ownerId: 1, category: 1, sha256: 1 });
mediaSchema.index({ uploadStatus: 1, updatedAt: 1 });

export default model('Media', mediaSchema);
