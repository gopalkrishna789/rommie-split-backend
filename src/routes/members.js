import {
  listMembers,
  addMember,
  updateMemberHandler,
} from '../controllers/memberController.js';

export default async function memberRoutes(fastify, options) {
  // All member routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/members', listMembers);

  fastify.post('/members', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'upiId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          upiId: { type: 'string', minLength: 3, maxLength: 100 },
          qrCodeBase64: { type: 'string' },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
      },
    },
  }, addMember);

  fastify.put('/members/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          upiId: { type: 'string', minLength: 3, maxLength: 100 },
          qrCodeBase64: { type: 'string' },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
      },
    },
  }, updateMemberHandler);
}
