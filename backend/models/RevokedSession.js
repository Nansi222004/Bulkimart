import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A signed-out session token (audit M2/H3). Only the SHA-256 of the token is stored, never the token. The row
 * expires with the token itself (TTL), so the collection never grows beyond currently-valid revoked tokens.
 */
const revokedSessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  subjectId: { type: String, required: true },
  subjectType: { type: String, enum: ['admin', 'user'], required: true },
  revokedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });

revokedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model('RevokedSession', revokedSessionSchema);
