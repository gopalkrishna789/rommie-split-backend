import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  _id:           { type: String, required: true },
  room_id:       { type: String, required: true },
  payer_id:      { type: String, required: true },
  purpose:       { type: String, required: true, maxlength: 200 },
  total_amount:  { type: Number, required: true },
  category:      { type: String, default: 'other' },
  notes:         { type: String, default: null },
  receipt_base64:{ type: String, default: null },
  is_recurring:  { type: Boolean, default: false },
  recurring_day: { type: Number, default: null },
  deleted_at:    { type: Date, default: null },
  date:          { type: String, default: () => new Date().toISOString().split('T')[0] },
  created_at:    { type: Date, default: Date.now },
}, { _id: false, id: false });

expenseSchema.index({ room_id: 1 });
expenseSchema.index({ payer_id: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ deleted_at: 1 });

// Drop stale 'id' index if it exists (created by old mongoAdapter code)
expenseSchema.statics.dropStaleIndexes = async function () {
  try {
    await this.collection.dropIndex('id_1');
    console.log('✅ Dropped stale id_1 index from expenses');
  } catch (e) { /* index doesn't exist — fine */ }
};

export default mongoose.model('Expense', expenseSchema);
