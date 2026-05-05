import cron from 'node-cron';
import { query } from '../db/index.js';
import { getMembersByRoom } from '../db/queries/members.js';
import { getMemberNetBalance, getUnpaidSplitsForMember } from '../db/queries/splits.js';
import { getRecurringExpenses } from '../db/queries/expenses.js';
import { createSplits } from './splitService.js';
import { sendMonthlySummaryEmail, sendPaymentReminderEmail } from './emailService.js';
import { formatRupees } from './splitService.js';

let schedulerStarted = false;

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // ── Monthly summary — runs at 9am on the 1st of every month ──────────────
  cron.schedule('0 9 1 * *', async () => {
    console.log('📅 Running monthly summary emails...');
    try {
      await sendMonthlySummaries();
    } catch (err) {
      console.error('Monthly summary error:', err.message);
    }
  });

  // ── Payment reminders — runs every day at 10am ────────────────────────────
  // Sends reminder if someone has unpaid splits older than 3 days
  cron.schedule('0 10 * * *', async () => {
    console.log('⏰ Running payment reminder check...');
    try {
      await sendPaymentReminders();
    } catch (err) {
      console.error('Payment reminder error:', err.message);
    }
  });

  // ── Recurring expenses — runs at 8am every day ────────────────────────────
  cron.schedule('0 8 * * *', async () => {
    console.log('🔄 Checking recurring expenses...');
    try {
      await processRecurringExpenses();
    } catch (err) {
      console.error('Recurring expense error:', err.message);
    }
  });

  console.log('⏰ Scheduler started (monthly summaries, reminders, recurring expenses)');
}

// ── Monthly summary ───────────────────────────────────────────────────────
async function sendMonthlySummaries() {
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const monthName = lastMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Get all rooms
  const roomsRes = await query(`SELECT id, name FROM rooms`);
  for (const room of roomsRes.rows) {
    try {
      const members = await getMembersByRoom(room.id);

      // Get last month's expenses
      const expRes = await query(
        `SELECT e.*, m.name as payer_name FROM expenses e
         JOIN members m ON e.payer_id = m.id
         WHERE e.room_id = ? AND e.date >= ? AND e.date <= ?
         ORDER BY e.date DESC`,
        [room.id, lastMonth.toISOString().split('T')[0], lastMonthEnd.toISOString().split('T')[0]]
      );
      const expenses = expRes.rows;
      if (!expenses.length) continue;

      const totalSpent = expenses.reduce((s, e) => s + e.total_amount, 0);

      // Send to each member with email
      for (const member of members) {
        if (!member.email) continue;
        const balance = await getMemberNetBalance(member.id);
        await sendMonthlySummaryEmail({
          toEmail: member.email,
          toName: member.name,
          roomName: room.name,
          monthName,
          totalSpent,
          expenses: expenses.slice(0, 10),
          netBalance: balance.netBalance,
          totalOwed: balance.totalOwed,
          totalOwedTo: balance.totalOwedTo,
        }).catch(console.error);
      }
    } catch (err) {
      console.error(`Monthly summary for room ${room.id}:`, err.message);
    }
  }
}

// ── Payment reminders ─────────────────────────────────────────────────────
async function sendPaymentReminders() {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // Find unpaid splits older than 3 days
  const res = await query(
    `SELECT s.*, e.purpose, e.date, e.total_amount, e.payer_id,
            p.name as payer_name, p.upi_id as payer_upi_id,
            p.qr_code_base64 as payer_qr,
            m.name as member_name, m.email as member_email,
            r.name as room_name,
            (SELECT BACKEND_URL FROM (SELECT ? as BACKEND_URL)) as base_url
     FROM splits s
     JOIN expenses e ON s.expense_id = e.id
     JOIN members m ON s.member_id = m.id
     JOIN members p ON e.payer_id = p.id
     JOIN rooms r ON e.room_id = r.id
     WHERE s.paid = 0
       AND e.payer_id != s.member_id
       AND e.created_at < ?
       AND m.email IS NOT NULL`,
    [process.env.BACKEND_URL || 'http://localhost:3001', threeDaysAgo]
  );

  for (const split of res.rows) {
    try {
      await sendPaymentReminderEmail({
        toEmail: split.member_email,
        toName: split.member_name,
        payerName: split.payer_name,
        payerUpiId: split.payer_upi_id,
        purpose: split.purpose,
        amount: split.share + (split.carry_forward || 0),
        date: split.date,
        roomName: split.room_name,
        splitId: split.id,
      });
    } catch (err) {
      console.error(`Reminder for split ${split.id}:`, err.message);
    }
  }
}

// ── Recurring expenses ────────────────────────────────────────────────────
async function processRecurringExpenses() {
  const today = new Date();
  const todayDay = today.getDate();

  const recurring = await getRecurringExpenses();
  for (const expense of recurring) {
    // Only create if today matches the recurring day
    if (expense.recurring_day && expense.recurring_day !== todayDay) continue;

    // Check if already created this month
    const existing = await query(
      `SELECT id FROM expenses
       WHERE room_id = ? AND purpose = ? AND is_recurring = 0
         AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`,
      [expense.room_id, expense.purpose]
    );
    if (existing.rows.length > 0) continue;

    // Create new expense for this month
    const { createExpense } = await import('../db/queries/expenses.js');
    const { getMembersByRoom } = await import('../db/queries/members.js');
    const { createSplits } = await import('./splitService.js');

    const members = await getMembersByRoom(expense.room_id);
    const newExpense = await createExpense({
      roomId: expense.room_id,
      payerId: expense.payer_id,
      purpose: expense.purpose,
      category: expense.category,
      notes: `Auto-created (recurring) — ${today.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}`,
      totalAmount: expense.total_amount,
      date: today.toISOString().split('T')[0],
      isRecurring: false,
    });

    await createSplits(newExpense.id, expense.payer_id, expense.total_amount, members.map(m => m.id));
    console.log(`🔄 Created recurring expense: ${expense.purpose} for room ${expense.room_id}`);
  }
}
