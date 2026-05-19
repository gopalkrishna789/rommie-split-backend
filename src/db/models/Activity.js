import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  room_id: {
    type: String,
    required: true,
  },
  member_id: {
    type: String,
  },
  type: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
}, {
  _id: false, // We're defining _id manually
  id: false, // Disable virtual id getter
});

// Indexes
activitySchema.index({ room_id: 1, created_at: -1 });

export default mongoose.model('Activity', activitySchema);
