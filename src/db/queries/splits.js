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
    `UPDATE splits SET paid = 1, paid_at = datetime('now'), amount_paid = share WHERE id = ? AND paid = 0`,
    [splitId]
  );
  const res = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

export async function markSplitPartialPaid(splitId, amountPaid) {
  const res = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  const split = res.rows[0];
  if (!split) return null;
  const total = split.share + split.carry_forward;
  const newAmountPaid = Math.min((split.amount_paid || 0) + amountPaid, total);
  const fullyPaid = newAmountPaid >= total;
  await query(
    `UPDATE splits SET amount_paid = ?, paid = ?, paid_at = CASE WHEN ? = 1 THEN datetime('now') ELSE paid_at END WHERE id = ?`,
    [newAmountPaid, fullyPaid ? 1 : 0, fullyPaid ? 1 : 0, splitId]
  );
  const updated = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  return updated.rows[0] ? normalizeRow(updated.rows[0]) : null;
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

/**
 * Get unpaid balance for a specific debtor to a specific payer.
 * This is used for carry_forward calculation to avoid double-counting.
 * Only includes unpaid splits where the debtor owes money to this specific payer.
 */
export async function getUnpaidBalanceToSpecificPayer(debtorId, payerId) {
  const res = await query(
    `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE s.member_id = ? AND e.payer_id = ? AND s.paid = 0`,
    [debtorId, payerId]
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
    `SELECT s.*, e.purpose, e.date, e.total_amount, e.payer_id,
            p.name AS payer_name, p.upi_id AS payer_upi_id,
            p.qr_code_base64 AS payer_qr, p.color AS payer_color,
            p.avatar_initials AS payer_initials,
            m.name AS member_name, m.color AS member_color,
            m.avatar_initials AS member_initials
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     JOIN members p ON e.payer_id = p.id
     JOIN members m ON s.member_id = m.id
     WHERE s.member_id = ? AND s.paid = 0 AND e.payer_id != ?
     ORDER BY e.date DESC`,
    [memberId, memberId]
  );
  return res.rows.map(normalizeRow);
}

export async function getPendingVerificationSplitsForPayer(payerId) {
  const res = await query(
    `SELECT s.*, e.purpose, e.date, e.total_amount, e.payer_id,
            p.name AS payer_name, p.upi_id AS payer_upi_id,
            p.qr_code_base64 AS payer_qr, p.color AS payer_color,
            p.avatar_initials AS payer_initials,
            m.name AS member_name, m.color AS member_color,
            m.avatar_initials AS member_initials
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     JOIN members p ON e.payer_id = p.id
     JOIN members m ON s.member_id = m.id
     WHERE e.payer_id = ? AND s.payment_status = 'pending_verification'
     ORDER BY e.date DESC`,
    [payerId]
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

/**
 * Recalculate unpaid splits when an expense's totalAmount changes.
 * Only updates splits that are NOT yet paid — paid splits are left untouched.
 * Distributes the new total equally among all members (same as original equal split).
 */
export async function recalculateSplitsForExpense(expenseId, newTotalAmount) {
  // Get all splits for this expense
  const res = await query(
    `SELECT s.*, e.payer_id FROM splits s JOIN expenses e ON s.expense_id = e.id WHERE s.expense_id = ?`,
    [expenseId]
  );
  const splits = res.rows;
  if (!splits.length) return;

  const memberCount = splits.length;
  const perShare = Math.round(newTotalAmount / memberCount);

  // Distribute rounding remainder to the last unpaid non-payer split
  let distributed = 0;
  const unpaidNonPayer = splits.filter(s => !s.paid && s.member_id !== splits[0].payer_id);

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    if (split.paid) continue; // never touch paid splits

    let newShare;
    if (i === splits.length - 1) {
      // Last split gets the remainder to avoid rounding drift
      newShare = newTotalAmount - distributed;
    } else {
      newShare = perShare;
    }
    distributed += newShare;

    await query(
      `UPDATE splits SET share = ? WHERE id = ? AND paid = 0`,
      [newShare, split.id]
    );
  }
}

/**
 * Get net balances for ALL members of a room in a single query.
 * Replaces the N+1 pattern of calling getMemberNetBalance() per member.
 */
export async function getAllMemberBalances(roomId) {
  // What each member owes (they are debtor, not payer)
  const owedRes = await query(
    `SELECT s.member_id,
            COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE e.room_id = ? AND s.paid = 0 AND e.payer_id != s.member_id
     GROUP BY s.member_id`,
    [roomId]
  );

  // What each member is owed (they are payer, others haven't paid)
  const owedToRes = await query(
    `SELECT e.payer_id AS member_id,
            COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed_to
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE e.room_id = ? AND s.paid = 0 AND s.member_id != e.payer_id
     GROUP BY e.payer_id`,
    [roomId]
  );

  const owedMap   = Object.fromEntries(owedRes.rows.map(r => [r.member_id, parseInt(r.total_owed, 10) || 0]));
  const owedToMap = Object.fromEntries(owedToRes.rows.map(r => [r.member_id, parseInt(r.total_owed_to, 10) || 0]));

  return { owedMap, owedToMap };
}

/**
 * After a split is paid, recalculate carry_forward on all remaining unpaid splits
 * for that member so the balance shown is always current.
 */
export async function refreshCarryForwardForMember(memberId) {
  // Get current total unpaid balance (excluding carry_forward to avoid double-counting)
  const res = await query(
    `SELECT COALESCE(SUM(share), 0) AS total_share
     FROM splits
     WHERE member_id = ? AND paid = 0`,
    [memberId]
  );
  // The carry_forward on each unpaid split should reflect what was owed at creation time.
  // We can't retroactively change history, but we CAN zero out stale carry_forward
  // on splits that were created AFTER the payment that just happened.
  // Simplest correct approach: set carry_forward = 0 on all unpaid splits
  // where the carry_forward is now "stale" (i.e., the debt it referenced is now paid).
  // We do this by recalculating: new carry_forward = current unpaid balance BEFORE this split.
  const unpaidSplits = await query(
    `SELECT s.id, s.carry_forward, s.share, e.created_at
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE s.member_id = ? AND s.paid = 0
     ORDER BY e.created_at ASC`,
    [memberId]
  );

  let runningBalance = 0;
  for (const split of unpaidSplits.rows) {
    if (split.carry_forward !== runningBalance) {
      await query(
        `UPDATE splits SET carry_forward = ? WHERE id = ?`,
        [runningBalance, split.id]
      );
    }
    runningBalance += split.share;
  }
}
