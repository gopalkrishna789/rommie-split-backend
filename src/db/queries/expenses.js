import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export async function createExpense({ roomId, payerId, purpose, category, notes, receiptBase64, totalAmount, date, isRecurring, recurringDay }) {
  const id = uuidv4();
  const expDate = date || new Date().toISOString().split('T')[0];
  await query(
    `INSERT INTO expenses (id, room_id, payer_id, purpose, category, notes, receipt_base64, total_amount, date, is_recurring, recurring_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, payerId, purpose, category || 'other', notes || null, receiptBase64 || null,
     totalAmount, expDate, isRecurring ? 1 : 0, recurringDay || null]
  );
  const res = await query(`SELECT * FROM expenses WHERE id = ?`, [id]);
  return res.rows[0];
}

export async function updateExpense({ expenseId, purpose, category, notes, totalAmount, date }) {
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

export async function getRecurringExpenses() {
  const res = await query(
    `SELECT e.*, r.id as room_id_check, m.name as payer_name, m.upi_id as payer_upi_id,
            m.email as payer_email, r.name as room_name
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     JOIN rooms r ON e.room_id = r.id
     WHERE e.is_recurring = 1`,
    []
  );
  return res.rows;
}

export async function getExpensesByRoom(roomId, limit = 20, offset = 0) {
  const res = await query(
    `SELECT e.*, m.name AS payer_name, m.color AS payer_color, m.avatar_initials AS payer_initials
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     WHERE e.room_id = ?
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT ? OFFSET ?`,
    [roomId, limit, offset]
  );
  return res.rows;
}

export async function getExpenseById(expenseId) {
  const res = await query(
    `SELECT e.*, m.name AS payer_name, m.upi_id AS payer_upi_id,
            m.color AS payer_color, m.avatar_initials AS payer_initials,
            m.qr_code_base64 AS payer_qr
     FROM expenses e
     JOIN members m ON e.payer_id = m.id
     WHERE e.id = ?`,
    [expenseId]
  );
  return res.rows[0] || null;
}

export async function countExpensesByRoom(roomId) {
  const res = await query(
    `SELECT COUNT(*) AS total FROM expenses WHERE room_id = ?`,
    [roomId]
  );
  return parseInt(res.rows[0].total, 10);
}

/**
 * Check if all non-payer splits for an expense are paid.
 * Returns true only when every roommate has settled their share.
 */
export async function areAllSplitsPaid(expenseId) {
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
  // Splits and payment_attempts are deleted via ON DELETE CASCADE
  await query(`DELETE FROM expenses WHERE id = ?`, [expenseId]);
}
