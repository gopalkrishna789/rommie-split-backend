import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a new payment attempt record when user taps "Pay Now"
 * status = 'pending'
 */
export async function createPaymentAttempt({ splitId, memberId, upiApp, amount }) {
  const id = uuidv4();
  await query(
    `INSERT INTO payment_attempts (id, split_id, member_id, upi_app, amount, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
    [id, splitId, memberId, upiApp || 'unknown', amount]
  );
  const res = await query(`SELECT * FROM payment_attempts WHERE id = ?`, [id]);
  return res.rows[0] || null;
}

/**
 * Update a payment attempt status to 'success' or 'failed'
 */
export async function updatePaymentAttemptStatus(attemptId, status) {
  await query(
    `UPDATE payment_attempts SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, attemptId]
  );
  const res = await query(`SELECT * FROM payment_attempts WHERE id = ?`, [attemptId]);
  return res.rows[0] || null;
}

/**
 * Get the latest payment attempt for a split
 */
export async function getLatestAttemptForSplit(splitId) {
  const res = await query(
    `SELECT * FROM payment_attempts WHERE split_id = ? ORDER BY created_at DESC LIMIT 1`,
    [splitId]
  );
  return res.rows[0] || null;
}

/**
 * Get all payment attempts for a split (history)
 */
export async function getAttemptsForSplit(splitId) {
  const res = await query(
    `SELECT * FROM payment_attempts WHERE split_id = ? ORDER BY created_at DESC`,
    [splitId]
  );
  return res.rows;
}

/**
 * Get all pending attempts for a member (to detect abandoned payments)
 */
export async function getPendingAttemptsForMember(memberId) {
  const res = await query(
    `SELECT pa.*, s.share, s.carry_forward, e.purpose
     FROM payment_attempts pa
     JOIN splits s ON pa.split_id = s.id
     JOIN expenses e ON s.expense_id = e.id
     WHERE pa.member_id = ? AND pa.status = 'pending'
     ORDER BY pa.created_at DESC`,
    [memberId]
  );
  return res.rows;
}
