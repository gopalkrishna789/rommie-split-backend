import { v4 as uuidv4 } from 'uuid';

// Use Mongoose models directly when MongoDB is active, fall back to SQL adapter otherwise
let Expense, Member;

async function getModels() {
  if (!Expense) {
    const ExpenseMod = await import('../models/Expense.js');
    const MemberMod  = await import('../models/Member.js');
    Expense = ExpenseMod.default;
    Member  = MemberMod.default;
  }
  return { Expense, Member };
}

const USE_MONGO = !!process.env.MONGODB_URI;

// ── SQL fallback (SQLite / PostgreSQL) ────────────────────────────────────
import { query } from '../index.js';

export async function createExpense({ roomId, payerId, purpose, category, notes, receiptBase64, totalAmount, date, isRecurring, recurringDay }) {
  const id = uuidv4();
  const expDate = date || new Date().toISOString().split('T')[0];

  if (USE_MONGO) {
    const { Expense } = await getModels();
    await Expense.create({
      _id: id,
      room_id: roomId,
      payer_id: payerId,
      purpose,
      category: category || 'other',
      notes: notes || null,
      receipt_base64: receiptBase64 || null,
      total_amount: totalAmount,
      date: expDate,
      is_recurring: !!isRecurring,
      recurring_day: recurringDay || null,
    });
  } else {
    await query(
      `INSERT INTO expenses (id, room_id, payer_id, purpose, category, notes, receipt_base64, total_amount, date, is_recurring, recurring_day)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, roomId, payerId, purpose, category || 'other', notes || null, receiptBase64 || null,
       totalAmount, expDate, isRecurring ? 1 : 0, recurringDay || null]
    );
  }

  return {
    id,
    room_id: roomId,
    payer_id: payerId,
    purpose,
    category: category || 'other',
    notes: notes || null,
    receipt_base64: receiptBase64 || null,
    total_amount: totalAmount,
    date: expDate,
    is_recurring: !!isRecurring,
    recurring_day: recurringDay || null,
    created_at: new Date().toISOString(),
  };
}

export async function getExpensesByRoom(roomId, limit = 20, offset = 0) {
  if (USE_MONGO) {
    const { Expense, Member } = await getModels();
    const expenses = await Expense.find({ room_id: roomId, deleted_at: null })
      .sort({ date: -1, created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    // Enrich with payer info
    const payerIds = [...new Set(expenses.map(e => e.payer_id))];
    const payers = await Member.find({ _id: { $in: payerIds } }).lean();
    const payerMap = Object.fromEntries(payers.map(p => [p._id, p]));

    return expenses.map(e => {
      const payer = payerMap[e.payer_id] || {};
      return {
        ...e,
        id: e._id,
        payer_name: payer.name,
        payer_color: payer.color,
        payer_initials: payer.avatar_initials,
      };
    });
  }

  const res = await query(
    `SELECT e.*, m.name AS payer_name, m.color AS payer_color, m.avatar_initials AS payer_initials
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     WHERE e.room_id = ? AND e.deleted_at IS NULL
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT ? OFFSET ?`,
    [roomId, limit, offset]
  );
  return res.rows;
}

export async function getExpenseById(expenseId) {
  if (USE_MONGO) {
    const { Expense, Member } = await getModels();
    const e = await Expense.findOne({ _id: expenseId, deleted_at: null }).lean();
    if (!e) return null;
    const payer = await Member.findById(e.payer_id).lean();
    return {
      ...e,
      id: e._id,
      payer_name: payer?.name,
      payer_upi_id: payer?.upi_id,
      payer_color: payer?.color,
      payer_initials: payer?.avatar_initials,
      payer_qr: payer?.qr_code_base64,
    };
  }

  const res = await query(
    `SELECT e.*, m.name AS payer_name, m.upi_id AS payer_upi_id,
            m.color AS payer_color, m.avatar_initials AS payer_initials,
            m.qr_code_base64 AS payer_qr
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     WHERE e.id = ? AND e.deleted_at IS NULL`,
    [expenseId]
  );
  return res.rows[0] || null;
}

export async function countExpensesByRoom(roomId) {
  if (USE_MONGO) {
    const { Expense } = await getModels();
    return Expense.countDocuments({ room_id: roomId, deleted_at: null });
  }
  const res = await query(
    `SELECT COUNT(*) AS total FROM expenses WHERE room_id = ? AND deleted_at IS NULL`,
    [roomId]
  );
  return parseInt(res.rows[0].total, 10);
}

export async function updateExpense({ expenseId, purpose, category, notes, totalAmount, date }) {
  if (USE_MONGO) {
    const { Expense } = await getModels();
    const updates = {};
    if (purpose !== undefined)     updates.purpose = purpose;
    if (category !== undefined)    updates.category = category;
    if (notes !== undefined)       updates.notes = notes || null;
    if (totalAmount !== undefined) updates.total_amount = totalAmount;
    if (date !== undefined)        updates.date = date;
    const updated = await Expense.findByIdAndUpdate(expenseId, { $set: updates }, { new: true }).lean();
    return updated ? { ...updated, id: updated._id } : null;
  }

  const updates = [];
  const params = [];
  if (purpose)     { updates.push('purpose = ?');      params.push(purpose); }
  if (category)    { updates.push('category = ?');     params.push(category); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes || null); }
  if (totalAmount) { updates.push('total_amount = ?'); params.push(totalAmount); }
  if (date)        { updates.push('date = ?');         params.push(date); }
  if (!updates.length) return null;
  params.push(expenseId);
  await query(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`, params);
  const res = await query(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
  return res.rows[0] || null;
}

export async function areAllSplitsPaid(expenseId) {
  if (USE_MONGO) {
    const SplitMod = await import('../models/Split.js');
    const Split = SplitMod.default;
    const expense = await (await getModels()).Expense.findById(expenseId).lean();
    if (!expense) return true;
    const unpaid = await Split.countDocuments({
      expense_id: expenseId,
      member_id: { $ne: expense.payer_id },
      paid: false,
    });
    return unpaid === 0;
  }

  const res = await query(
    `SELECT COUNT(*) AS unpaid
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE s.expense_id = ? AND s.member_id != e.payer_id AND s.paid = 0`,
    [expenseId]
  );
  return parseInt(res.rows[0].unpaid, 10) === 0;
}

export async function deleteExpense(expenseId) {
  if (USE_MONGO) {
    const { Expense } = await getModels();
    await Expense.findByIdAndUpdate(expenseId, { $set: { deleted_at: new Date() } });
    return;
  }
  await query(`UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [expenseId]);
}

export async function getRecurringExpenses() {
  if (USE_MONGO) {
    const { Expense, Member } = await getModels();
    const RoomMod = await import('../models/Room.js');
    const Room = RoomMod.default;
    const expenses = await Expense.find({ is_recurring: true, deleted_at: null }).lean();
    const results = [];
    for (const e of expenses) {
      const [payer, room] = await Promise.all([
        Member.findById(e.payer_id).lean(),
        Room.findById(e.room_id).lean(),
      ]);
      results.push({
        ...e,
        id: e._id,
        payer_name: payer?.name,
        payer_upi_id: payer?.upi_id,
        payer_email: payer?.email,
        room_name: room?.name,
      });
    }
    return results;
  }

  const res = await query(
    `SELECT e.*, m.name as payer_name, m.upi_id as payer_upi_id,
            m.email as payer_email, r.name as room_name
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     JOIN rooms r ON e.room_id = r.id
     WHERE e.is_recurring = 1`,
    []
  );
  return res.rows;
}

export async function restoreExpense(expenseId) {
  if (USE_MONGO) {
    const { Expense } = await getModels();
    await Expense.findByIdAndUpdate(expenseId, { $set: { deleted_at: null } });
    return;
  }
  await query(`UPDATE expenses SET deleted_at = NULL WHERE id = ?`, [expenseId]);
}
