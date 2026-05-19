import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    maxlength: 100,
  },
  invite_code: {
    type: String,
    required: true,
    unique: true,
    length: 8,
  },
  rent_amount: {
    type: Number,
    default: 462500, // stored in paise
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
}, {
  id: false, // Disable virtual id getter
});

// Virtual 'id' field that returns _id
roomSchema.virtual('id').get(function() {
  return this._id;
});

// Ensure virtuals are included in JSON
roomSchema.set('toJSON', { virtuals: true });
roomSchema.set('toObject', { virtuals: true });

// Indexes
roomSchema.index({ invite_code: 1 }, { unique: true });

export default mongoose.model('Room', roomSchema);
