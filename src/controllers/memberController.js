import {
  getMembersByRoom,
  getMemberById,
  createMember,
  updateMember,
  updateMemberTokens,
} from '../db/queries/members.js';

function getInitials(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);
}

const MEMBER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6',
];

export async function listMembers(request, reply) {
  const { roomId } = request.user;
  const members = await getMembersByRoom(roomId);
  return reply.send({ members });
}

export async function addMember(request, reply) {
  const { roomId } = request.user;
  const { name, upiId, email, qrCodeBase64, color } = request.body;

  if (!name || !upiId) {
    return reply.code(400).send({ error: 'name and upiId are required' });
  }

  const existingMembers = await getMembersByRoom(roomId);
  const assignedColor = color || MEMBER_COLORS[existingMembers.length % MEMBER_COLORS.length];
  const avatarInitials = getInitials(name);

  const member = await createMember({
    roomId,
    name: name.trim(),
    upiId: upiId.trim(),
    email: email?.trim() || null,
    qrCodeBase64: qrCodeBase64 || null,
    color: assignedColor,
    avatarInitials,
  });

  return reply.code(201).send({ member });
}

export async function updateMemberHandler(request, reply) {
  const { id } = request.params;
  const { name, upiId, email, qrCodeBase64, color, photoBase64 } = request.body;

  const existing = await getMemberById(id);
  if (!existing) return reply.code(404).send({ error: 'Member not found' });
  if (existing.room_id !== request.user.roomId) {
    return reply.code(403).send({ error: 'Forbidden' });
  }

  const updated = await updateMember({ memberId: id, name, upiId, email, qrCodeBase64, color, photoBase64 });
  return reply.send({ member: updated });
}

export async function saveFcmToken(request, reply) {
  const { memberId } = request.user;
  const { fcmToken } = request.body;

  if (!fcmToken) return reply.code(400).send({ error: 'fcmToken required' });
  const updated = await updateMemberTokens({ memberId, fcmToken });
  return reply.send({ success: true, member: updated });
}

export async function savePushSubscription(request, reply) {
  const { memberId } = request.user;
  const { subscription } = request.body;

  if (!subscription) return reply.code(400).send({ error: 'subscription required' });
  const updated = await updateMemberTokens({ memberId, pushSubscription: subscription });
  return reply.send({ success: true, member: updated });
}
