import { createExpense, getExpensesByRoom, getExpenseById, countExpensesByRoom, areAllSplitsPaid, deleteExpense } from '../db/queries/expenses.js';
import { getSplitsByExpense, getSplitById, markSplitPaid, getMemberNetBalance } from '../db/queries/splits.js';
import { getMembersByRoom, getMemberById } from '../db/queries/members.js';
import { createSplits } from '../services/splitService.js';
import { invalidateBalanceCache, getCachedBalances, setCachedBalances } from '../services/redisService.js';
import { notifyExpenseAdded, notifyPaymentReceived } from '../services/pushService.js';
import { emitExpenseAdded, emitSplitPaid, emitBalanceUpdated, emitToRoom } from '../socket/index.js';
import {
  createPaymentAttempt,
  updatePaymentAttemptStatus,
  getLatestAttemptForSplit,
  getAttemptsForSplit,
} from '../db/queries/paymentAttempts.js';

export async function addExpense(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { payerId, purpose, totalAmount, date, category, notes, customShares } = request.body;

  if (!payerId || !purpose || !totalAmount) {
    return reply.code(400).send({ error: 'payerId, purpose, and totalAmount are required' });
  }
  if (totalAmount <= 0) {
    return reply.code(400).send({ error: 'totalAmount must be positive (in paise)' });
  }

  // Verify payer belongs to this room
  const payer = await getMemberById(payerId);
  if (!payer || payer.room_id !== roomId) {
    return reply.code(400).send({ error: 'Invalid payer' });
  }

  // Get all members in the room
  const members = await getMembersByRoom(roomId);
  if (members.length === 0) {
    return reply.code(400).send({ error: 'No members in room' });
  }

  // Create expense
  const expense = await createExpense({
    roomId,
    payerId,
    purpose: purpose.trim(),
    category: category || 'other',
    notes: notes?.trim() || null,
    totalAmount,
    date,
  });

  // Create splits for all members
  const memberIds = members.map((m) => m.id);
  const splits = await createSplits(expense.id, payerId, totalAmount, memberIds, customShares);

  // Invalidate Redis balance cache
  await invalidateBalanceCache(roomId);

  // Enrich splits with member info for response
  const enrichedSplits = splits.map((split) => {
    const member = members.find((m) => m.id === split.member_id);
    return {
      ...split,
      member_name: member?.name,
      member_color: member?.color,
      member_initials: member?.avatar_initials,
    };
  });

  // Emit Socket.io event to all room members
  emitExpenseAdded(roomId, {
    expense: { ...expense, payer_name: payer.name, payer_color: payer.color },
    splits: enrichedSplits,
    payerName: payer.name,
    totalAmount,
    purpose: expense.purpose,
  });

  // Send push notifications (non-blocking)
  notifyExpenseAdded(
    members,
    payer.name,
    totalAmount,
    expense.purpose,
    expense.id,
    splits.map((s) => ({ ...s, payer_upi_id: payer.upi_id }))
  ).catch(console.error);

  return reply.code(201).send({
    expense: { ...expense, payer_name: payer.name },
    splits: enrichedSplits,
  });
}

export async function listExpenses(request, reply) {
  const { roomId } = request.user;
  const page = parseInt(request.query.page || '1', 10);
  const limit = parseInt(request.query.limit || '20', 10);
  const offset = (page - 1) * limit;

  const [expenses, total] = await Promise.all([
    getExpensesByRoom(roomId, limit, offset),
    countExpensesByRoom(roomId),
  ]);

  return reply.send({
    expenses,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + expenses.length < total,
    },
  });
}

export async function getExpense(request, reply) {
  const { roomId } = request.user;
  const { id } = request.params;

  const expense = await getExpenseById(id);
  if (!expense || expense.room_id !== roomId) {
    return reply.code(404).send({ error: 'Expense not found' });
  }

  const splits = await getSplitsByExpense(id);
  return reply.send({ expense, splits });
}

