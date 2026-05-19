import mongoose from 'mongoose';

const splitSchema = new mongoose.Schema({
  _id:              { type: String, required: true },
  expense_id:       { type: String, required: true },
  member_id:        { type: String, required: true },
  share:            { type: Number, required: true },
  paid:             { type: Boolean, default: false },
  paid_at:          { type: Date, default: null },
  carry_forward:    { type: Number, default: 0 },
  amount_paid:      { type: Number, default: 0 },
  payment_status:   { type: String, enum: ['unpaid', 'pending_verification', 'paid'], default: 'unpaid' },
  split_type:       { type: String, default: 'equal' },
  split_percent:    { type: Number, default: null },
}, { _id: false, id: false });

splitSchema.index({ member_id: 1 });
splitSchema.index({ expense_id: 1 });
splitSchema.index({ paid: 1 });
splitSchema.index({ payment_status: 1 });

export default mongoose.model('Split', splitSchema);
