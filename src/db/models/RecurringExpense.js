import mongoose from 'mongoose';

const recurringExpenseSchema = new mongoose.Schema({
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
  amount: {
    type: Number,
    required: true, // paise
  },
  category: {
    type: String,
    default: 'other',
  },
  frequency: {
    type: String,
    enum: ['monthly', 'weekly'],
    default: 'monthly',
  },
  day_of_month: {
    type: Number,
    min: 1,
    max: 31,
  },
  day_of_week: {
    type: Number,
    min: 0,
    max: 6,
  },
  active: {
    type: Boolean,
    default: true,
  },
  last_created_at: {
    type: Date,
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
recurringExpenseSchema.index({ room_id: 1 });
recurringExpenseSchema.index({ active: 1 });

export default mongoose.model('RecurringExpense', recurringExpenseSchema);