export async function markPaid(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  // Verify the split belongs to this room
  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  if (split.paid) {
    return reply.code(400).send({ error: 'Split already marked as paid' });
  }

  const updated = await markSplitPaid(splitId);
  if (!updated) return reply.code(400).send({ error: 'Could not mark as paid' });

  // Update the latest pending payment attempt to 'success'
  const latestAttempt = await getLatestAttemptForSplit(splitId);
  if (latestAttempt && latestAttempt.status === 'pending') {
    await updatePaymentAttemptStatus(latestAttempt.id, 'success');
  } else {
    // No prior attempt recorded (e.g. manual mark) — create a success record
    await createPaymentAttempt({
      splitId,
      memberId: currentMemberId,
      upiApp: 'manual',
      amount: split.share + (split.carry_forward || 0),
    }).then((a) => a && updatePaymentAttemptStatus(a.id, 'success'));
  }

  // Invalidate Redis cache
  await invalidateBalanceCache(roomId);

  // Get payer info for notification
  const payer = await getMemberById(expense.payer_id);

  // Emit Socket.io event
  emitSplitPaid(roomId, {
    splitId,
    memberId: split.member_id,
    memberName: split.member_name,
    amount: split.share + split.carry_forward,
    expenseId: split.expense_id,
    purpose: split.purpose,
  });

  // Emit updated balance
  const [memberBalance, payerBalance] = await Promise.all([
    getMemberNetBalance(split.member_id),
    getMemberNetBalance(expense.payer_id),
  ]);

  emitBalanceUpdated(roomId, {
    memberId: split.member_id,
    newBalance: memberBalance,
  });
  emitBalanceUpdated(roomId, {
    memberId: expense.payer_id,
    newBalance: payerBalance,
  });

  // Push notification to payer
  if (payer) {
    notifyPaymentReceived(
      payer,
      split.member_name,
      split.share + split.carry_forward,
      split.purpose,
      split.expense_id
    ).catch(console.error);
  }

  return reply.send({ success: true, split: updated });
}

/**
 * Record a UPI payment attempt (called when user taps "Pay Now" / selects a UPI app).
 * Creates a 'pending' attempt. When user confirms ("Done, I Paid"), markPaid upgrades it to 'success'.
 */
export async function recordPaymentAttempt(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;
  const { upiApp, amount } = request.body;

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  // Verify the split belongs to this room
  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  if (split.paid) {
    return reply.code(400).send({ error: 'Split already paid' });
  }

  // Mark any existing pending attempts for this split as 'failed'
  // (user launched a new app, previous attempt abandoned)
  const existing = await getAttemptsForSplit(splitId);
  for (const attempt of existing) {
    if (attempt.status === 'pending') {
      await updatePaymentAttemptStatus(attempt.id, 'failed');
    }
  }

  // Create new pending attempt
  const attempt = await createPaymentAttempt({
    splitId,
    memberId: currentMemberId,
    upiApp: upiApp || 'unknown',
    amount: amount || (split.share + (split.carry_forward || 0)),
  });

  return reply.code(201).send({ success: true, attempt });
}

/**
 * Get payment attempt history for a split
 */
export async function getPaymentAttempts(request, reply) {
  const { roomId } = request.user;
  const { id: splitId } = request.params;

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  const attempts = await getAttemptsForSplit(splitId);
  return reply.send({ attempts });
}

/**
 * Delete an expense — only allowed when ALL roommates have paid their share.
 * Only the payer (or any room member) can trigger this.
 */
export async function removeExpense(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: expenseId } = request.params;

  const expense = await getExpenseById(expenseId);
  if (!expense || expense.room_id !== roomId) {
    return reply.code(404).send({ error: 'Expense not found' });
  }

  // Guard: only allow deletion when every roommate has paid
  const allPaid = await areAllSplitsPaid(expenseId);
  if (!allPaid) {
    return reply.code(400).send({ error: 'Cannot delete — some roommates have not paid yet' });
  }

  await deleteExpense(expenseId);

  // Invalidate balance cache
  await invalidateBalanceCache(roomId);

  // Notify all room members via socket
  emitToRoom(roomId, 'expense:deleted', { expenseId });

  return reply.send({ success: true, expenseId });
}

export async function getBalances(request, reply) {
  const { roomId } = request.user;

  // Check Redis cache first
  const cached = await getCachedBalances(roomId);
  if (cached) {
    return reply.send({ balances: cached, cached: true });
  }

  // Compute from DB
  const members = await getMembersByRoom(roomId);
  const balances = await Promise.all(
    members.map(async (member) => {
      const balance = await getMemberNetBalance(member.id);
      return {
        memberId: member.id,
        memberName: member.name,
        color: member.color,
        avatarInitials: member.avatar_initials,
        ...balance,
      };
    })
  );

  // Cache result
  await setCachedBalances(roomId, balances);

  return reply.send({ balances, cached: false });
}
