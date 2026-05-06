import { createExpense, getExpensesByRoom, getExpenseById, countExpensesByRoom, areAllSplitsPaid, deleteExpense, updateExpense } from '../db/queries/expenses.js';
import { getSplitsByExpense, getSplitById, markSplitPaid, markSplitPartialPaid, getMemberNetBalance, recalculateSplitsForExpense, getAllMemberBalances, refreshCarryForwardForMember } from '../db/queries/splits.js';
import { getMembersByRoom, getMemberById } from '../db/queries/members.js';
import { getRoomById } from '../db/queries/rooms.js';
import { lockRoom, unlockRoom } from '../db/queries/rooms.js';
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
import { sendExpenseAddedEmail, sendPaymentReceivedEmail } from '../services/emailService.js';
import { logActivity, getActivityForRoom } from '../db/queries/activity.js';
import { query } from '../db/index.js';

export async function addExpense(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { payerId, purpose, totalAmount, date, category, notes, customShares, receiptBase64, isRecurring, recurringDay } = request.body;

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
    receiptBase64: receiptBase64 || null,
    totalAmount,
    date,
    isRecurring: isRecurring || false,
    recurringDay: recurringDay || null,
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

  // Send email notifications to each debtor — skip the payer (non-blocking)
  const room = await getRoomById(roomId).catch(() => null);
  const roomName = room?.name || 'your room';
  for (const split of splits) {
    // Skip payer's own split (paid=true) and anyone without email
    if (split.member_id === payerId) continue;
    if (!split || split.paid) continue;
    const member = members.find((m) => m.id === split.member_id);
    if (!member?.email) continue;
    sendExpenseAddedEmail({
      toEmail: member.email,
      toName: member.name,
      payerName: payer.name,
      payerUpiId: payer.upi_id,
      purpose: expense.purpose,
      category: expense.category || 'other',
      totalAmount,
      yourShare: split.share + (split.carry_forward || 0),
      date: expense.date,
      notes: expense.notes,
      roomName,
    }).catch(console.error);
  }

  // Log activity
  logActivity({
    roomId, memberId: currentMemberId, memberName: payer.name,
    action: 'expense_added',
    details: `Added ${expense.purpose} — ${members.length} members split`,
    amount: totalAmount, expenseId: expense.id,
  }).catch(() => {});

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

  // NEW: Mark as "pending_verification" instead of "paid"
  // Only the debtor (member who owes) can initiate this
  if (split.member_id !== currentMemberId) {
    return reply.code(403).send({ error: 'Only the debtor can mark their own payment' });
  }

  // Update split to pending_verification
  const updated = await query(
    `UPDATE splits SET payment_status = 'pending_verification' WHERE id = ?`,
    [splitId]
  );

  if (!updated || updated.rowCount === 0) {
    return reply.code(400).send({ error: 'Could not update payment status' });
  }

  // Get updated split
  const updatedSplit = await getSplitById(splitId);

  // Invalidate Redis cache
  await invalidateBalanceCache(roomId);

  // Get payer info for notification
  const payer = await getMemberById(expense.payer_id);
  const debtor = await getMemberById(split.member_id);

  // Emit Socket.io event to payer
  emitToRoom(roomId, 'payment:pending_verification', {
    splitId,
    debtorId: split.member_id,
    debtorName: debtor.name,
    payerId: expense.payer_id,
    amount: split.share + split.carry_forward,
    expenseId: split.expense_id,
    purpose: split.purpose,
  });

  // Push notification to payer
  if (payer) {
    notifyPaymentReceived(
      payer,
      debtor.name,
      split.share + split.carry_forward,
      split.purpose,
      split.expense_id
    ).catch(console.error);

    // Email notification to payer
    if (payer.email) {
      const room2 = await getRoomById(roomId).catch(() => null);
      const { sendPaymentPendingEmail } = await import('../services/emailService.js');
      sendPaymentPendingEmail({
        toEmail: payer.email,
        toName: payer.name,
        fromName: debtor.name,
        amount: split.share + split.carry_forward,
        purpose: split.purpose,
        roomName: room2?.name || 'your room',
        splitId,
      }).catch(console.error);
    }
  }

  // Log activity
  logActivity({
    roomId, memberId: split.member_id, memberName: debtor.name,
    action: 'payment_claimed',
    details: `Claimed payment for ${split.purpose} - awaiting payer confirmation`,
    amount: split.share + split.carry_forward, expenseId: split.expense_id,
  }).catch(() => {});

  return reply.send({ 
    success: true, 
    split: updatedSplit,
    status: 'pending_verification',
    message: 'Payment marked as pending. Waiting for payer to confirm.'
  });
}

