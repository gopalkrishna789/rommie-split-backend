import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export async function createSplit({ expenseId, memberId, share, paid, paidAt, carryForward }) {
  const id = uuidv4();
  const paidInt = paid ? 1 : 0;
  const paidAtStr = paidAt ? (paidAt instanceof Date ? paidAt.toISOString() : paidAt) : null;

  await query(
    `INSERT INTO splits (id, expense_id, member_id, share, paid, paid_at, carry_forward)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, expenseId, memberId, share, paidInt, paidAtStr, carryForward || 0]
  );
  const res = await query(`SELECT * FROM splits WHERE id = ?`, [id]);
  const row = res.rows[0];
  if (row) row.paid = row.paid === 1 || row.paid === true;
  return row;
}

export async function getSplitsByExpense(expenseId) {
  const res = await query(
    `SELECT s.*, m.name AS member_name, m.color AS member_color,
            m.avatar_initials AS member_initials, m.upi_id AS member_upi_id
     FROM splits s
     JOIN members m ON s.member_id = m.id
     WHERE s.expense_id = ?
     ORDER BY s.paid ASC, m.name ASC`,
    [expenseId]
  );
  return res.rows.map(normalizeRow);
}

export async function getSplitById(splitId) {
  const res = await query(
    `SELECT s.*, m.name AS member_name, m.fcm_token, m.push_subscription,
            e.purpose, e.total_amount, e.payer_id,
            p.name AS payer_name, p.upi_id AS payer_upi_id
     FROM splits s
     JOIN members m ON s.member_id = m.id
     JOIN expenses e ON s.expense_id = e.id
     JOIN members p ON e.payer_id = p.id
     WHERE s.id = ?`,
    [splitId]
  );
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function markSplitPaid(splitId) {
  await query(
    `UPDATE splits SET paid = 1, paid_at = datetime('now') WHERE id = ? AND paid = 0`,
    [splitId]
  );
  const res = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function getUnpaidBalanceForMember(memberId) {
  const res = await query(
    `SELECT COALESCE(SUM(share + carry_forward), 0) AS total
     FROM splits
     WHERE member_id = ? AND paid = 0`,
    [memberId]
  );
  return parseInt(res.rows[0].total, 10) || 0;
}

export async function getMemberNetBalance(memberId) {
  // What this member owes to others (unpaid splits where they are the debtor)
  const owedRes = await query(
    `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE s.member_id = ? AND s.paid = 0 AND e.payer_id != ?`,
    [memberId, memberId]
  );

  // What others owe to this member (unpaid splits for expenses where this member is payer)
  const owedToRes = await query(
    `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed_to
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE e.payer_id = ? AND s.member_id != ? AND s.paid = 0`,
    [memberId, memberId]
  );

  const totalOwed = parseInt(owedRes.rows[0].total_owed, 10) || 0;
  const totalOwedTo = parseInt(owedToRes.rows[0].total_owed_to, 10) || 0;

  return {
    totalOwed,
    totalOwedTo,
    netBalance: totalOwedTo - totalOwed,
  };
}

export async function getUnpaidSplitsForMember(memberId) {
  const res = await query(
    `SELECT s.*, e.purpose, e.date, e.total_amount,
            p.name AS payer_name, p.upi_id AS payer_upi_id,
            p.qr_code_base64 AS payer_qr, p.color AS payer_color,
            p.avatar_initials AS payer_initials
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     JOIN members p ON e.payer_id = p.id
     WHERE s.member_id = ? AND s.paid = 0 AND e.payer_id != ?
     ORDER BY e.date DESC`,
    [memberId, memberId]
  );
  return res.rows.map(normalizeRow);
}

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  out.paid = out.paid === 1 || out.paid === true;
  if (out.push_subscription && typeof out.push_subscription === 'string') {
    try { out.push_subscription = JSON.parse(out.push_subscription); } catch {}
  }
  return out;
}
