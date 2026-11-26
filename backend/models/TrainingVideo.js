import mongoose from 'mongoose';

const { Schema, model } = mongoose;

export const TRAINING_AUDIENCES = ['seller', 'delivery'];
export const TRAINING_SOURCES = ['upload', 'youtube'];

/**
 * A how-to video an admin publishes for sellers or delivery partners ("Training" in the seller and
 * rider apps). Either an MP4 stored on our own server (`videoUrl`, media category admin.trainingvideo)
 * or an unlisted YouTube video (`youtubeId`). Optional learning: nothing in the apps is blocked on it.
 */
const trainingVideoSchema = new Schema(
  {
    audience: { type: String, enum: TRAINING_AUDIENCES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    // Groups videos in the app, e.g. "Getting started", "Orders", "Payments".
    topic: { type: String, trim: true, maxlength: 60, default: 'General' },
    source: { type: String, enum: TRAINING_SOURCES, required: true },
    videoUrl: { type: String, default: '' },
    youtubeId: { type: String, default: '' },
    durationSec: { type: Number, min: 0 },
    // Lower comes first inside a topic.
    sortOrder: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true },
);

trainingVideoSchema.index({ audience: 1, isPublished: 1, topic: 1, sortOrder: 1 });

export default mongoose.models.TrainingVideo || model('TrainingVideo', trainingVideoSchema);
