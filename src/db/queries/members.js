import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

export async function getMembersByRoom(roomId) {
  const res = await query(
    `SELECT id, room_id, name, upi_id, email, qr_code_base64, photo_base64, color, avatar_initials, created_at
     FROM members WHERE room_id = ? ORDER BY created_at ASC`,
    [roomId]
  );
  return res.rows;
}

export async function getMemberById(memberId) {
  const res = await query(
    `SELECT id, room_id, name, upi_id, email, qr_code_base64, photo_base64, color, avatar_initials, fcm_token, push_subscription, created_at
     FROM members WHERE id = ?`,
    [memberId]
  );
  return res.rows[0] || null;
}

export async function createMember({ roomId, name, upiId, email, qrCodeBase64, color, avatarInitials }) {
  const id = uuidv4();
  await query(
    `INSERT INTO members (id, room_id, name, upi_id, email, qr_code_base64, color, avatar_initials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, name, upiId, email || null, qrCodeBase64 || null, color, avatarInitials]
  );
  return { id, room_id: roomId, name, upi_id: upiId, email: email || null, color, avatar_initials: avatarInitials, created_at: new Date().toISOString() };
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

export async function updateMember({ memberId, name, upiId, email, qrCodeBase64, color, photoBase64 }) {
  const updates = [];
  const params = [];

  if (name)                        { updates.push('name = ?');           params.push(name); }
  if (upiId)                       { updates.push('upi_id = ?');         params.push(upiId); }
  if (email !== undefined)         { updates.push('email = ?');          params.push(email || null); }
  if (qrCodeBase64)                { updates.push('qr_code_base64 = ?'); params.push(qrCodeBase64); }
  if (color)                       { updates.push('color = ?');          params.push(color); }
  if (photoBase64 !== undefined)   { updates.push('photo_base64 = ?');   params.push(photoBase64 || null); }

  if (updates.length === 0) {
    const res = await query(`SELECT * FROM members WHERE id = ?`, [memberId]);
    return res.rows[0];
  }

  params.push(memberId);
  await query(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`, params);
  const res = await query(
    `SELECT id, room_id, name, upi_id, email, color, avatar_initials, photo_base64, created_at FROM members WHERE id = ?`,
    [memberId]
  );
  return res.rows[0];
}
