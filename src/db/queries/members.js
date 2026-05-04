import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export async function getMembersByRoom(roomId) {
  const res = await query(
    `SELECT id, room_id, name, upi_id, qr_code_base64, color, avatar_initials, created_at
     FROM members WHERE room_id = ? ORDER BY created_at ASC`,
    [roomId]
  );
  return res.rows;
}

export async function getMemberById(memberId) {
  const res = await query(
    `SELECT id, room_id, name, upi_id, qr_code_base64, color, avatar_initials, fcm_token, push_subscription, created_at
     FROM members WHERE id = ?`,
    [memberId]
  );
  return res.rows[0] || null;
}

export async function createMember({ roomId, name, upiId, qrCodeBase64, color, avatarInitials }) {
  const id = uuidv4();
  await query(
    `INSERT INTO members (id, room_id, name, upi_id, qr_code_base64, color, avatar_initials)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, name, upiId, qrCodeBase64 || null, color, avatarInitials]
  );
  const res = await query(`SELECT id, room_id, name, upi_id, color, avatar_initials, created_at FROM members WHERE id = ?`, [id]);
  return res.rows[0];
}

export async function updateMemberTokens({ memberId, fcmToken, pushSubscription }) {
  const pushJson = pushSubscription ? JSON.stringify(pushSubscription) : null;

  if (fcmToken && pushJson) {
    await query(
      `UPDATE members SET fcm_token = ?, push_subscription = ? WHERE id = ?`,
      [fcmToken, pushJson, memberId]
    );
  } else if (fcmToken) {
    await query(`UPDATE members SET fcm_token = ? WHERE id = ?`, [fcmToken, memberId]);
  } else if (pushJson) {
    await query(`UPDATE members SET push_subscription = ? WHERE id = ?`, [pushJson, memberId]);
  }

  const res = await query(`SELECT id, name FROM members WHERE id = ?`, [memberId]);
  return res.rows[0];
}

export async function updateMember({ memberId, name, upiId, qrCodeBase64, color }) {
  const updates = [];
  const params = [];

  if (name)         { updates.push('name = ?');           params.push(name); }
  if (upiId)        { updates.push('upi_id = ?');         params.push(upiId); }
  if (qrCodeBase64) { updates.push('qr_code_base64 = ?'); params.push(qrCodeBase64); }
  if (color)        { updates.push('color = ?');          params.push(color); }

  if (updates.length === 0) {
    const res = await query(`SELECT * FROM members WHERE id = ?`, [memberId]);
    return res.rows[0];
  }

  params.push(memberId);
  await query(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`, params);
  const res = await query(
    `SELECT id, room_id, name, upi_id, color, avatar_initials, created_at FROM members WHERE id = ?`,
    [memberId]
  );
  return res.rows[0];
}
