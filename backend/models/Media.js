import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Migration records are reserved before the copy starts (status `copying`) so a
// retry reuses the same record instead of creating a duplicate; file details
// are only required once the file is stored.
const MIGRATION_IN_PROGRESS = ['copying', 'failed'];
function requiredOnceStored() { return !MIGRATION_IN_PROGRESS.includes(this.migrationStatus); }

/**
 * Metadata for one stored file. Bytes live on disk under MEDIA_ROOT; this
 * record holds only the opaque storage key and descriptive metadata. The key
 * is select:false and never serialised to clients.
 *
 * Existing business records keep storing plain strings: a public media URL,
 * or the opaque reference `media:<_id>` for private media, which API responses
 * resolve to a short-lived signed URL (services/mediaUrl.service.js).
 *
 * Indexes are NOT built automatically (autoIndex: false). They are created
 * explicitly with `node scripts/media/migrate.mjs indexes --apply`, which only
 * adds missing indexes and never drops any (docs/STORAGE_FINAL_SERVER_COMMANDS.md §F).
 */
const mediaSchema = new Schema(
  {
    storageKey:      { type: String, select: false, required: requiredOnceStored },
    storageProvider: { type: String, enum: ['server'], default: 'server' },
    category:        { type: String, required: true, index: true },
    visibility:      { type: String, enum: ['public', 'private', 'private-kyc'], required: true },
    mimeType:        { type: String, required: requiredOnceStored },
    extension:       { type: String, required: requiredOnceStored },
    sizeBytes:       { type: Number, required: requiredOnceStored },
    sha256:          { type: String, required: requiredOnceStored },
    width:           Number,
    height:          Number,
    durationSec:     Number,
    originalName:    { type: String, maxlength: 150 },
    ownerId:         { type: Schema.Types.ObjectId, default: null },
    ownerRole:       { type: String, enum: ['customer', 'seller', 'delivery', 'admin', 'system', null], default: null },
    // pending: a migration copy is reserved or in progress; nothing is served.
    uploadStatus:    { type: String, enum: ['pending', 'stored', 'deleted'], default: 'stored', index: true },
    deletedAt:       Date,
    // Present only for assets copied from Cloudinary.
    legacy: {
      url:          String,
      publicId:     String,
      resourceType: String,
      sizeBytes:    Number,
    },
    // not_applicable: a normal upload. copying/failed: eligible for retry.
    // verified: copied and integrity-checked, served by the legacy read map.
    // quarantined: copied but content not allowed for its category; never served.
    migrationStatus: { type: String, enum: ['not_applicable', 'copying', 'failed', 'verified', 'quarantined'], default: 'not_applicable' },
    migration: {
      attempts:      { type: Number, default: 0 },
      lastAttemptAt: Date,
      lastError:     { type: String, maxlength: 300 },
    },
  },
  { timestamps: true, autoIndex: false }
);

mediaSchema.index({ storageKey: 1 }, { unique: true, partialFilterExpression: { storageKey: { $type: 'string' } } });
mediaSchema.index({ 'legacy.url': 1 }, { unique: true, partialFilterExpression: { 'legacy.url': { $type: 'string' } } });
mediaSchema.index({ ownerId: 1, category: 1, sha256: 1 });
mediaSchema.index({ uploadStatus: 1, updatedAt: 1 });
mediaSchema.index({ migrationStatus: 1, _id: 1 });

export default model('Media', mediaSchema);
