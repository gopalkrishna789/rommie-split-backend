import { query } from '../index.js';

export async function getRoomById(roomId) {
  const res = await query(`SELECT id, name, invite_code, is_locked, max_members FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0] || null;
}

export async function lockRoom(roomId) {
  await query(`UPDATE rooms SET is_locked = 1 WHERE id = ?`, [roomId]);
  const res = await query(`SELECT id, name, invite_code, is_locked FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0];
}

export async function unlockRoom(roomId) {
  await query(`UPDATE rooms SET is_locked = 0 WHERE id = ?`, [roomId]);
  const res = await query(`SELECT id, name, invite_code, is_locked FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0];
}