/**
 * Partial payment — pay part of a split
 */
export async function partialPay(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;
  const { amount } = request.body;

  if (!amount || amount <= 0) return reply.code(400).send({ error: 'Amount must be positive' });

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) return reply.code(403).send({ error: 'Forbidden' });
  if (split.paid) return reply.code(400).send({ error: 'Split already fully paid' });

  const updated = await markSplitPartialPaid(splitId, amount);
  if (!updated) return reply.code(400).send({ error: 'Could not record partial payment' });

  await invalidateBalanceCache(roomId);

  logActivity({
    roomId, memberId: currentMemberId, memberName: split.member_name,
    action: 'partial_payment',
    details: `Partial payment for ${split.purpose}`,
    amount, expenseId: split.expense_id,
  }).catch(() => {});

  if (updated.paid) {
    // Fully paid now — emit same events as full payment
    const payer = await getMemberById(expense.payer_id);
    emitSplitPaid(roomId, { splitId, memberId: split.member_id, memberName: split.member_name, amount: split.share + split.carry_forward, expenseId: split.expense_id, purpose: split.purpose });
    if (payer?.email) {
      const room = await getRoomById(roomId).catch(() => null);
      sendPaymentReceivedEmail({ toEmail: payer.email, toName: payer.name, fromName: split.member_name, amount: split.share + split.carry_forward, purpose: split.purpose, roomName: room?.name || 'your room' }).catch(console.error);
    }
  }

  return reply.send({ success: true, split: updated, fullyPaid: updated.paid });
}

/**
 * Edit an expense (payer only, before all splits are paid)
 * If totalAmount changes, unpaid splits are recalculated automatically.
 */
export async function editExpense(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: expenseId } = request.params;
  const { purpose, category, notes, totalAmount, date } = request.body;

  const expense = await getExpenseById(expenseId);
  if (!expense || expense.room_id !== roomId) return reply.code(404).send({ error: 'Expense not found' });
  if (expense.payer_id !== currentMemberId) return reply.code(403).send({ error: 'Only the payer can edit this expense' });

  const updated = await updateExpense({ expenseId, purpose, category, notes, totalAmount, date });

  // If the total amount changed, recalculate unpaid splits proportionally
  if (totalAmount && totalAmount !== expense.total_amount) {
    await recalculateSplitsForExpense(expenseId, totalAmount);
  }

  await invalidateBalanceCache(roomId);
  emitToRoom(roomId, 'expense:updated', { expenseId, expense: updated });

  logActivity({
    roomId, memberId: currentMemberId, memberName: expense.payer_name,
    action: 'expense_edited', details: `Edited ${expense.purpose}`, expenseId,
  }).catch(() => {});

  return reply.send({ success: true, expense: updated });
}

/**
 * Payer confirms that they received the payment
 * (replaces the old payerMarksPaid which was for marking on behalf)
 */
