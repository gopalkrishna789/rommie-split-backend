import { subscribePush, saveFcmToken } from '../controllers/notificationController.js';

export default async function notificationRoutes(fastify, options) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/notifications/subscribe', {
    schema: {
      body: {
        type: 'object',
        required: ['subscription'],
        properties: {
          subscription: {
            type: 'object',
            required: ['endpoint'],
            properties: {
              endpoint: { type: 'string' },
              keys: { type: 'object' },
            },
          },
        },
      },
    },
  }, subscribePush);

  fastify.post('/notifications/fcm-token', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
    },
  }, saveFcmToken);

  // Return VAPID public key for client-side subscription
  fastify.get('/notifications/vapid-key', async (request, reply) => {
    return reply.send({
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    });
  });
}
