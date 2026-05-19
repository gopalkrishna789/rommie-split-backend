import { v4 as uuidv4 } from 'uuid';
import { query } from '../index.js';

const USE_MONGO = !!process.env.MONGODB_URI;

let Split, Expense, Member;
async function getModels() {
  if (!Split) {
    Split   = (await import('../models/Split.js')).default;
    Expense = (await import('../models/Expense.js')).default;
    Member  = (await import('../models/Member.js')).default;
  }
  return { Split, Expense, Member };
}

// ── createSplit ───────────────────────────────────────────────────────────
export async function createSplit({ expenseId, memberId, share, paid, paidAt, carryForward }) {
  const id = uuidv4();
  const paidAtDate = paidAt ? (paidAt instanceof Date ? paidAt : new Date(paidAt)) : null;

  if (USE_MONGO) {
    const { Split } = await getModels();
    await Split.create({
      _id: id,
      expense_id: expenseId,
      member_id: memberId,
      share,
      paid: !!paid,
      paid_at: paidAtDate,
      carry_forward: carryForward || 0,
      payment_status: paid ? 'paid' : 'unpaid',
    });
  } else {
    await query(
      `INSERT INTO splits (id, expense_id, member_id, share, paid, paid_at, carry_forward)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, expenseId, memberId, share, paid ? 1 : 0,
       paidAtDate ? paidAtDate.toISOString() : null, carryForward || 0]
    );
  }

  return {
    id,
    expense_id: expenseId,
    member_id: memberId,
    share,
    paid: !!paid,
    paid_at: paidAtDate,
    carry_forward: carryForward || 0,
    amount_paid: 0,
    payment_status: paid ? 'paid' : 'unpaid',
  };
}

// ── getSplitsByExpense ────────────────────────────────────────────────────
export async function getSplitsByExpense(expenseId) {
  if (USE_MONGO) {
    const { Split, Member } = await getModels();
    const splits = await Split.find({ expense_id: expenseId }).lean();
    const memberIds = [...new Set(splits.map(s => s.member_id))];
    const members = await Member.find({ _id: { $in: memberIds } }).lean();
    const memberMap = Object.fromEntries(members.map(m => [m._id, m]));
    return splits.map(s => {
      const m = memberMap[s.member_id] || {};
      return normalizeRow({
        ...s, id: s._id,
        member_name: m.name,
        member_color: m.color,
        member_initials: m.avatar_initials,
        member_upi_id: m.upi_id,
      });
    });
  }

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

// ── getSplitById ──────────────────────────────────────────────────────────
export async function getSplitById(splitId) {
  if (USE_MONGO) {
    const { Split, Expense, Member } = await getModels();
    const s = await Split.findById(splitId).lean();
    if (!s) return null;
    const [expense, member] = await Promise.all([
      Expense.findById(s.expense_id).lean(),
      Member.findById(s.member_id).lean(),
    ]);
    const payer = expense ? await Member.findById(expense.payer_id).lean() : null;
    return normalizeRow({
      ...s, id: s._id,
      member_name: member?.name,
      fcm_token: member?.fcm_token,
      push_subscription: member?.push_subscription,
      purpose: expense?.purpose,
      total_amount: expense?.total_amount,
      payer_id: expense?.payer_id,
      payer_name: payer?.name,
      payer_upi_id: payer?.upi_id,
    });
  }

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

// ── markSplitPaid ─────────────────────────────────────────────────────────
export async function markSplitPaid(splitId) {
  if (USE_MONGO) {
    const { Split } = await getModels();
    const s = await Split.findById(splitId).lean();
    if (!s) return null;
    const updated = await Split.findByIdAndUpdate(
      splitId,
      { $set: { paid: true, paid_at: new Date(), amount_paid: s.share, payment_status: 'paid' } },
      { new: true }
    ).lean();
    return updated ? normalizeRow({ ...updated, id: updated._id }) : null;
  }

  await query(
    `UPDATE splits SET paid = 1, paid_at = datetime('now'), amount_paid = share WHERE id = ? AND paid = 0`,
    [splitId]
  );
  const res = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  return res.rows[0] ? normalizeRow(res.rows[0]) : null;
}

// ── markSplitPartialPaid ──────────────────────────────────────────────────
export async function markSplitPartialPaid(splitId, amountPaid) {
  if (USE_MONGO) {
    const { Split } = await getModels();
    const s = await Split.findById(splitId).lean();
    if (!s) return null;
    const total = s.share + s.carry_forward;
    const newAmountPaid = Math.min((s.amount_paid || 0) + amountPaid, total);
    const fullyPaid = newAmountPaid >= total;
    const updated = await Split.findByIdAndUpdate(
      splitId,
      { $set: { amount_paid: newAmountPaid, paid: fullyPaid, paid_at: fullyPaid ? new Date() : s.paid_at, payment_status: fullyPaid ? 'paid' : 'unpaid' } },
      { new: true }
    ).lean();
    return updated ? normalizeRow({ ...updated, id: updated._id }) : null;
  }

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

// ── getUnpaidBalanceForMember ─────────────────────────────────────────────
export async function getUnpaidBalanceForMember(memberId) {
  if (USE_MONGO) {
    const { Split } = await getModels();
    const result = await Split.aggregate([
      { $match: { member_id: memberId, paid: false } },
      { $group: { _id: null, total: { $sum: { $add: ['$share', '$carry_forward'] } } } },
    ]);
    return result[0]?.total || 0;
  }

  const res = await query(
    `SELECT COALESCE(SUM(share + carry_forward), 0) AS total FROM splits WHERE member_id = ? AND paid = 0`,
    [memberId]
  );
  return parseInt(res.rows[0].total, 10) || 0;
}

// ── getUnpaidBalanceToSpecificPayer ───────────────────────────────────────
export async function getUnpaidBalanceToSpecificPayer(debtorId, payerId) {
  if (USE_MONGO) {
    const { Split, Expense } = await getModels();
    // Get all expenses paid by payerId
    const payerExpenses = await Expense.find({ payer_id: payerId, deleted_at: null }).lean();
    const expenseIds = payerExpenses.map(e => e._id);
    if (!expenseIds.length) return 0;
    const result = await Split.aggregate([
      { $match: { member_id: debtorId, expense_id: { $in: expenseIds }, paid: false } },
      { $group: { _id: null, total: { $sum: { $add: ['$share', '$carry_forward'] } } } },
    ]);
    return result[0]?.total || 0;
  }

  const res = await query(
    `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     WHERE s.member_id = ? AND e.payer_id = ? AND s.paid = 0`,
    [debtorId, payerId]
  );
  return parseInt(res.rows[0].total, 10) || 0;
}

// ── getMemberNetBalance ───────────────────────────────────────────────────
export async function getMemberNetBalance(memberId) {
  if (USE_MONGO) {
    const { Split, Expense } = await getModels();
    const [owedResult, owedToResult] = await Promise.all([
      // What this member owes
      (async () => {
        const expenses = await Expense.find({ payer_id: { $ne: memberId }, deleted_at: null }).lean();
        const expIds = expenses.map(e => e._id);
        const r = await Split.aggregate([
          { $match: { member_id: memberId, expense_id: { $in: expIds }, paid: false } },
          { $group: { _id: null, total: { $sum: { $add: ['$share', '$carry_forward'] } } } },
        ]);
        return r[0]?.total || 0;
      })(),
      // What others owe this member
      (async () => {
        const expenses = await Expense.find({ payer_id: memberId, deleted_at: null }).lean();
        const expIds = expenses.map(e => e._id);
        const r = await Split.aggregate([
          { $match: { member_id: { $ne: memberId }, expense_id: { $in: expIds }, paid: false } },
          { $group: { _id: null, total: { $sum: { $add: ['$share', '$carry_forward'] } } } },
        ]);
        return r[0]?.total || 0;
      })(),
    ]);
    return { totalOwed: owedResult, totalOwedTo: owedToResult, netBalance: owedToResult - owedResult };
  }

  const [owedRes, owedToRes] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed
       FROM splits s JOIN expenses e ON s.expense_id = e.id
       WHERE s.member_id = ? AND s.paid = 0 AND e.payer_id != ?`,
      [memberId, memberId]
    ),
    query(
      `SELECT COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed_to
       FROM splits s JOIN expenses e ON s.expense_id = e.id
       WHERE e.payer_id = ? AND s.member_id != ? AND s.paid = 0`,
      [memberId, memberId]
    ),
  ]);
  const totalOwed   = parseInt(owedRes.rows[0].total_owed, 10) || 0;
  const totalOwedTo = parseInt(owedToRes.rows[0].total_owed_to, 10) || 0;
  return { totalOwed, totalOwedTo, netBalance: totalOwedTo - totalOwed };
}

