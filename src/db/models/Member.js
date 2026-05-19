import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  room_id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
  },
  email: {
    type: String,
    required: false,
  },
  password_hash: {
    type: String,
  },
  upi_id: {
    type: String,
    required: true,
    maxlength: 100,
  },
  qr_code_base64: {
    type: String,
  },
  photo_base64: {
    type: String,
  },
  color: {
    type: String,
    default: '#6366f1',
    maxlength: 7,
  },
  avatar_initials: {
    type: String,
    required: true,
    maxlength: 3,
  },
  fcm_token: {
    type: String,
  },
  push_subscription: {
    type: mongoose.Schema.Types.Mixed,
  },
  tour_completed: {
    type: Boolean,
    default: false,
  },
  reset_token: {
    type: String,
    default: null,
  },
  reset_token_expires: {
    type: Date,
    default: null,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
}, {
  id: false,
});

// Virtual 'id' field
memberSchema.virtual('id').get(function() {
  return this._id;
});

memberSchema.set('toJSON', { virtuals: true });
memberSchema.set('toObject', { virtuals: true });

// Indexes
memberSchema.index({ room_id: 1 });
memberSchema.index({ email: 1 });

export default mongoose.model('Member', memberSchema);
