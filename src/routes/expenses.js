import {
  addExpense,
  listExpenses,
  getExpense,
  markPaid,
  getBalances,
  recordPaymentAttempt,
  getPaymentAttempts,
  removeExpense,
  editExpense,
  partialPay,
  getActivity,
  getSettlementPlan,
  payerMarksPaid,
  payerConfirmPayment,
  toggleRoomLock,
  removeMember,
  sendManualReminder,
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
          payerId:       { type: 'string', format: 'uuid' },
          purpose:       { type: 'string', minLength: 1, maxLength: 200 },
          totalAmount:   { type: 'integer', minimum: 1 },
          date:          { type: 'string', format: 'date' },
          category:      { type: 'string', maxLength: 50 },
          notes:         { type: 'string', maxLength: 500 },
          receiptBase64: { type: 'string' },
          isRecurring:   { type: 'boolean' },
          recurringDay:  { type: 'integer', minimum: 1, maximum: 31 },
          splitMode:     { type: 'string', enum: ['equal', 'custom'] },
          customShares:  { type: 'object', additionalProperties: { type: 'integer' } },
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

  // Edit expense (payer only)
  fastify.put('/expenses/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          purpose:     { type: 'string', minLength: 1, maxLength: 200 },
          category:    { type: 'string', maxLength: 50 },
          notes:       { type: 'string', maxLength: 500 },
          totalAmount: { type: 'integer', minimum: 1 },
          date:        { type: 'string', format: 'date' },
        },
      },
    },
  }, editExpense);

  // Partial payment
  fastify.post('/splits/:id/partial-pay', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'integer', minimum: 1 } },
      },
    },
  }, partialPay);

  // Activity feed
  fastify.get('/activity', {
    schema: {
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      },
    },
  }, getActivity);

  // Settlement plan
  fastify.get('/settlement-plan', getSettlementPlan);

  // Delete an expense — only when all roommates have paid
  fastify.delete('/expenses/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, removeExpense);

  // Get all unpaid splits for the current logged-in member (for pending bills on login)
  fastify.get('/my-pending', async (request, reply) => {
    const { memberId, roomId } = request.user;
    const { getUnpaidSplitsForMember, getPendingVerificationSplitsForPayer } = await import('../db/queries/splits.js');
    
    // Get splits where current user is the debtor
    const debtorSplits = await getUnpaidSplitsForMember(memberId);
    
    // Get splits where current user is the payer and payment is pending verification
    const payerSplits = await getPendingVerificationSplitsForPayer(memberId);
    
    // Combine both lists
    const allSplits = [...debtorSplits, ...payerSplits];
    
    return reply.send({ splits: allSplits });
  });

  // Payer confirms or rejects a payment claim
  fastify.post('/splits/:id/payer-verify', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['approve'],
        properties: { approve: { type: 'boolean' } },
      },
    },
  }, payerConfirmPayment);

  // Payer marks a debtor's split as paid (cash / outside-app payment)
  fastify.post('/splits/:id/payer-confirm', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, payerMarksPaid);

  // Lock / unlock room (prevents new members joining)
  fastify.post('/room/lock', {
    schema: {
      body: {
        type: 'object',
        required: ['lock'],
        properties: { lock: { type: 'boolean' } },
      },
    },
  }, toggleRoomLock);

  // Remove a member from the room
  fastify.delete('/members/:id/remove', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, removeMember);

  // Manual payment reminder — payer sends reminder email to a specific debtor
  fastify.post('/splits/:id/remind', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, sendManualReminder);
}
