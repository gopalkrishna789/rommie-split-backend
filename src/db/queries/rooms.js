import { query } from '../index.js';

const USE_MONGO = !!process.env.MONGODB_URI;

let Room;
async function getModel() {
  if (!Room) Room = (await import('../models/Room.js')).default;
  return Room;
}

export async function getRoomById(roomId) {
  if (USE_MONGO) {
    const R = await getModel();
    const r = await R.findById(roomId).lean();
    return r ? { ...r, id: r._id } : null;
  }
  const res = await query(`SELECT id, name, invite_code, is_locked, max_members FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0] || null;
}

export async function lockRoom(roomId) {
  if (USE_MONGO) {
    const R = await getModel();
    const r = await R.findByIdAndUpdate(roomId, { $set: { is_locked: true } }, { new: true }).lean();
    return r ? { ...r, id: r._id } : null;
  }
  await query(`UPDATE rooms SET is_locked = 1 WHERE id = ?`, [roomId]);
  const res = await query(`SELECT id, name, invite_code, is_locked FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0];
}

export async function unlockRoom(roomId) {
  if (USE_MONGO) {
    const R = await getModel();
    const r = await R.findByIdAndUpdate(roomId, { $set: { is_locked: false } }, { new: true }).lean();
    return r ? { ...r, id: r._id } : null;
  }
  await query(`UPDATE rooms SET is_locked = 0 WHERE id = ?`, [roomId]);
  const res = await query(`SELECT id, name, invite_code, is_locked FROM rooms WHERE id = ?`, [roomId]);
  return res.rows[0];
}
