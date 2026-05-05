import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export async function logActivity({ roomId, memberId, memberName, action, details, amount, expenseId }) {
  const id = uuidv4();
  await query(
    `INSERT INTO activity_log (id, room_id, member_id, member_name, action, details, amount, expense_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, memberId || null, memberName, action, details || null, amount || null, expenseId || null]
  );
  return id;
}

export async function getActivityForRoom(roomId, limit = 50) {
  const res = await query(
    `SELECT a.*, m.color as member_color, m.avatar_initials as member_initials
     FROM activity_log a
     LEFT JOIN members m ON a.member_id = m.id
     WHERE a.room_id = ?
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [roomId, limit]
  );
  return res.rows;
}