export async function payerConfirmPayment(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;
  const { approve } = request.body; // true = approve, false = reject

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) return reply.code(403).send({ error: 'Forbidden' });

  // Only the payer of the expense can confirm
  if (expense.payer_id !== currentMemberId) {
    return reply.code(403).send({ error: 'Only the payer can confirm payments' });
  }

  // Check if payment is pending verification
  const currentSplit = await query(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  if (!currentSplit.rows[0]) return reply.code(404).send({ error: 'Split not found' });
  
  const paymentStatus = currentSplit.rows[0].payment_status || 'unpaid';
  
  if (paymentStatus !== 'pending_verification') {
    return reply.code(400).send({ error: 'Payment is not pending verification' });
  }

  if (approve) {
    // Approve: Mark as paid
    const updated = await markSplitPaid(splitId);
    await invalidateBalanceCache(roomId);
    refreshCarryForwardForMember(split.member_id).catch(console.error);

    // Update payment status
    await query(`UPDATE splits SET payment_status = 'paid' WHERE id = ?`, [splitId]);

    emitSplitPaid(roomId, {
      splitId, memberId: split.member_id, memberName: split.member_name,
      amount: split.share + split.carry_forward,
      expenseId: split.expense_id, purpose: split.purpose,
    });

    // Emit updated balances
    const [memberBalance, payerBalance] = await Promise.all([
      getMemberNetBalance(split.member_id),
      getMemberNetBalance(expense.payer_id),
    ]);

    emitBalanceUpdated(roomId, { memberId: split.member_id, newBalance: memberBalance });
    emitBalanceUpdated(roomId, { memberId: expense.payer_id, newBalance: payerBalance });

    logActivity({
      roomId, memberId: currentMemberId, memberName: expense.payer_name,
      action: 'payment_confirmed',
      details: `Confirmed payment from ${split.member_name} for ${split.purpose}`,
      amount: split.share + split.carry_forward, expenseId: split.expense_id,
    }).catch(() => {});

    // Notify debtor that payment was confirmed
    const debtor = await getMemberById(split.member_id);
    if (debtor?.email) {
      const room = await getRoomById(roomId).catch(() => null);
      const { sendPaymentConfirmedEmail } = await import('../services/emailService.js');
      sendPaymentConfirmedEmail({
        toEmail: debtor.email,
        toName: debtor.name,
        payerName: expense.payer_name,
        amount: split.share + split.carry_forward,
        purpose: split.purpose,
        roomName: room?.name || 'your room',
      }).catch(console.error);
    }

    return reply.send({ success: true, split: updated, status: 'confirmed' });
  } else {
    // Reject: Mark back as unpaid
    await query(`UPDATE splits SET payment_status = 'unpaid' WHERE id = ?`, [splitId]);
    await invalidateBalanceCache(roomId);

    emitToRoom(roomId, 'payment:rejected', {
      splitId, memberId: split.member_id, memberName: split.member_name,
      amount: split.share + split.carry_forward,
      expenseId: split.expense_id, purpose: split.purpose,
    });

    logActivity({
      roomId, memberId: currentMemberId, memberName: expense.payer_name,
      action: 'payment_rejected',
      details: `Rejected payment claim from ${split.member_name} for ${split.purpose}`,
      amount: split.share + split.carry_forward, expenseId: split.expense_id,
    }).catch(() => {});

    // Notify debtor that payment was rejected
    const debtor = await getMemberById(split.member_id);
    if (debtor?.email) {
      const room = await getRoomById(roomId).catch(() => null);
      const { sendPaymentRejectedEmail } = await import('../services/emailService.js');
      sendPaymentRejectedEmail({
        toEmail: debtor.email,
        toName: debtor.name,
        payerName: expense.payer_name,
        amount: split.share + split.carry_forward,
        purpose: split.purpose,
        roomName: room?.name || 'your room',
      }).catch(console.error);
    }

    return reply.send({ success: true, status: 'rejected' });
  }
}

/**
 * Payer marks a specific debtor's split as paid on their behalf
 * (e.g. cash payment, outside-app UPI, etc.)
 */
export async function payerMarksPaid(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) return reply.code(403).send({ error: 'Forbidden' });

  // Only the payer of the expense can use this endpoint
  if (expense.payer_id !== currentMemberId) {
    return reply.code(403).send({ error: 'Only the expense payer can mark others as paid' });
  }

  if (split.paid) return reply.code(400).send({ error: 'Split already paid' });

  const updated = await markSplitPaid(splitId);
  await query(`UPDATE splits SET payment_status = 'paid' WHERE id = ?`, [splitId]);
  await invalidateBalanceCache(roomId);
  refreshCarryForwardForMember(split.member_id).catch(console.error);

  emitSplitPaid(roomId, {
    splitId, memberId: split.member_id, memberName: split.member_name,
    amount: split.share + split.carry_forward,
    expenseId: split.expense_id, purpose: split.purpose,
  });

  logActivity({
    roomId, memberId: currentMemberId, memberName: expense.payer_name,
    action: 'payment_made',
    details: `Marked ${split.member_name} as paid for ${split.purpose} (recorded by payer)`,
    amount: split.share + split.carry_forward, expenseId: split.expense_id,
  }).catch(() => {});

  return reply.send({ success: true, split: updated });
}

/**
 * Lock / unlock a room (prevents new members from joining)
 */
export async function toggleRoomLock(request, reply) {
  const { roomId } = request.user;
  const { lock } = request.body;
  const room = lock ? await lockRoom(roomId) : await unlockRoom(roomId);
  emitToRoom(roomId, 'room:lock_changed', { isLocked: room.is_locked === 1 || room.is_locked === true });
  return reply.send({ success: true, room });
}

/**
 * Remove a member from the room (admin action — any member can remove others for now)
 */
