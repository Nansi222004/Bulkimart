import mongoose from 'mongoose';
import { AGENT_STATUSES, AGENT_STATUS } from '../constants/enums.js';

const { Schema, model } = mongoose;

/**
 * An admin's live-chat availability preference. Whether they are actually
 * online comes from their live socket connections (services/supportChat
 * presence), so an agent who closed the tab is OFFLINE whatever is stored here.
 */
const supportAgentSchema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'Admin', required: true, unique: true },
  status: { type: String, enum: AGENT_STATUSES, default: AGENT_STATUS.AVAILABLE },
  lastSeenAt: Date,
}, { timestamps: true });

const SupportAgent = model('SupportAgent', supportAgentSchema);
export default SupportAgent;