// ── getUnpaidSplitsForMember ──────────────────────────────────────────────
export async function getUnpaidSplitsForMember(memberId) {
  if (USE_MONGO) {
    const { Split, Expense, Member } = await getModels();
    const splits = await Split.find({ member_id: memberId, paid: false }).lean();
    const results = [];
    for (const s of splits) {
      const expense = await Expense.findOne({ _id: s.expense_id, deleted_at: null }).lean();
      if (!expense || expense.payer_id === memberId) continue;
      const [payer, member] = await Promise.all([
        Member.findById(expense.payer_id).lean(),
        Member.findById(memberId).lean(),
      ]);
      results.push(normalizeRow({
        ...s, id: s._id,
        purpose: expense.purpose,
        date: expense.date,
        total_amount: expense.total_amount,
        payer_id: expense.payer_id,
        payer_name: payer?.name,
        payer_upi_id: payer?.upi_id,
        payer_qr: payer?.qr_code_base64,
        payer_color: payer?.color,
        payer_initials: payer?.avatar_initials,
        member_name: member?.name,
        member_color: member?.color,
        member_initials: member?.avatar_initials,
      }));
    }
    return results;
  }

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

// ── getPendingVerificationSplitsForPayer ──────────────────────────────────
export async function getPendingVerificationSplitsForPayer(payerId) {
  if (USE_MONGO) {
    const { Split, Expense, Member } = await getModels();
    const expenses = await Expense.find({ payer_id: payerId, deleted_at: null }).lean();
    const expIds = expenses.map(e => e._id);
    const splits = await Split.find({ expense_id: { $in: expIds }, payment_status: 'pending_verification' }).lean();
    const results = [];
    for (const s of splits) {
      const expense = expenses.find(e => e._id === s.expense_id);
      const [payer, member] = await Promise.all([
        Member.findById(payerId).lean(),
        Member.findById(s.member_id).lean(),
      ]);
      results.push(normalizeRow({
        ...s, id: s._id,
        purpose: expense?.purpose,
        date: expense?.date,
        total_amount: expense?.total_amount,
        payer_id: payerId,
        payer_name: payer?.name,
        payer_upi_id: payer?.upi_id,
        payer_qr: payer?.qr_code_base64,
        payer_color: payer?.color,
        payer_initials: payer?.avatar_initials,
        member_name: member?.name,
        member_color: member?.color,
        member_initials: member?.avatar_initials,
      }));
    }
    return results;
  }

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

// ── getAllMemberBalances ───────────────────────────────────────────────────
export async function getAllMemberBalances(roomId) {
  if (USE_MONGO) {
    const { Split, Expense } = await getModels();
    const expenses = await Expense.find({ room_id: roomId, deleted_at: null }).lean();
    const expIds = expenses.map(e => e._id);
    const expPayerMap = Object.fromEntries(expenses.map(e => [e._id, e.payer_id]));

    const splits = await Split.find({ expense_id: { $in: expIds }, paid: false }).lean();

    const owedMap = {};
    const owedToMap = {};

    for (const s of splits) {
      const payerId = expPayerMap[s.expense_id];
      if (!payerId || s.member_id === payerId) continue;
      const amount = (s.share || 0) + (s.carry_forward || 0);
      owedMap[s.member_id]   = (owedMap[s.member_id]   || 0) + amount;
      owedToMap[payerId]     = (owedToMap[payerId]      || 0) + amount;
    }

    return { owedMap, owedToMap };
  }

  const [owedRes, owedToRes] = await Promise.all([
    query(
      `SELECT s.member_id, COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed
       FROM splits s JOIN expenses e ON s.expense_id = e.id
       WHERE e.room_id = ? AND s.paid = 0 AND e.payer_id != s.member_id
       GROUP BY s.member_id`,
      [roomId]
    ),
    query(
      `SELECT e.payer_id AS member_id, COALESCE(SUM(s.share + s.carry_forward), 0) AS total_owed_to
       FROM splits s JOIN expenses e ON s.expense_id = e.id
       WHERE e.room_id = ? AND s.paid = 0 AND s.member_id != e.payer_id
       GROUP BY e.payer_id`,
      [roomId]
    ),
  ]);

  const owedMap   = Object.fromEntries(owedRes.rows.map(r => [r.member_id, parseInt(r.total_owed, 10) || 0]));
  const owedToMap = Object.fromEntries(owedToRes.rows.map(r => [r.member_id, parseInt(r.total_owed_to, 10) || 0]));
  return { owedMap, owedToMap };
}

// ── recalculateSplitsForExpense ───────────────────────────────────────────
export async function recalculateSplitsForExpense(expenseId, newTotalAmount) {
  if (USE_MONGO) {
    const { Split } = await getModels();
    const splits = await Split.find({ expense_id: expenseId }).lean();
    if (!splits.length) return;
    const perShare = Math.round(newTotalAmount / splits.length);
    let distributed = 0;
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      if (s.paid) continue;
      const newShare = i === splits.length - 1 ? newTotalAmount - distributed : perShare;
      distributed += newShare;
      await Split.findByIdAndUpdate(s._id, { $set: { share: newShare } });
    }
    return;
  }

  const res = await query(
    `SELECT s.*, e.payer_id FROM splits s JOIN expenses e ON s.expense_id = e.id WHERE s.expense_id = ?`,
    [expenseId]
  );
  const splits = res.rows;
  if (!splits.length) return;
  const perShare = Math.round(newTotalAmount / splits.length);
  let distributed = 0;
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    if (split.paid) continue;
    const newShare = i === splits.length - 1 ? newTotalAmount - distributed : perShare;
    distributed += newShare;
    await query(`UPDATE splits SET share = ? WHERE id = ? AND paid = 0`, [newShare, split.id]);
  }
}

