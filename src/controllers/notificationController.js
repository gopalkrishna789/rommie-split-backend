import { updateMemberTokens } from '../db/queries/members.js';

export async function subscribePush(request, reply) {
  const { memberId } = request.user;
  const { subscription } = request.body;

  if (!subscription || !subscription.endpoint) {
    return reply.code(400).send({ error: 'Valid push subscription object required' });
  }

  await updateMemberTokens({ memberId, pushSubscription: subscription });
  return reply.send({ success: true });
}

export async function saveFcmToken(request, reply) {
  const { memberId } = request.user;
  const { token } = request.body;

  if (!token) {
    return reply.code(400).send({ error: 'FCM token required' });
  }

  await updateMemberTokens({ memberId, fcmToken: token });
  return reply.send({ success: true });
}
