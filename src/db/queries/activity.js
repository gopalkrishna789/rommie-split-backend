import { query } from '../index.js';
import { v4 as uuidv4 } from 'uuid';

const USE_MONGO = !!process.env.MONGODB_URI;

let Activity, Member;
async function getModels() {
  if (!Activity) {
    Activity = (await import('../models/Activity.js')).default;
    Member   = (await import('../models/Member.js')).default;
  }
  return { Activity, Member };
}

export async function logActivity({ roomId, memberId, memberName, action, details, amount, expenseId }) {
  const id = uuidv4();

  if (USE_MONGO) {
    const { Activity } = await getModels();
    await Activity.create({
      _id: id,
      room_id: roomId,
      member_id: memberId || null,
      // Activity model uses 'type' and 'description' — map from action/details
      type: action,
      description: details || action,
      metadata: { memberName, amount: amount || null, expenseId: expenseId || null },
    });
    return id;
  }

  await query(
    `INSERT INTO activity_log (id, room_id, member_id, member_name, action, details, amount, expense_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, roomId, memberId || null, memberName, action, details || null, amount || null, expenseId || null]
  );
  return id;
}

export async function getActivityForRoom(roomId, limit = 50) {
  if (USE_MONGO) {
    const { Activity, Member } = await getModels();
    const activities = await Activity.find({ room_id: roomId })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean();

    // Enrich with member color/initials
    const memberIds = [...new Set(activities.map(a => a.member_id).filter(Boolean))];
    const members = await Member.find({ _id: { $in: memberIds } }).lean();
    const memberMap = Object.fromEntries(members.map(m => [m._id, m]));

    return activities.map(a => {
      const m = memberMap[a.member_id] || {};
      return {
        id: a._id,
        room_id: a.room_id,
        member_id: a.member_id,
        member_name: a.metadata?.memberName || m.name,
        action: a.type,
        details: a.description,
        amount: a.metadata?.amount || null,
        expense_id: a.metadata?.expenseId || null,
        created_at: a.created_at,
        member_color: m.color,
        member_initials: m.avatar_initials,
      };
    });
  }

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