// ── refreshCarryForwardForMember ──────────────────────────────────────────
export async function refreshCarryForwardForMember(memberId) {
  if (USE_MONGO) {
    const { Split, Expense } = await getModels();
    const unpaidSplits = await Split.find({ member_id: memberId, paid: false }).lean();
    const expIds = unpaidSplits.map(s => s.expense_id);
    const expenses = await Expense.find({ _id: { $in: expIds } }).lean();
    const expDateMap = Object.fromEntries(expenses.map(e => [e._id, e.created_at]));
    unpaidSplits.sort((a, b) => new Date(expDateMap[a.expense_id]) - new Date(expDateMap[b.expense_id]));
    let runningBalance = 0;
    for (const s of unpaidSplits) {
      if (s.carry_forward !== runningBalance) {
        await Split.findByIdAndUpdate(s._id, { $set: { carry_forward: runningBalance } });
      }
      runningBalance += s.share;
    }
    return;
  }

  const unpaidSplits = await query(
    `SELECT s.id, s.carry_forward, s.share, e.created_at
     FROM splits s JOIN expenses e ON s.expense_id = e.id
     WHERE s.member_id = ? AND s.paid = 0 ORDER BY e.created_at ASC`,
    [memberId]
  );
  let runningBalance = 0;
  for (const split of unpaidSplits.rows) {
    if (split.carry_forward !== runningBalance) {
      await query(`UPDATE splits SET carry_forward = ? WHERE id = ?`, [runningBalance, split.id]);
    }
    runningBalance += split.share;
  }
}

// ── getUnpaidSplitsForMember (alias used in removeMember) ─────────────────
export { getUnpaidSplitsForMember as getUnpaidSplitsForMemberCheck };

// ── normalizeRow ──────────────────────────────────────────────────────────
function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  out.paid = out.paid === 1 || out.paid === true;
  if (out.push_subscription && typeof out.push_subscription === 'string') {
    try { out.push_subscription = JSON.parse(out.push_subscription); } catch {}
  }
  return out;
}
