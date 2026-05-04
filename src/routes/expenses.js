import {
  addExpense,
  listExpenses,
  getExpense,
  markPaid,
  getBalances,
  recordPaymentAttempt,
  getPaymentAttempts,
  removeExpense,
} from '../controllers/expenseController.js';

export default async function expenseRoutes(fastify, options) {
  // All expense routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/expenses', {
    schema: {
      body: {
        type: 'object',
        required: ['payerId', 'purpose', 'totalAmount'],
        properties: {
          payerId:      { type: 'string', format: 'uuid' },
          purpose:      { type: 'string', minLength: 1, maxLength: 200 },
          totalAmount:  { type: 'integer', minimum: 1 },
          date:         { type: 'string', format: 'date' },
          category:     { type: 'string', maxLength: 50 },
          notes:        { type: 'string', maxLength: 500 },
          splitMode:    { type: 'string', enum: ['equal', 'custom'] },
          customShares: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
    },
  }, addExpense);

  fastify.get('/expenses', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, listExpenses);

  fastify.get('/expenses/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, getExpense);

  fastify.post('/splits/:id/pay', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, markPaid);

  // Record a UPI payment attempt (pending) when user taps "Pay Now"
  fastify.post('/splits/:id/attempt', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          upiApp: { type: 'string', enum: ['phonepe', 'gpay', 'paytm', 'upi', 'manual', 'unknown'] },
          amount: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, recordPaymentAttempt);

  // Get payment attempt history for a split
  fastify.get('/splits/:id/attempts', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, getPaymentAttempts);

  fastify.get('/balances', getBalances);

  // Delete an expense — only when all roommates have paid
  fastify.delete('/expenses/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, removeExpense);

  // Get all unpaid splits for the current logged-in member (for pending bills on login)
  fastify.get('/my-pending', async (request, reply) => {
    const { memberId, roomId } = request.user;
    const { getUnpaidSplitsForMember } = await import('../db/queries/splits.js');
    const splits = await getUnpaidSplitsForMember(memberId);
    return reply.send({ splits });
  });
}
