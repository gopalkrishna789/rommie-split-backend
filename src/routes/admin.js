import { query } from '../db/index.js';

export default async function adminRoutes(fastify, options) {
  
  // ── Clear all data (for testing only) ────────────────────────────────────
  fastify.post('/clear-database', async (request, reply) => {
    const { secret } = request.body;
    
    // Simple secret key protection
    const ADMIN_SECRET = process.env.ADMIN_SECRET || 'delete-all-data-2026';
    
    if (secret !== ADMIN_SECRET) {
      return reply.code(403).send({ error: 'Invalid secret key' });
    }
    
    try {
      // Delete in correct order (respecting foreign keys)
      await query('DELETE FROM payment_attempts');
      await query('DELETE FROM activity_log');
      await query('DELETE FROM splits');
      await query('DELETE FROM expenses');
      await query('DELETE FROM members');
      await query('DELETE FROM rooms');
      await query('VACUUM');
      
      // Get counts to verify
      const counts = await Promise.all([
        query('SELECT COUNT(*) as count FROM rooms'),
        query('SELECT COUNT(*) as count FROM members'),
        query('SELECT COUNT(*) as count FROM expenses'),
        query('SELECT COUNT(*) as count FROM splits'),
        query('SELECT COUNT(*) as count FROM payment_attempts'),
        query('SELECT COUNT(*) as count FROM activity_log'),
      ]);
      
      return reply.send({
        success: true,
        message: 'All data deleted successfully',
        counts: {
          rooms: counts[0].rows[0].count,
          members: counts[1].rows[0].count,
          expenses: counts[2].rows[0].count,
          splits: counts[3].rows[0].count,
          payment_attempts: counts[4].rows[0].count,
          activity_log: counts[5].rows[0].count,
        }
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to clear database', details: error.message });
    }
  });
  
  // ── Get database stats ────────────────────────────────────────────────────
  fastify.get('/database-stats', async (request, reply) => {
    try {
      const counts = await Promise.all([
        query('SELECT COUNT(*) as count FROM rooms'),
        query('SELECT COUNT(*) as count FROM members'),
        query('SELECT COUNT(*) as count FROM expenses'),
        query('SELECT COUNT(*) as count FROM splits'),
        query('SELECT COUNT(*) as count FROM payment_attempts'),
        query('SELECT COUNT(*) as count FROM activity_log'),
      ]);
      
      return reply.send({
        rooms: counts[0].rows[0].count,
        members: counts[1].rows[0].count,
        expenses: counts[2].rows[0].count,
        splits: counts[3].rows[0].count,
        payment_attempts: counts[4].rows[0].count,
        activity_log: counts[5].rows[0].count,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Failed to get stats', details: error.message });
    }
  });
}
