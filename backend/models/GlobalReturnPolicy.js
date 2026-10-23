import mongoose from 'mongoose';
import { RETURN_POLICY_MAX_WINDOW_DAYS } from '../constants/enums.js';
const schema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  returnWindowDays: { type: Number, required: true, min: 0, max: RETURN_POLICY_MAX_WINDOW_DAYS, validate: Number.isInteger },
  isActive: { type: Boolean, default: true },
  version: { type: Number, required: true, default: 1 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  history: [{ _id: false, returnWindowDays: Number, isActive: Boolean, version: Number, updatedBy: mongoose.Schema.Types.ObjectId, at: Date }],
}, { timestamps: true, autoIndex: false, autoCreate: false });
export default mongoose.model('GlobalReturnPolicy', schema);
