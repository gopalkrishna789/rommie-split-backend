import {
  listMembers,
  addMember,
  updateMemberHandler,
} from '../controllers/memberController.js';

export default async function memberRoutes(fastify, options) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/members', listMembers);

  fastify.post('/members', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'upiId'],
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          upiId:        { type: 'string', minLength: 3, maxLength: 100 },
          email:        { type: 'string', format: 'email', maxLength: 200 },
          qrCodeBase64: { type: 'string' },
          color:        { type: 'string' },
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
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          upiId:        { type: 'string', minLength: 3, maxLength: 100 },
          email:        { type: 'string', format: 'email', maxLength: 200 },
          qrCodeBase64: { type: 'string' },
          color:        { type: 'string' },
          photoBase64:  { type: 'string' },
        },
      },
    },
  }, updateMemberHandler);

  // ── Mark tour as completed ────────────────────────────────────────────────
  fastify.post('/members/tour-complete', async (request, reply) => {
    const { memberId } = request.user;
    const { query } = await import('../db/index.js');
    
    await query('UPDATE members SET tour_completed = 1 WHERE id = ?', [memberId]);
    
    return reply.send({ success: true });
  });
}