export async function removeMember(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: targetMemberId } = request.params;

  if (targetMemberId === currentMemberId) {
    return reply.code(400).send({ error: 'You cannot remove yourself' });
  }

  const { getMemberById } = await import('../db/queries/members.js');
  const target = await getMemberById(targetMemberId);
  if (!target || target.room_id !== roomId) {
    return reply.code(404).send({ error: 'Member not found in this room' });
  }

  // Check if member has unpaid splits — block removal if so
  const { getUnpaidSplitsForMember } = await import('../db/queries/splits.js');
  const unpaid = await getUnpaidSplitsForMember(targetMemberId);
  if (unpaid.length > 0) {
    return reply.code(400).send({ error: `${target.name} has ${unpaid.length} unpaid split(s). Settle up before removing.` });
  }

  const { query } = await import('../db/index.js');
  await query(`DELETE FROM members WHERE id = ? AND room_id = ?`, [targetMemberId, roomId]);

  await invalidateBalanceCache(roomId);
  emitToRoom(roomId, 'member:removed', { memberId: targetMemberId, memberName: target.name });

  return reply.send({ success: true, removedMemberId: targetMemberId });
}

/**
 * Manual payment reminder — payer triggers reminder email for a specific split
 */
export async function sendManualReminder(request, reply) {
  const { roomId, memberId: currentMemberId } = request.user;
  const { id: splitId } = request.params;

  const split = await getSplitById(splitId);
  if (!split) return reply.code(404).send({ error: 'Split not found' });

  const expense = await getExpenseById(split.expense_id);
  if (!expense || expense.room_id !== roomId) return reply.code(403).send({ error: 'Forbidden' });
  if (expense.payer_id !== currentMemberId) return reply.code(403).send({ error: 'Only the payer can send reminders' });
  if (split.paid) return reply.code(400).send({ error: 'Split already paid' });

  const { getMemberById: getMember } = await import('../db/queries/members.js');
  const debtor = await getMember(split.member_id);
  const payer  = await getMember(expense.payer_id);
  const room   = await getRoomById(roomId).catch(() => null);

  if (!debtor?.email) return reply.code(400).send({ error: `${debtor?.name || 'Member'} has no email address set` });

  const { sendPaymentReminderEmail } = await import('../services/emailService.js');
  await sendPaymentReminderEmail({
    toEmail: debtor.email,
    toName: debtor.name,
    payerName: payer?.name || 'your roommate',
    payerUpiId: payer?.upi_id || '',
    purpose: expense.purpose,
    amount: split.share + (split.carry_forward || 0),
    date: expense.date,
    roomName: room?.name || 'your room',
    splitId,
  });

  return reply.send({ success: true, sentTo: debtor.email });
}

export async function getActivity(request, reply) {
  const { roomId } = request.user;
  const limit = parseInt(request.query.limit || '50', 10);
  const activities = await getActivityForRoom(roomId, limit);
  return reply.send({ activities });
}

/**
 * Settlement summary — minimum transactions to clear all debts
 */
export async function getSettlementPlan(request, reply) {
  const { roomId } = request.user;
  const { calculateNetSettlement, getDetailedBalances } = await import('../services/settlementService.js');
  
  const members = await getMembersByRoom(roomId);

  // Get all unpaid splits with payer info
  const result = await query(`
    SELECT s.*, e.purpose, e.date, e.payer_id
    FROM splits s
    JOIN expenses e ON s.expense_id = e.id
    WHERE e.room_id = ? AND s.paid = 0 AND e.payer_id != s.member_id
  `, [roomId]);

  const unpaidSplits = result.rows;

  if (unpaidSplits.length === 0) {
    return reply.send({
      transactions: [],
      detailedBalances: [],
      summary: {
        totalTransactions: 0,
        totalAmount: 0,
        transactionsSaved: 0,
        savingsPercentage: 0,
      },
    });
  }

  // Calculate optimized settlement with net offsetting
  const settlement = calculateNetSettlement(members, unpaidSplits);
  
  // Get detailed breakdown (before netting)
  const detailedBalances = getDetailedBalances(members, unpaidSplits);

  return reply.send({
    ...settlement,
    detailedBalances,
  });
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

  // Single-query balance calculation — replaces N+1 pattern
  const members = await getMembersByRoom(roomId);
  const { owedMap, owedToMap } = await getAllMemberBalances(roomId);

  const balances = members.map((member) => {
    const totalOwed   = owedMap[member.id]   || 0;
    const totalOwedTo = owedToMap[member.id] || 0;
    return {
      memberId:       member.id,
      memberName:     member.name,
      color:          member.color,
      avatarInitials: member.avatar_initials,
      totalOwed,
      totalOwedTo,
      netBalance:     totalOwedTo - totalOwed,
    };
  });

  // Cache result
  await setCachedBalances(roomId, balances);

  return reply.send({ balances, cached: false });
}
