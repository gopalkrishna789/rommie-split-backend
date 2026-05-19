import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  room_id: {
    type: String,
    required: true,
  },
  payer_id: {
    type: String,
    required: true,
  },
  purpose: {
    type: String,
    required: true,
    maxlength: 200,
  },
  total_amount: {
    type: Number,
    required: true, // stored in paise
  },
  category: {
    type: String,
    default: 'other',
  },
  notes: {
    type: String,
  },
  date: {
    type: Date,
    default: Date.now,
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
expenseSchema.index({ room_id: 1 });
expenseSchema.index({ payer_id: 1 });
expenseSchema.index({ date: -1 });

export default mongoose.model('Expense', expenseSchema);
