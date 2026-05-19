import mongoose from 'mongoose';

const splitSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  expense_id: {
    type: String,
    required: true,
  },
  member_id: {
    type: String,
    required: true,
  },
  share: {
    type: Number,
    required: true, // paise
  },
  paid: {
    type: Boolean,
    default: false,
  },
  paid_at: {
    type: Date,
  },
  carry_forward: {
    type: Number,
    default: 0, // paise
  },
  status: {
    type: String,
    enum: ['unpaid', 'pending_verification', 'paid'],
    default: 'unpaid',
  },
  payment_attempts: {
    type: Number,
    default: 0,
  },
}, {
  _id: false, // We're defining _id manually
  id: false, // Disable virtual id getter
});

// Indexes
splitSchema.index({ member_id: 1 });
splitSchema.index({ expense_id: 1 });
splitSchema.index({ paid: 1 });
splitSchema.index({ status: 1 });

export default mongoose.model('Split', splitSchema);
